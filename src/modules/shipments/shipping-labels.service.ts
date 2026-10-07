import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { ShipmentLabel } from '../../generated/prisma/client.js';
import {
  MelhorEnvioLabelsService,
  LabelRequestRejected,
} from './integrations/melhor-envio-labels.service.js';
import type { RemoteLabel } from './integrations/melhor-envio-labels.service.js';
import { isRecord } from '../payments/integrations/asaas.service.js';
import {
  assertShipmentPaid,
  createLabelPayload,
  labelShipmentInclude,
} from './shipping-label-payload.js';
import type { CreateLabelInput } from './dto/shipping-label.dto.js';
import type { AvailableItemsQuery } from './dto/available-items.dto.js';

const labelDto = (row: ShipmentLabel) => ({
  id: row.id,
  shipmentId: row.shipmentId,
  provider: row.provider,
  remoteId: row.remoteId,
  status: row.status,
  cost: row.cost?.toFixed(2) ?? null,
  generatedAt: row.generatedAt?.toISOString() ?? null,
  createStartedAt: row.createStartedAt?.toISOString() ?? null,
  checkoutStartedAt: row.checkoutStartedAt?.toISOString() ?? null,
  generateStartedAt: row.generateStartedAt?.toISOString() ?? null,
});

@Injectable()
export class ShippingLabelsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MelhorEnvioLabelsService)
    private readonly provider: MelhorEnvioLabelsService,
  ) {}
  list(query: AvailableItemsQuery) {
    return this.protect(() =>
      this.transaction(async (tx) => ({
        items: await tx.shipment.findMany({
          where: { status: { in: ['PREPARING', 'READY_TO_SHIP', 'SHIPPED'] } },
          select: {
            id: true,
            userId: true,
            status: true,
            packedAt: true,
            shippingPaidAt: true,
            trackingCode: true,
            createdAt: true,
            items: {
              select: {
                quantity: true,
                orderItem: {
                  select: {
                    cardName: true,
                    cardNumber: true,
                    setName: true,
                    conditionName: true,
                    languageName: true,
                  },
                },
              },
            },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: query.pageSize,
          skip: (query.page - 1) * query.pageSize,
        }),
        ...query,
        total: await tx.shipment.count({
          where: { status: { in: ['PREPARING', 'READY_TO_SHIP', 'SHIPPED'] } },
        }),
      })),
    );
  }
  pack(id: string, actorId: string) {
    return this.protect(() =>
      this.transaction(async (tx) => {
        const row = await this.shipment(tx, id);
        assertShipmentPaid(row);
        if (row.status !== 'PREPARING')
          throw new ConflictException(
            'Somente envios em preparação podem ser conferidos.',
          );
        if (!row.packedAt)
          await tx.shipment.update({
            where: { id },
            data: { packedAt: new Date(), packedById: actorId },
          });
        return { id, status: row.status, packed: true };
      }),
    );
  }
  create(id: string, actorId: string, body: CreateLabelInput) {
    return this.protect(async () => {
      this.provider.assertConfigured();
      const label = await this.transaction(async (tx) => {
        const row = await this.shipment(tx, id);
        assertShipmentPaid(row);
        if (row.label) {
          if (
            row.label.status === 'INTENT' &&
            !row.label.remoteId &&
            !row.label.createStartedAt
          ) {
            const payload = createLabelPayload(
              row,
              body,
              this.provider.provider,
            );
            const refreshed = await tx.shipmentLabel.updateMany({
              where: {
                id: row.label.id,
                status: 'INTENT',
                remoteId: null,
                createStartedAt: null,
              },
              data: { requestSnapshot: payload },
            });
            if (refreshed.count !== 1)
              throw new ConflictException(
                'Etiqueta alterada durante a correção. Consulte o envio.',
              );
            return {
              ...row.label,
              requestSnapshot: payload as Prisma.JsonObject,
            };
          }
          const payload = row.label.requestSnapshot;
          const to =
            isRecord(payload) && isRecord(payload.to) ? payload.to : {};
          const options =
            isRecord(payload) && isRecord(payload.options)
              ? payload.options
              : {};
          const invoice = isRecord(options.invoice) ? options.invoice : {};
          if (
            to.document !== body.recipientDocument ||
            to.phone !== body.recipientPhone ||
            (invoice.key ?? null) !== (body.invoiceKey ?? null)
          )
            throw new ConflictException(
              'A etiqueta já possui dados fixados. Não altere o destinatário ou documento fiscal ao repetir.',
            );
          return row.label;
        }
        if (row.status !== 'PREPARING' || !row.packedAt)
          throw new ConflictException(
            'Confira e marque a embalagem como preparada antes de criar a etiqueta.',
          );
        const payload = createLabelPayload(row, body, this.provider.provider);
        return tx.shipmentLabel.create({
          data: {
            shipmentId: id,
            provider: this.provider.provider,
            requestedById: actorId,
            requestSnapshot: payload,
          },
        });
      });
      this.sameEnvironment(label);
      if (label.remoteId) return labelDto(label);
      const claimed = await this.prisma.shipmentLabel.updateMany({
        where: { id: label.id, remoteId: null, createStartedAt: null },
        data: { createStartedAt: new Date(), status: 'CREATING' },
      });
      if (claimed.count !== 1)
        throw new ConflictException(
          'Criação já enviada. Se houve timeout, recupere a etiqueta pelo ID no Melhor Envio; não crie outra.',
        );
      let remoteId: string;
      try {
        remoteId = await this.provider.create(
          label.requestSnapshot as Prisma.InputJsonValue,
        );
      } catch (error) {
        if (error instanceof LabelRequestRejected)
          await this.prisma.shipmentLabel.updateMany({
            where: { id: label.id, remoteId: null },
            data: { createStartedAt: null, status: 'INTENT' },
          });
        throw error;
      }
      // Persist the external ID immediately; later validation failures must not create another cart item.
      const bound = await this.prisma.shipmentLabel.updateMany({
        where: { id: label.id, OR: [{ remoteId: null }, { remoteId }] },
        data: { remoteId, status: 'PENDING' },
      });
      if (bound.count !== 1)
        throw new ConflictException(
          'Etiqueta já vinculada a outro registro externo.',
        );
      return this.sync(id);
    });
  }
  recover(id: string, remoteId: string) {
    return this.protect(async () => {
      const label = await this.label(id);
      this.sameEnvironment(label);
      if (label.remoteId && label.remoteId !== remoteId)
        throw new ConflictException('Envio já vinculado a outra etiqueta.');
      const remote = await this.provider.get(remoteId);
      this.matches(label, remote);
      const bound = await this.prisma.shipmentLabel.updateMany({
        where: { id: label.id, OR: [{ remoteId: null }, { remoteId }] },
        data: { remoteId },
      });
      if (bound.count !== 1)
        throw new ConflictException('Etiqueta alterada durante a recuperação.');
      return this.apply(label, remote);
    });
  }
  checkout(id: string, expectedCost: string) {
    return this.protect(async () => {
      let label = await this.label(id);
      this.sameEnvironment(label);
      if (!label.remoteId)
        throw new ConflictException(
          'Crie ou recupere a etiqueta antes da compra.',
        );
      const remote = await this.provider.get(label.remoteId);
      this.matches(label, remote);
      if (remote.paid) return this.apply(label, remote);
      if (remote.status !== 'pending')
        throw new ConflictException(
          'Etiqueta não está disponível para compra.',
        );
      if (!new Prisma.Decimal(remote.cost).equals(expectedCost))
        throw new ConflictException(
          'Preço da etiqueta mudou. Consulte o custo antes de comprar.',
        );
      label = await this.transaction(async (tx) => {
        const row = await this.shipment(tx, id);
        assertShipmentPaid(row);
        if (
          row.status !== 'PREPARING' ||
          !row.packedAt ||
          !row.label ||
          row.label.checkoutStartedAt
        )
          throw new ConflictException(
            'Compra já solicitada ou envio encerrado. Sincronize antes de tentar novamente.',
          );
        if (new Prisma.Decimal(remote.cost).gt(row.shippingCost))
          throw new ConflictException(
            'Custo da etiqueta excede o frete pago. Necessária revisão do valor antes da compra.',
          );
        if (
          this.provider.provider.endsWith(':production') &&
          row.payments.some(
            (p) => p.status === 'PAID' && p.provider !== 'asaas:production',
          )
        )
          throw new ConflictException(
            'Pagamento de teste não autoriza etiqueta de produção.',
          );
        return tx.shipmentLabel.update({
          where: { id: label.id },
          data: {
            checkoutStartedAt: new Date(),
            cost: remote.cost,
            status: 'PURCHASING',
          },
        });
      });
      try {
        await this.provider.checkout(label.remoteId!);
      } catch (error) {
        if (error instanceof LabelRequestRejected)
          await this.prisma.shipmentLabel.updateMany({
            where: { id: label.id, status: 'PURCHASING' },
            data: { checkoutStartedAt: null, status: 'PENDING' },
          });
        throw error;
      }
      return this.sync(id);
    });
  }
  generate(id: string) {
    return this.protect(async () => {
      const label = await this.label(id);
      this.sameEnvironment(label);
      if (!label.remoteId) throw new ConflictException('Etiqueta não criada.');
      const remote = await this.provider.get(label.remoteId);
      this.matches(label, remote);
      if (remote.generatedAt) return this.apply(label, remote);
      if (!remote.paid || remote.status !== 'released')
        throw new ConflictException(
          'A compra da etiqueta ainda não está confirmada no Melhor Envio.',
        );
      await this.transaction(async (tx) => {
        const row = await this.shipment(tx, id);
        assertShipmentPaid(row);
        if (row.status !== 'PREPARING' || !row.packedAt)
          throw new ConflictException('Envio não está em preparação.');
        const claimed = await tx.shipmentLabel.updateMany({
          where: { id: label.id, generateStartedAt: null },
          data: { generateStartedAt: new Date(), status: 'GENERATING' },
        });
        if (claimed.count !== 1)
          throw new ConflictException(
            'Geração já solicitada. Sincronize o envio ou confira o painel do Melhor Envio.',
          );
      });
      try {
        await this.provider.generate(label.remoteId);
      } catch (error) {
        if (error instanceof LabelRequestRejected)
          await this.prisma.shipmentLabel.updateMany({
            where: { id: label.id, status: 'GENERATING' },
            data: { generateStartedAt: null, status: 'PURCHASED' },
          });
        throw error;
      }
      return this.sync(id);
    });
  }
  sync(id: string) {
    return this.protect(async () => {
      const label = await this.label(id);
      this.sameEnvironment(label);
      if (!label.remoteId) return labelDto(label);
      const remote = await this.provider.get(label.remoteId);
      this.matches(label, remote);
      return this.apply(label, remote);
    });
  }
  print(id: string) {
    return this.protect(async () => {
      await this.sync(id);
      const label = await this.label(id);
      if (
        !label.remoteId ||
        !label.generatedAt ||
        ['REVIEW_REQUIRED', 'CANCELED', 'EXPIRED', 'SUSPENDED'].includes(
          label.status,
        )
      )
        throw new ConflictException(
          'Etiqueta ainda não disponível para impressão.',
        );
      return this.provider.print(label.remoteId);
    });
  }
  private matches(label: ShipmentLabel, remote: RemoteLabel) {
    const body = label.requestSnapshot;
    if (
      !isRecord(body) ||
      !isRecord(body.from) ||
      !isRecord(body.to) ||
      !remote.tags.includes(label.shipmentId) ||
      (typeof body.service !== 'number' && typeof body.service !== 'string') ||
      String(body.service) !== remote.serviceCode ||
      body.from.postal_code !== remote.fromZip ||
      body.to.postal_code !== remote.toZip ||
      body.to.document !== remote.recipientDocument
    )
      throw new ConflictException(
        'Etiqueta externa não corresponde a este envio. Confira os dados no Melhor Envio.',
      );
  }
  private apply(label: ShipmentLabel, remote: RemoteLabel) {
    return this.transaction(async (tx) => {
      const shipment = await this.shipment(tx, label.shipmentId);
      if (shipment.label?.remoteId !== remote.id)
        throw new ConflictException(
          'Vínculo externo da etiqueta foi alterado.',
        );
      assertShipmentPaid(shipment);
      const review = [
        'canceled',
        'cancelled',
        'suspended',
        'expired',
        'undelivered',
      ].includes(remote.status);
      const status = review
        ? 'REVIEW_REQUIRED'
        : remote.deliveredAt
          ? 'DELIVERED'
          : remote.postedAt
            ? 'POSTED'
            : remote.generatedAt
              ? 'GENERATED'
              : remote.paid
                ? 'PURCHASED'
                : 'PENDING';
      const saved = await tx.shipmentLabel.update({
        where: { id: label.id },
        data: {
          status,
          cost: remote.cost,
          generatedAt: remote.generatedAt ?? undefined,
        },
      });
      const rank = {
        PENDING: 0,
        ACCUMULATING: 0,
        PREPARING: 1,
        READY_TO_SHIP: 2,
        SHIPPED: 3,
        DELIVERED: 4,
        CANCELLED: 5,
      };
      const target =
        remote.paid && !review
          ? remote.deliveredAt
            ? 'DELIVERED'
            : remote.postedAt
              ? 'SHIPPED'
              : remote.generatedAt
                ? 'READY_TO_SHIP'
                : undefined
          : undefined;
      await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          providerShipmentId: remote.id,
          ...(remote.tracking ? { trackingCode: remote.tracking } : {}),
          ...(target && rank[target] > rank[shipment.status]
            ? { status: target }
            : {}),
          ...(remote.postedAt && !shipment.shippedAt
            ? { shippedAt: remote.postedAt }
            : {}),
          ...(remote.deliveredAt && !shipment.deliveredAt
            ? { deliveredAt: remote.deliveredAt }
            : {}),
        },
      });
      return labelDto(saved);
    });
  }
  private sameEnvironment(label: ShipmentLabel) {
    this.provider.assertConfigured();
    if (label.provider !== this.provider.provider)
      throw new ConflictException('Etiqueta pertence a outro ambiente.');
  }
  private async label(shipmentId: string) {
    const row = await this.prisma.shipmentLabel.findUnique({
      where: { shipmentId },
    });
    if (!row) throw new NotFoundException('Etiqueta não encontrada.');
    return row;
  }
  private async shipment(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.shipment.findUnique({
      where: { id },
      include: labelShipmentInclude,
    });
    if (!row) throw new NotFoundException('Envio não encontrado.');
    return row;
  }
  private async transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: 'Serializable',
          maxWait: 5000,
          timeout: 15000,
        });
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          ['P2034', 'P2002'].includes(String(error.code)) &&
          attempt < 2
        )
          continue;
        throw error;
      }
    }
  }
  private async protect<T>(work: () => Promise<T>) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'Operação de etiqueta indisponível. Consulte o estado antes de repetir.',
      );
    }
  }
}

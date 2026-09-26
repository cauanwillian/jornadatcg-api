import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CreateShipmentInput } from './dto/create-shipment.dto.js';
import type { AvailableItemsQuery } from './dto/available-items.dto.js';

const include = {
  items: { orderBy: { orderItemId: 'asc' }, include: { orderItem: true } },
} satisfies Prisma.ShipmentInclude;
type ShipmentRecord = Prisma.ShipmentGetPayload<{ include: typeof include }>;
const dto = (row: ShipmentRecord) => ({
  id: row.id,
  status: row.status,
  shippingMethod: row.shippingMethod,
  // An unquoted request must not present the database's zero default as free shipping.
  shippingCost:
    row.shippingMethod === 'TO_BE_DEFINED' ? null : row.shippingCost.toFixed(2),
  address: row.addressSnapshot,
  trackingCode: row.trackingCode,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  items: row.items.map(({ orderItem, quantity }) => ({
    orderItemId: orderItem.id,
    orderId: orderItem.orderId,
    quantity,
    cardName: orderItem.cardName,
    cardNumber: orderItem.cardNumber,
    setName: orderItem.setName,
    conditionName: orderItem.conditionName,
    languageName: orderItem.languageName,
    unitPrice: orderItem.unitPrice.toFixed(2),
    subtotal: orderItem.unitPrice.mul(quantity).toFixed(2),
  })),
});

@Injectable()
export class ShipmentRequestsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  create(userId: string, key: string, body: CreateShipmentInput) {
    return this.transaction(async (tx) => {
      // Use the request UUID as the shipment primary key: durable replay without a schema change.
      const existing = await tx.shipment.findUnique({
        where: { id: key },
        include,
      });
      if (existing) {
        const snapshot = existing.addressSnapshot as Record<
          string,
          unknown
        > | null;
        const items = existing.items.map(({ orderItemId, quantity }) => ({
          orderItemId,
          quantity,
        }));
        if (
          existing.userId !== userId ||
          snapshot?.addressId !== body.addressId ||
          JSON.stringify(items) !== JSON.stringify(body.items)
        )
          throw new ConflictException(
            'Idempotency-Key já utilizada em outra solicitação.',
          );
        return dto(existing);
      }
      const address = await tx.address.findFirst({
        where: { id: body.addressId, userId },
      });
      if (!address) throw new NotFoundException('Endereço não encontrado.');
      const items = await tx.orderItem.findMany({
        where: {
          id: { in: body.items.map((item) => item.orderItemId) },
          order: {
            userId,
            status: {
              in: [
                'PAID',
                'PREPARING',
                'READY_TO_SHIP',
                'SHIPPED',
                'DELIVERED',
              ],
            },
            paidAt: { not: null },
            payments: {
              some: { status: 'PAID' },
              none: { status: 'REFUNDED' },
            },
          },
        },
        include: {
          shipmentItems: {
            where: { shipment: { status: { not: 'CANCELLED' } } },
            select: { quantity: true },
          },
        },
      });
      if (items.length !== body.items.length)
        throw new ConflictException(
          'Um ou mais itens não estão disponíveis para envio.',
        );
      for (const selection of body.items) {
        const item = items.find((item) => item.id === selection.orderItemId)!;
        const allocated = item.shipmentItems.reduce(
          (sum, allocation) => sum + allocation.quantity,
          0,
        );
        if (allocated < 0 || item.quantity - allocated < selection.quantity)
          throw new ConflictException(
            'Quantidade disponível insuficiente. Consulte novamente as compras acumuladas.',
          );
      }
      const {
        recipientName,
        zipCode,
        street,
        number,
        complement,
        neighborhood,
        city,
        state,
      } = address;
      return dto(
        await tx.shipment.create({
          data: {
            id: key,
            userId,
            status: 'PENDING',
            shippingMethod: 'TO_BE_DEFINED',
            addressSnapshot: {
              addressId: address.id,
              recipientName,
              zipCode,
              street,
              number,
              complement,
              neighborhood,
              city,
              state,
            },
            items: { create: body.items },
          },
          include,
        }),
      );
    });
  }
  list(userId: string, query: AvailableItemsQuery) {
    return this.transaction(async (tx) => ({
      items: (
        await tx.shipment.findMany({
          where: { userId },
          include,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        })
      ).map(dto),
      ...query,
      total: await tx.shipment.count({ where: { userId } }),
    }));
  }
  get(userId: string, id: string) {
    return this.transaction(async (tx) =>
      dto(await this.owned(tx, userId, id)),
    );
  }
  cancel(userId: string, id: string) {
    return this.transaction(async (tx) => {
      const row = await this.owned(tx, userId, id);
      if (row.status === 'CANCELLED') return dto(row);
      if (
        row.status !== 'PENDING' ||
        row.shippingMethod !== 'TO_BE_DEFINED' ||
        row.providerShipmentId ||
        row.trackingCode ||
        !row.shippingCost.isZero()
      )
        throw new ConflictException(
          'Esta solicitação não pode mais ser cancelada pelo cliente.',
        );
      return dto(
        await tx.shipment.update({
          where: { id, userId },
          data: { status: 'CANCELLED' },
          include,
        }),
      );
    });
  }
  private async owned(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string,
  ) {
    const row = await tx.shipment.findFirst({ where: { id, userId }, include });
    if (!row)
      throw new NotFoundException('Solicitação de envio não encontrada.');
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
          timeout: 10000,
        });
      } catch (error) {
        if (error instanceof HttpException) throw error;
        const code =
          error && typeof error === 'object' && 'code' in error
            ? error.code
            : undefined;
        if ((code === 'P2034' || code === 'P2002') && attempt < 2) continue;
        if (['P2034', 'P2002', 'P2025', 'P2003'].includes(String(code)))
          throw new ConflictException(
            'Dados alterados. Consulte a solicitação e tente novamente com a mesma Idempotency-Key.',
          );
        throw new ServiceUnavailableException(
          'Solicitações de envio temporariamente indisponíveis.',
        );
      }
    }
  }
}

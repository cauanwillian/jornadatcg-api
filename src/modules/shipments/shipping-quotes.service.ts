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
import {
  ShippingProvidersService,
  shippingProviders,
} from './integrations/shipping-providers.service.js';
import { shippingPackage } from './shipping-package.js';
import { isRecord } from '../payments/integrations/asaas.service.js';

@Injectable()
export class ShippingQuotesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ShippingProvidersService)
    private readonly providers: ShippingProvidersService,
  ) {}
  quote(userId: string, shipmentId: string) {
    return this.protect(async () => {
      const shipment = await this.prisma.shipment.findFirst({
        where: { id: shipmentId, userId },
        include: {
          items: { include: { orderItem: true } },
          payments: { select: { id: true } },
        },
      });
      if (!shipment) throw new NotFoundException('Envio não encontrado.');
      if (shipment.status !== 'PENDING' || shipment.payments.length)
        throw new ConflictException(
          'Envio já possui cobrança ou está encerrado.',
        );
      const parcel = shippingPackage(
        shipment.items.reduce((sum, item) => sum + item.quantity, 0),
      );
      const from = process.env.SHIPPING_ORIGIN_ZIP_CODE ?? '78556858';
      const address = shipment.addressSnapshot;
      if (
        !/^\d{8}$/.test(from) ||
        !isRecord(address) ||
        typeof address.zipCode !== 'string' ||
        !/^\d{8}$/.test(address.zipCode)
      )
        throw new ConflictException('CEP de origem ou destino inválido.');
      const declaredValue = shipment.items
        .reduce(
          (sum, item) => sum.add(item.orderItem.unitPrice.mul(item.quantity)),
          new Prisma.Decimal(0),
        )
        .toFixed(2);
      const expiresAt = new Date(Date.now() + 15 * 60_000);
      const responses = await Promise.all(
        shippingProviders.map(async (provider) => {
          if (!this.providers.configured(provider))
            return { provider, status: 'NOT_CONFIGURED', options: [] };
          try {
            return {
              provider,
              status: 'OK',
              options: await this.providers.quote(provider, {
                from,
                to: address.zipCode as string,
                declaredValue,
                package: parcel,
              }),
            };
          } catch (error) {
            return {
              provider,
              status:
                error instanceof HttpException && error.getStatus() === 504
                  ? 'TIMEOUT'
                  : error instanceof HttpException && error.getStatus() === 502
                    ? 'INVALID_RESPONSE'
                    : 'UNAVAILABLE',
              options: [],
            };
          }
        }),
      );
      const providers = responses.map(({ provider, status }) => ({
        provider,
        status,
      }));
      if (!responses.some((result) => result.status === 'OK'))
        throw new ServiceUnavailableException({
          message:
            'Nenhum provedor de frete disponível. Configure as credenciais ou tente novamente.',
          providers,
        });
      return this.transaction(async (tx) => {
        const current = await tx.shipment.findFirst({
          where: { id: shipmentId, userId },
          include: { payments: { select: { id: true } } },
        });
        if (
          !current ||
          current.status !== 'PENDING' ||
          current.payments.length ||
          current.updatedAt.getTime() !== shipment.updatedAt.getTime()
        )
          throw new ConflictException(
            'Envio alterado durante a cotação. Consulte novamente.',
          );
        // Keep at most one current batch; a new batch invalidates an unpaid selection.
        await tx.shipment.update({
          where: { id: shipmentId },
          data: {
            selectedQuoteId: null,
            provider: null,
            shippingMethod: 'TO_BE_DEFINED',
            shippingCost: 0,
          },
        });
        await tx.shippingQuote.deleteMany({ where: { shipmentId } });
        const options = [];
        for (const option of responses.flatMap((result) => result.options)) {
          const saved = await tx.shippingQuote.create({
            data: {
              ...option,
              shipmentId,
              expiresAt,
              packageSnapshot: {
                ...parcel,
                originZipCode: from,
                destinationZipCode: address.zipCode,
                declaredValue,
              },
            },
          });
          options.push({
            ...option,
            id: saved.id,
            expiresAt: expiresAt.toISOString(),
          });
        }
        options.sort(
          (a, b) =>
            new Prisma.Decimal(a.amount).comparedTo(b.amount) ||
            a.deliveryDays - b.deliveryDays,
        );
        return {
          shipmentId,
          package: parcel,
          expiresAt: expiresAt.toISOString(),
          options,
          providers,
        };
      });
    });
  }
  select(userId: string, shipmentId: string, quoteId: string) {
    return this.protect(() =>
      this.transaction(async (tx) => {
        const shipment = await tx.shipment.findFirst({
          where: { id: shipmentId, userId },
          include: { payments: { select: { id: true } } },
        });
        if (!shipment) throw new NotFoundException('Envio não encontrado.');
        if (shipment.status !== 'PENDING' || shipment.payments.length)
          throw new ConflictException(
            'Envio já possui cobrança ou está encerrado.',
          );
        const quote = await tx.shippingQuote.findFirst({
          where: { id: quoteId, shipmentId, expiresAt: { gt: new Date() } },
        });
        if (!quote)
          throw new ConflictException(
            'Cotação inválida ou expirada. Calcule o frete novamente.',
          );
        await tx.shipment.update({
          where: { id: shipmentId },
          data: {
            selectedQuoteId: quote.id,
            provider: quote.provider,
            shippingMethod: quote.serviceCode,
            shippingCost: quote.amount,
          },
        });
        return {
          shipmentId,
          quoteId,
          provider: quote.provider,
          serviceName: quote.serviceName,
          carrier: quote.carrier,
          shippingCost: quote.amount.toFixed(2),
          deliveryDays: quote.deliveryDays,
          expiresAt: quote.expiresAt.toISOString(),
        };
      }),
    );
  }
  private async transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: 'Serializable',
          timeout: 15000,
        });
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'P2034' &&
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
        'Cotações temporariamente indisponíveis.',
      );
    }
  }
}

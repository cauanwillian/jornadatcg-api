import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { visibleProducts } from './catalog.service.js';
import {
  ShippingProvidersService,
  shippingProviders,
} from '../shipments/integrations/shipping-providers.service.js';
import { shippingPackage } from '../shipments/shipping-package.js';
export interface EstimateQuery {
  zipCode: string;
  quantity: number;
}
@Injectable()
export class EstimateQueryPipe implements PipeTransform {
  transform(value: Record<string, unknown>): EstimateQuery {
    if (
      Object.keys(value).some((k) => !['zipCode', 'quantity'].includes(k)) ||
      typeof value.zipCode !== 'string' ||
      !/^\d{5}-?\d{3}$/.test(value.zipCode)
    )
      throw new BadRequestException('Informe zipCode com 8 dígitos.');
    const quantity = value.quantity ?? '1';
    if (
      typeof quantity !== 'string' ||
      !/^[1-9]\d*$/.test(quantity) ||
      Number(quantity) > 70
    )
      throw new BadRequestException('quantity deve ser inteiro entre 1 e 70.');
    return {
      zipCode: value.zipCode.replace('-', ''),
      quantity: Number(quantity),
    };
  }
}
@Injectable()
export class ShippingEstimateService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ShippingProvidersService)
    private readonly providers: ShippingProvidersService,
  ) {}
  async estimate(id: string, query: EstimateQuery) {
    let product;
    try {
      product = await this.db.product.findFirst({
        where: { ...visibleProducts, id },
        select: {
          id: true,
          price: true,
          inventory: { select: { availableQuantity: true } },
        },
      });
    } catch {
      throw new ServiceUnavailableException(
        'Catálogo temporariamente indisponível.',
      );
    }
    if (!product) throw new NotFoundException('Produto não encontrado.');
    if ((product.inventory?.availableQuantity ?? 0) < query.quantity)
      throw new ConflictException('Quantidade indisponível para este produto.');
    const from = process.env.SHIPPING_ORIGIN_ZIP_CODE ?? '78556858';
    if (!/^\d{8}$/.test(from))
      throw new ServiceUnavailableException(
        'Origem do frete não configurada corretamente.',
      );
    const parcel = shippingPackage(query.quantity);
    const declaredValue = product.price.mul(query.quantity).toFixed(2);
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
              to: query.zipCode,
              declaredValue,
              package: parcel,
            }),
          };
        } catch (e) {
          return {
            provider,
            status:
              e instanceof HttpException && e.getStatus() === 504
                ? 'TIMEOUT'
                : e instanceof HttpException && e.getStatus() === 502
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
    if (!responses.some((r) => r.status === 'OK'))
      throw new ServiceUnavailableException({
        message: 'Estimativa de frete temporariamente indisponível.',
        providers,
      });
    const options = responses
      .flatMap((r) => r.options)
      .sort(
        (a, b) =>
          new Prisma.Decimal(a.amount).comparedTo(b.amount) ||
          a.deliveryDays - b.deliveryDays,
      );
    return {
      productId: id,
      quantity: query.quantity,
      destinationZipCode: query.zipCode,
      estimated: true,
      quotedAt: new Date().toISOString(),
      package: parcel,
      declaredValue,
      options,
      providers,
      message:
        'Estimativa para este produto. O frete será recalculado quando você solicitar o envio das compras acumuladas.',
    };
  }
}

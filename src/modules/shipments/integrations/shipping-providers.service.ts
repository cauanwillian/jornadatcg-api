import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { isRecord } from '../../payments/integrations/asaas.service.js';
import type { ShippingPackage } from '../shipping-package.js';

export type ShippingProvider = 'melhorenvio' | 'superfrete' | 'frenet';
export interface QuoteInput {
  from: string;
  to: string;
  declaredValue: string;
  package: ShippingPackage;
}
export interface ProviderQuote {
  provider: string;
  serviceCode: string;
  serviceName: string;
  carrier: string;
  amount: string;
  deliveryDays: number;
}
const config = {
  melhorenvio: {
    token: 'MELHOR_ENVIO_TOKEN',
    environment: 'MELHOR_ENVIO_ENVIRONMENT',
    sandbox: 'https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate',
    production: 'https://melhorenvio.com.br/api/v2/me/shipment/calculate',
  },
  superfrete: {
    token: 'SUPERFRETE_TOKEN',
    environment: 'SUPERFRETE_ENVIRONMENT',
    sandbox: 'https://sandbox.superfrete.com/api/v0/calculator',
    production: 'https://api.superfrete.com/api/v0/calculator',
  },
  frenet: {
    token: 'FRENET_TOKEN',
    environment: null,
    sandbox: '',
    production: 'https://api.frenet.com.br/shipping/quote',
  },
};
export const shippingProviders: ShippingProvider[] = [
  'melhorenvio',
  'superfrete',
  'frenet',
];

@Injectable()
export class ShippingProvidersService {
  configured(provider: ShippingProvider) {
    return !!process.env[config[provider].token]?.trim();
  }
  identity(provider: ShippingProvider) {
    const key = config[provider].environment;
    const environment = key ? (process.env[key] ?? 'sandbox') : 'production';
    if (!['sandbox', 'production'].includes(environment))
      throw new ServiceUnavailableException('Ambiente de frete inválido.');
    return `${provider}:${environment}`;
  }
  async quote(
    provider: ShippingProvider,
    input: QuoteInput,
  ): Promise<ProviderQuote[]> {
    if (!this.configured(provider))
      throw new ServiceUnavailableException(
        'Provedor de frete não configurado.',
      );
    const identity = this.identity(provider);
    const settings = config[provider];
    const url = identity.endsWith(':sandbox')
      ? settings.sandbox
      : settings.production;
    const contact = process.env.SHIPPING_CONTACT_EMAIL?.trim();
    if (!contact || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact))
      throw new ServiceUnavailableException(
        'Contato técnico de frete não configurado.',
      );
    const { height, width, length, weight } = input.package;
    const parcel = { height, width, length, weight };
    const value = Number(input.declaredValue);
    const common = {
      from: { postal_code: input.from },
      to: { postal_code: input.to },
    };
    const body =
      provider === 'frenet'
        ? {
            SellerCEP: input.from,
            RecipientCEP: input.to,
            RecipientCountry: 'BR',
            ShipmentInvoiceValue: value,
            ShippingItemArray: [
              {
                Height: height,
                Width: width,
                Length: length,
                Weight: weight,
                Quantity: 1,
                SKU: 'JORNADATCG-PACKAGE',
              },
            ],
          }
        : provider === 'superfrete'
          ? {
              ...common,
              services: '1,2,17,3,33,31',
              package: parcel,
              options: {
                own_hand: false,
                receipt: false,
                insurance_value: value,
                use_insurance_value: true,
              },
            }
          : {
              ...common,
              volumes: [{ ...parcel, insurance: value }],
              options: {
                own_hand: false,
                receipt: false,
              },
            };
    const signal = AbortSignal.timeout(10_000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        signal,
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': `JornadaTCG/1.0 (${contact})`,
          ...(provider === 'frenet'
            ? { token: process.env[settings.token]! }
            : { Authorization: `Bearer ${process.env[settings.token]!}` }),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok)
        throw new ServiceUnavailableException(
          'Provedor de frete indisponível ou configuração recusada.',
        );
      return this.normalize(provider, identity, await response.json());
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (signal.aborted)
        throw new GatewayTimeoutException(
          'O provedor de frete não respondeu a tempo.',
        );
      if (error instanceof SyntaxError)
        throw new BadGatewayException('Resposta de frete inválida.');
      throw new ServiceUnavailableException(
        'Falha de comunicação com o provedor de frete.',
      );
    }
  }
  private normalize(
    provider: ShippingProvider,
    identity: string,
    response: unknown,
  ): ProviderQuote[] {
    const invalid = (): never => {
      throw new BadGatewayException('Resposta de frete inválida.');
    };
    const rows: unknown =
      provider === 'frenet' && isRecord(response)
        ? response.ShippingSevicesArray
        : response;
    if (!Array.isArray(rows) || rows.length > 200) return invalid();
    const output: ProviderQuote[] = [];
    for (const row of rows) {
      if (!isRecord(row)) return invalid();
      if (row.error || row.has_error === true || row.Error === true) continue;
      const amount =
        provider === 'frenet'
          ? row.ShippingPrice
          : provider === 'melhorenvio'
            ? (row.custom_price ?? row.price)
            : row.price;
      const days =
        provider === 'frenet'
          ? row.DeliveryTime
          : provider === 'melhorenvio'
            ? (row.custom_delivery_time ?? row.delivery_time)
            : row.delivery_time;
      const code = provider === 'frenet' ? row.ServiceCode : row.id;
      const name = provider === 'frenet' ? row.ServiceDescription : row.name;
      const carrier =
        provider === 'frenet'
          ? row.Carrier
          : isRecord(row.company)
            ? row.company.name
            : null;
      if (
        (typeof amount !== 'string' && typeof amount !== 'number') ||
        !/^\d{1,10}(\.\d{1,2})?$/.test(String(amount)) ||
        !['string', 'number'].includes(typeof days) ||
        !/^\d{1,3}$/.test(String(days)) ||
        !['string', 'number'].includes(typeof code) ||
        !/^[A-Za-z0-9_.-]{1,80}$/.test(String(code)) ||
        typeof name !== 'string' ||
        !name.trim() ||
        name.length > 150 ||
        typeof carrier !== 'string' ||
        !carrier.trim() ||
        carrier.length > 150
      )
        return invalid();
      const price = new Prisma.Decimal(amount);
      if (price.lte(0) || price.gt('9999999999.99')) return invalid();
      output.push({
        provider: identity,
        serviceCode: String(code),
        serviceName: name,
        carrier,
        amount: price.toFixed(2),
        deliveryDays: Number(days),
      });
    }
    return output;
  }
}

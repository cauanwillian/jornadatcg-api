import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { isRecord } from '../../payments/integrations/asaas.service.js';

export class LabelRequestRejected extends BadRequestException {
  constructor(fields: string[] = [], sameDocument = false) {
    super(
      fields.length
        ? {
            message: sameDocument
              ? 'O CPF do remetente e o do destinatário não podem ser iguais.'
              : 'Melhor Envio recusou campos da etiqueta. Revise os campos indicados.',
            error: 'Bad Request',
            statusCode: 400,
            fields,
          }
        : 'Melhor Envio recusou os dados ou a operação. Confira cadastro, documentos, permissões e saldo da carteira.',
    );
  }
}
export interface RemoteLabel {
  id: string;
  serviceCode: string;
  status: string;
  cost: string;
  paid: boolean;
  generatedAt: Date | null;
  postedAt: Date | null;
  deliveredAt: Date | null;
  tracking: string | null;
  tags: string[];
  fromZip: string | null;
  toZip: string | null;
  recipientDocument: string | null;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
@Injectable()
export class MelhorEnvioLabelsService {
  get provider() {
    const env = process.env.MELHOR_ENVIO_ENVIRONMENT ?? 'sandbox';
    if (!['sandbox', 'production'].includes(env))
      throw new ServiceUnavailableException('Ambiente Melhor Envio inválido.');
    return `melhorenvio:${env}`;
  }
  assertConfigured() {
    const provider = this.provider;
    if (
      !provider ||
      !process.env.MELHOR_ENVIO_TOKEN?.trim() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        process.env.SHIPPING_CONTACT_EMAIL ?? '',
      )
    )
      throw new ServiceUnavailableException(
        'Configure o token Melhor Envio e o e-mail técnico.',
      );
  }
  async create(body: Prisma.InputJsonValue) {
    const result = await this.request('/cart', 'POST', body);
    if (
      !isRecord(result) ||
      typeof result.id !== 'string' ||
      !uuid.test(result.id)
    )
      return this.invalid();
    return result.id;
  }
  async get(id: string): Promise<RemoteLabel> {
    if (!uuid.test(id)) return this.invalid();
    const row = await this.request(`/orders/${id}`);
    if (
      !isRecord(row) ||
      row.id !== id ||
      typeof row.status !== 'string' ||
      ![
        'pending',
        'released',
        'posted',
        'delivered',
        'undelivered',
        'suspended',
        'canceled',
        'cancelled',
        'expired',
      ].includes(row.status) ||
      !['number', 'string'].includes(typeof row.price) ||
      !/^\d{1,10}(\.\d{1,2})?$/.test(String(row.price)) ||
      !['number', 'string'].includes(typeof row.service_id) ||
      !/^\d+$/.test(String(row.service_id)) ||
      !Array.isArray(row.tags)
    )
      return this.invalid();
    const cost = new Prisma.Decimal(row.price as string | number);
    if (cost.lte(0) || cost.gt('9999999999.99')) return this.invalid();
    const date = (value: unknown): Date | null => {
      if (value == null) return null;
      if (typeof value !== 'string') return this.invalid();
      const formatted = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
        ? value.replace(' ', 'T') + '-03:00'
        : value;
      const parsed = new Date(formatted);
      if (!Number.isFinite(parsed.getTime())) return this.invalid();
      return parsed;
    };
    const tags = row.tags.map((tag: unknown) => {
      if (!isRecord(tag) || typeof tag.tag !== 'string') return this.invalid();
      return tag.tag;
    });
    if (
      row.tracking != null &&
      (typeof row.tracking !== 'string' ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(row.tracking))
    )
      return this.invalid();
    return {
      id,
      serviceCode: String(row.service_id),
      status: row.status,
      cost: cost.toFixed(2),
      paid: date(row.paid_at) !== null,
      generatedAt: date(row.generated_at),
      postedAt: date(row.posted_at),
      deliveredAt: date(row.delivered_at),
      tracking: (row.tracking as string | null) ?? null,
      tags,
      fromZip:
        isRecord(row.from) && typeof row.from.postal_code === 'string'
          ? row.from.postal_code
          : null,
      toZip:
        isRecord(row.to) && typeof row.to.postal_code === 'string'
          ? row.to.postal_code
          : null,
      recipientDocument:
        isRecord(row.to) && typeof row.to.document === 'string'
          ? row.to.document
          : null,
    };
  }
  async checkout(id: string) {
    await this.request('/shipment/checkout', 'POST', { orders: [id] });
  }
  async generate(id: string) {
    const result = await this.request('/shipment/generate', 'POST', {
      orders: [id],
    });
    if (
      !isRecord(result) ||
      !isRecord(result[id]) ||
      result[id].status !== true
    )
      throw new BadGatewayException(
        'Geração ainda não confirmada. Sincronize a etiqueta antes de repetir.',
      );
  }
  async print(id: string) {
    const result = await this.request('/shipment/print', 'POST', {
      orders: [id],
      mode: 'private',
    });
    if (!isRecord(result) || typeof result.url !== 'string')
      return this.invalid();
    let url: URL;
    try {
      url = new URL(result.url);
    } catch {
      return this.invalid();
    }
    const host = this.provider.endsWith(':sandbox')
      ? 'sandbox.melhorenvio.com.br'
      : 'melhorenvio.com.br';
    if (
      url.protocol !== 'https:' ||
      url.hostname !== host ||
      url.username ||
      url.password ||
      url.port
    )
      return this.invalid();
    return { url: result.url, mode: 'private' };
  }
  private invalid(): never {
    throw new BadGatewayException('Resposta inválida do Melhor Envio.');
  }
  private async request(
    path: string,
    method = 'GET',
    body?: unknown,
  ): Promise<unknown> {
    this.assertConfigured();
    const base = this.provider.endsWith(':sandbox')
      ? 'https://sandbox.melhorenvio.com.br'
      : 'https://melhorenvio.com.br';
    const signal = AbortSignal.timeout(15000);
    try {
      const response = await fetch(`${base}/api/v2/me${path}`, {
        method,
        signal,
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${process.env.MELHOR_ENVIO_TOKEN!}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': `JornadaTCG/1.0 (${process.env.SHIPPING_CONTACT_EMAIL!})`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if ([400, 422].includes(response.status)) {
        // Only known field paths are safe to expose; provider messages may contain PII.
        const rejected: unknown = await response.json().catch(() => null);
        if (
          isRecord(rejected) &&
          rejected.error ===
            'O CPF do remetente e do destinatário não podem ser iguais'
        ) {
          throw new LabelRequestRejected(
            ['from.document', 'to.document'],
            true,
          );
        }
        const errors =
          isRecord(rejected) && isRecord(rejected.errors)
            ? rejected.errors
            : {};
        const allowed =
          /^(service|agency|from|to|products|volumes|options|(?:from|to)\.(?:name|phone|email|document|company_document|state_register|postal_code|address|number|complement|district|city|state_abbr|country_id)|products\.\d{1,3}\.(?:name|quantity|unitary_value)|volumes\.\d{1,3}\.(?:height|width|length|weight)|options\.(?:insurance_value|receipt|own_hand|reverse|non_commercial|invoice|invoice\.key|tags))$/;
        throw new LabelRequestRejected(
          Object.keys(errors)
            .filter((key) => allowed.test(key))
            .slice(0, 30),
        );
      }
      if (!response.ok)
        throw new ServiceUnavailableException(
          'Melhor Envio indisponível ou acesso não autorizado.',
        );
      return await response.json();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (signal.aborted)
        throw new GatewayTimeoutException(
          'Melhor Envio não respondeu a tempo. Consulte a etiqueta antes de repetir a operação.',
        );
      if (error instanceof SyntaxError) return this.invalid();
      throw new ServiceUnavailableException(
        'Falha de comunicação com o Melhor Envio.',
      );
    }
  }
}

import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';

export class AsaasRejectedRequest extends BadRequestException {
  constructor() {
    super(
      'O Asaas recusou a solicitação. Verifique os dados do pagador e a configuração da conta.',
    );
  }
}

export interface AsaasPayment {
  id: string;
  customer: string;
  externalReference: string;
  amount: string;
  status: string;
  billingType: string;
  deleted: boolean;
  paymentDate: string | null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);

@Injectable()
export class AsaasService {
  get provider() {
    return `asaas:${this.environment()}`;
  }

  private environment() {
    const value = process.env.ASAAS_ENVIRONMENT ?? 'sandbox';
    if (value !== 'sandbox' && value !== 'production')
      throw new ServiceUnavailableException('Ambiente Asaas inválido.');
    return value;
  }

  assertConfigured() {
    this.environment();
    if (!process.env.ASAAS_API_KEY?.trim())
      throw new ServiceUnavailableException(
        'Pagamentos Asaas não configurados.',
      );
  }

  private invalid(): never {
    throw new BadGatewayException('Resposta inválida do Asaas.');
  }

  private normalize(value: unknown): AsaasPayment {
    if (
      !isRecord(value) ||
      !identifier(value.id) ||
      !identifier(value.customer) ||
      (value.externalReference != null &&
        typeof value.externalReference !== 'string') ||
      typeof value.billingType !== 'string' ||
      typeof value.status !== 'string' ||
      typeof value.value !== 'number' ||
      !Number.isFinite(value.value) ||
      value.value <= 0 ||
      (value.deleted !== undefined && typeof value.deleted !== 'boolean')
    )
      return this.invalid();
    const amount = new Prisma.Decimal(value.value);
    if (amount.decimalPlaces() > 2 || amount.greaterThan('9999999999.99'))
      return this.invalid();
    if (
      value.paymentDate != null &&
      (typeof value.paymentDate !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value.paymentDate))
    )
      return this.invalid();
    if (typeof value.paymentDate === 'string') {
      const date = new Date(`${value.paymentDate}T00:00:00Z`);
      if (
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== value.paymentDate
      )
        return this.invalid();
    }
    return {
      id: value.id,
      customer: value.customer,
      externalReference: (value.externalReference as string | null) ?? '',
      billingType: value.billingType,
      amount: amount.toFixed(2),
      status: value.status,
      deleted: value.deleted === true,
      paymentDate: (value.paymentDate as string | null) ?? null,
    };
  }

  async customer(
    user: { id: string; name: string; email: string },
    cpf: string,
  ): Promise<string> {
    const result = await this.request(
      `/customers?externalReference=${encodeURIComponent(user.id)}&limit=100`,
    );
    if (
      !isRecord(result) ||
      !Array.isArray(result.data) ||
      typeof result.hasMore !== 'boolean'
    )
      return this.invalid();
    const existing = result.data.find(
      (entry: unknown) =>
        isRecord(entry) &&
        entry.externalReference === user.id &&
        entry.cpfCnpj === cpf,
    );
    if (isRecord(existing) && identifier(existing.id)) return existing.id;
    if (result.hasMore || result.data.length)
      throw new BadGatewayException(
        'Cadastro do pagador no Asaas necessita de revisão.',
      );
    const created = await this.request('/customers', 'POST', {
      name: user.name,
      email: user.email,
      cpfCnpj: cpf,
      externalReference: user.id,
      notificationDisabled: true,
    });
    if (!isRecord(created) || !identifier(created.id)) return this.invalid();
    return created.id;
  }

  async createPix(input: {
    customer: string;
    amount: string;
    reference: string;
    expiresAt: Date;
  }): Promise<AsaasPayment> {
    const dueDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(input.expiresAt);
    return this.normalize(
      await this.request('/payments', 'POST', {
        customer: input.customer,
        billingType: 'PIX',
        value: Number(input.amount),
        dueDate,
        externalReference: input.reference,
        description: 'Compra JornadaTCG',
        fine: { value: 0 },
        interest: { value: 0 },
      }),
    );
  }

  async getPayment(id: string): Promise<AsaasPayment> {
    if (!identifier(id)) return this.invalid();
    const payment = this.normalize(
      await this.request(`/payments/${encodeURIComponent(id)}`),
    );
    if (payment.id !== id) return this.invalid();
    return payment;
  }

  async findPayment(reference: string): Promise<AsaasPayment | null> {
    const result = await this.request(
      `/payments?externalReference=${encodeURIComponent(reference)}&limit=2`,
    );
    if (
      !isRecord(result) ||
      !Array.isArray(result.data) ||
      typeof result.hasMore !== 'boolean'
    )
      return this.invalid();
    if (result.hasMore || result.data.length > 1)
      throw new BadGatewayException(
        'Cobranças duplicadas no provedor. Necessária reconciliação.',
      );
    if (!result.data.length) return null;
    const payment = this.normalize(result.data[0]);
    if (payment.externalReference !== reference) return this.invalid();
    return payment;
  }

  async qrCode(id: string) {
    if (!identifier(id)) return this.invalid();
    const value = await this.request(
      `/payments/${encodeURIComponent(id)}/pixQrCode`,
    );
    if (
      !isRecord(value) ||
      typeof value.encodedImage !== 'string' ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value.encodedImage) ||
      value.encodedImage.length > 500_000 ||
      typeof value.payload !== 'string' ||
      !value.payload ||
      value.payload.length > 10000 ||
      typeof value.expirationDate !== 'string' ||
      !value.expirationDate
    )
      return this.invalid();
    return {
      encodedImage: value.encodedImage,
      payload: value.payload,
      expirationDate: value.expirationDate,
    };
  }

  async deletePayment(id: string) {
    if (!identifier(id)) return this.invalid();
    const value = await this.request(
      `/payments/${encodeURIComponent(id)}`,
      'DELETE',
    );
    if (!isRecord(value) || value.id !== id || value.deleted !== true)
      return this.invalid();
  }

  private async request(
    path: string,
    method = 'GET',
    body?: unknown,
  ): Promise<unknown> {
    this.assertConfigured();
    const base =
      this.environment() === 'sandbox'
        ? 'https://api-sandbox.asaas.com/v3'
        : 'https://api.asaas.com/v3';
    const signal = AbortSignal.timeout(10_000);
    try {
      const response = await fetch(`${base}${path}`, {
        method,
        signal,
        redirect: 'error',
        headers: {
          access_token: process.env.ASAAS_API_KEY!,
          'User-Agent': 'JornadaTCG/1.0',
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status === 400) throw new AsaasRejectedRequest();
      if (!response.ok)
        throw new ServiceUnavailableException(
          'Asaas temporariamente indisponível.',
        );
      return (await response.json()) as unknown;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (signal.aborted)
        throw new GatewayTimeoutException(
          'O Asaas não respondeu a tempo. Consulte o pagamento antes de tentar novamente.',
        );
      if (error instanceof SyntaxError) return this.invalid();
      throw new ServiceUnavailableException(
        'Falha de comunicação com o Asaas.',
      );
    }
  }
}

import {
  ConflictException,
  GatewayTimeoutException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { Payment } from '../../generated/prisma/client.js';
import { AsaasPixService } from './asaas-pix.service.js';
import {
  AsaasService,
  AsaasRejectedRequest,
} from './integrations/asaas.service.js';
import type { AsaasPayment } from './integrations/asaas.service.js';
import type { PaymentsService, VerifiedPayment } from './payments.service.js';
import { OrderReservationConfig } from '../orders/order-reservation.config.js';

const userId = 'a99d3fe9-a5fb-4f35-9218-88592106d61f';
const orderId = '92030503-e053-4138-95c4-af75a9f65066';
const paymentId = 'e0f58a11-0a82-4f35-b5c2-0846f362fe33';
const cpf = '52998224725'; // Synthetic checksum-valid fixture; never sent externally.
const now = new Date();
const deadline = new Date(now.getTime() + 30 * 60_000);
const base: Payment = {
  id: paymentId,
  orderId,
  provider: 'asaas:sandbox',
  method: 'PIX',
  status: 'PENDING',
  amount: new Prisma.Decimal('10.50'),
  installments: 1,
  createdAt: now,
  updatedAt: now,
  paidAt: null,
  failedAt: null,
  expiresAt: deadline,
  providerPaymentId: null,
  providerCustomerId: null,
  providerRequestStartedAt: null,
};
const remote: AsaasPayment = {
  id: 'pay_123',
  customer: 'cus_123',
  externalReference: paymentId,
  billingType: 'PIX',
  amount: '10.50',
  status: 'PENDING',
  deleted: false,
  paymentDate: null,
};
const owner = {
  id: userId,
  name: 'Test',
  email: 'test@example.com',
  cpf: null,
};
const order = {
  id: orderId,
  status: 'PENDING_PAYMENT',
  total: base.amount,
  expiresAt: deadline,
  user: owner,
};

describe('Asaas Pix orchestration', () => {
  let current: Payment | null;
  let service: AsaasPixService;
  const db = {
    order: { findFirst: vi.fn(), update: vi.fn() },
    user: { update: vi.fn() },
    payment: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  const asaas = {
    provider: 'asaas:sandbox',
    assertConfigured: vi.fn(),
    customer: vi.fn(),
    createPix: vi.fn(),
    getPayment: vi.fn(),
    findPayment: vi.fn(),
    deletePayment: vi.fn(),
    qrCode: vi.fn(),
  };
  const lifecycle = { applyVerifiedPayment: vi.fn() };
  beforeEach(() => {
    vi.resetAllMocks();
    current = null;
    vi.stubEnv('ORDER_RESERVATION_MINUTES', '30');
    db.$transaction.mockImplementation(
      (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        work(db as unknown as Prisma.TransactionClient),
    );
    db.order.findFirst.mockResolvedValue(order);
    db.order.update.mockResolvedValue({ id: orderId });
    db.user.update.mockResolvedValue({ id: userId });
    db.payment.findFirst.mockResolvedValue(null);
    db.payment.findUnique.mockImplementation(() =>
      Promise.resolve(current && { ...current }),
    );
    db.payment.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({ ...current }),
    );
    db.payment.create.mockImplementation(
      ({ data }: { data: Partial<Payment> }) => {
        current = { ...base, ...data };
        return Promise.resolve({ ...current });
      },
    );
    db.payment.updateMany.mockImplementation(
      ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<Payment>;
      }) => {
        if (
          !current ||
          (where.status && current.status !== where.status) ||
          (where.providerRequestStartedAt === null &&
            current.providerRequestStartedAt !== null) ||
          (where.providerCustomerId === null &&
            current.providerCustomerId !== null) ||
          (typeof where.providerCustomerId === 'string' &&
            current.providerCustomerId !== where.providerCustomerId)
        )
          return Promise.resolve({ count: 0 });
        Object.assign(current, data);
        return Promise.resolve({ count: 1 });
      },
    );
    asaas.customer.mockResolvedValue('cus_123');
    asaas.createPix.mockResolvedValue(remote);
    asaas.getPayment.mockResolvedValue(remote);
    asaas.findPayment.mockResolvedValue(remote);
    asaas.qrCode.mockResolvedValue({
      encodedImage: 'aGVsbG8=',
      payload: '000201',
      expirationDate: '2027-09-26 23:59:59',
    });
    lifecycle.applyVerifiedPayment.mockImplementation(
      (event: VerifiedPayment) => {
        if (current) current.status = event.status;
        return Promise.resolve({ status: event.status });
      },
    );
    service = new AsaasPixService(
      db as unknown as PrismaService,
      asaas as unknown as AsaasService,
      lifecycle as unknown as PaymentsService,
      new OrderReservationConfig(),
    );
  });
  afterEach(() => vi.unstubAllEnvs());
  const linked = () => {
    current = {
      ...base,
      providerCustomerId: 'cus_123',
      providerPaymentId: 'pay_123',
      providerRequestStartedAt: now,
    };
  };

  it('creates one local intent, commits its send marker before HTTP, and returns normalized Pix', async () => {
    asaas.createPix.mockImplementation(() => {
      expect(current?.providerRequestStartedAt).toBeInstanceOf(Date);
      expect(current?.providerCustomerId).toBe('cus_123');
      return Promise.resolve(remote);
    });
    const result = await service.create(userId, orderId, { cpf });
    expect(result.payment).toMatchObject({
      id: paymentId,
      amount: '10.50',
      status: 'PENDING',
    });
    expect(result.pix?.payload).toBe('000201');
    expect(result.payment).not.toHaveProperty('providerRequestStartedAt');
    expect(result.payment).not.toHaveProperty('providerCustomerId');
    expect(asaas.createPix).toHaveBeenCalledWith({
      customer: 'cus_123',
      amount: '10.50',
      reference: paymentId,
      expiresAt: deadline,
    });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: { cpf },
      select: { id: true },
    });
    await service.create(userId, orderId, { cpf });
    expect(db.payment.create).toHaveBeenCalledTimes(1);
    expect(asaas.createPix).toHaveBeenCalledTimes(1);
  });
  it('does not write anything when Asaas is unconfigured', async () => {
    asaas.assertConfigured.mockImplementation(() => {
      throw new ServiceUnavailableException();
    });
    await expect(
      service.create(userId, orderId, { cpf }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('hides foreign orders and refuses expired orders before external calls', async () => {
    db.order.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.create(userId, orderId, { cpf }),
    ).rejects.toBeInstanceOf(NotFoundException);
    db.order.findFirst.mockResolvedValueOnce({
      ...order,
      expiresAt: new Date(0),
    });
    await expect(
      service.create(userId, orderId, { cpf }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(asaas.createPix).not.toHaveBeenCalled();
  });
  it('refuses a CPF different from the user record', async () => {
    db.order.findFirst.mockResolvedValue({
      ...order,
      user: { ...owner, cpf: '11144477735' },
    });
    await expect(
      service.create(userId, orderId, { cpf }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.payment.create).not.toHaveBeenCalled();
  });
  it('blocks additional active charges, including another environment', async () => {
    db.payment.findFirst.mockResolvedValue({ id: 'another' });
    await expect(
      service.create(userId, orderId, { cpf }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(asaas.createPix).not.toHaveBeenCalled();
  });
  it('recovers an uncertain creation after timeout without resending the POST', async () => {
    asaas.createPix.mockRejectedValueOnce(new GatewayTimeoutException());
    await expect(
      service.create(userId, orderId, { cpf }),
    ).rejects.toBeInstanceOf(GatewayTimeoutException);
    expect(current?.providerRequestStartedAt).toBeInstanceOf(Date);
    const result = await service.create(userId, orderId, { cpf });
    expect(result.pix).not.toBeNull();
    expect(asaas.findPayment).toHaveBeenCalledWith(paymentId);
    expect(asaas.createPix).toHaveBeenCalledTimes(1);
  });
  it('keeps an ambiguous missing charge pending rather than duplicating or releasing it', async () => {
    current = {
      ...base,
      providerCustomerId: 'cus_123',
      providerRequestStartedAt: now,
    };
    asaas.findPayment.mockResolvedValue(null);
    await expect(
      service.create(userId, orderId, { cpf }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(asaas.createPix).not.toHaveBeenCalled();
    expect(lifecycle.applyVerifiedPayment).not.toHaveBeenCalled();
    expect(current.status).toBe('PENDING');
  });
  it('allows retry after a definitive provider rejection', async () => {
    asaas.createPix.mockRejectedValueOnce(new AsaasRejectedRequest());
    await expect(
      service.create(userId, orderId, { cpf }),
    ).rejects.toBeInstanceOf(AsaasRejectedRequest);
    expect(current?.providerRequestStartedAt).toBeNull();
    await service.create(userId, orderId, { cpf });
    expect(asaas.createPix).toHaveBeenCalledTimes(2);
  });
  it('does not issue a POST when another request already claimed the intent', async () => {
    current = { ...base, providerCustomerId: 'cus_123' };
    db.payment.updateMany.mockImplementation(
      ({ data }: { data: Partial<Payment> }) => {
        if (data.providerRequestStartedAt) {
          current!.providerRequestStartedAt = now;
          return Promise.resolve({ count: 0 });
        }
        Object.assign(current!, data);
        return Promise.resolve({ count: 1 });
      },
    );
    await service.create(userId, orderId, { cpf });
    expect(asaas.createPix).not.toHaveBeenCalled();
  });
  it('uses remote RECEIVED as the only successful Pix status', async () => {
    linked();
    asaas.getPayment.mockResolvedValue({
      ...remote,
      status: 'RECEIVED',
      paymentDate: '2026-01-01',
    });
    expect((await service.reconcileOne(paymentId)).status).toBe('PAID');
    expect(lifecycle.applyVerifiedPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PAID',
        amount: '10.50',
        orderId,
        providerPaymentId: 'pay_123',
      }),
    );
  });
  it('preserves CONFIRMED payments under Pix review even after local expiration', async () => {
    linked();
    current!.expiresAt = new Date(0);
    asaas.getPayment.mockResolvedValue({ ...remote, status: 'CONFIRMED' });
    expect((await service.reconcileOne(paymentId)).status).toBe('PENDING');
    expect(asaas.deletePayment).not.toHaveBeenCalled();
    expect(lifecycle.applyVerifiedPayment).not.toHaveBeenCalled();
  });
  it('confirms remote deletion before releasing an expired payment', async () => {
    linked();
    current!.expiresAt = new Date(0);
    asaas.getPayment
      .mockResolvedValueOnce(remote)
      .mockResolvedValueOnce({ ...remote, deleted: true });
    expect((await service.reconcileOne(paymentId)).status).toBe('CANCELLED');
    expect(asaas.deletePayment).toHaveBeenCalledWith('pay_123');
    expect(lifecycle.applyVerifiedPayment).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CANCELLED' }),
    );
  });
  it('does not release if remote cancellation times out', async () => {
    linked();
    current!.expiresAt = new Date(0);
    asaas.deletePayment.mockRejectedValue(new GatewayTimeoutException());
    await expect(service.reconcileOne(paymentId)).rejects.toBeInstanceOf(
      GatewayTimeoutException,
    );
    expect(lifecycle.applyVerifiedPayment).not.toHaveBeenCalled();
  });
  it('settles a payment that wins the cancellation race instead of releasing it', async () => {
    linked();
    current!.expiresAt = new Date(0);
    asaas.getPayment.mockResolvedValueOnce(remote).mockResolvedValueOnce({
      ...remote,
      status: 'RECEIVED',
      paymentDate: '2026-01-01',
    });
    expect((await service.reconcileOne(paymentId)).status).toBe('PAID');
    expect(lifecycle.applyVerifiedPayment).toHaveBeenCalledTimes(1);
    expect(lifecycle.applyVerifiedPayment).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PAID' }),
    );
  });
  it('cancels an expired intent that was never sent', async () => {
    current = { ...base, expiresAt: new Date(0) };
    expect((await service.reconcileOne(paymentId)).status).toBe('CANCELLED');
    expect(asaas.getPayment).not.toHaveBeenCalled();
    expect(asaas.findPayment).not.toHaveBeenCalled();
  });
  it.each([
    { ...remote, amount: '11.00' },
    { ...remote, customer: 'cus_other' },
    { ...remote, id: 'pay_other' },
    { ...remote, billingType: 'BOLETO' },
  ])('rejects provider identity or amount mismatches', async (invalid) => {
    linked();
    asaas.getPayment.mockResolvedValue(invalid);
    await expect(service.reconcileOne(paymentId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(lifecycle.applyVerifiedPayment).not.toHaveBeenCalled();
  });
  it('ignores unrelated account charges', async () => {
    asaas.getPayment.mockResolvedValue({ ...remote, externalReference: '' });
    expect(await service.handleWebhook('pay_123')).toEqual({ received: true });
    expect(db.payment.findUnique).not.toHaveBeenCalled();
  });

  it('does not apply a creation response referencing a different local payment', async () => {
    asaas.createPix.mockResolvedValue({
      ...remote,
      externalReference: orderId,
    });
    await expect(
      service.create(userId, orderId, { cpf }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(lifecycle.applyVerifiedPayment).not.toHaveBeenCalled();
    expect(current?.providerPaymentId).toBeNull();
  });
  it('signals refunds for financial review instead of restocking paid purchases', async () => {
    linked();
    asaas.getPayment.mockResolvedValue({ ...remote, status: 'REFUNDED' });
    await expect(service.handleWebhook('pay_123')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(lifecycle.applyVerifiedPayment).not.toHaveBeenCalled();
  });
  it('scopes the Pix read to the authenticated user', async () => {
    linked();
    db.payment.findFirst.mockResolvedValue({ id: paymentId });
    await service.get(userId, orderId);
    expect(db.payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId, provider: 'asaas:sandbox', order: { userId } },
      }),
    );
  });
});

import { Test } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PaymentsModule } from './payments.module.js';
import { PaymentsService } from './payments.service.js';
import type { VerifiedPayment } from './payments.service.js';

const userId = 'a99d3fe9-a5fb-4f35-9218-88592106d61f';
const orderId = '92030503-e053-4138-95c4-af75a9f65066';
const paymentId = 'e0f58a11-0a82-4f35-b5c2-0846f362fe33';
const productId = '7e66b17f-a4de-41ae-9234-50898fe75c6f';
const secret = 'payments-test-secret-with-at-least-thirty-two-bytes';
const token = new JwtService().sign(
  {},
  {
    secret,
    subject: userId,
    issuer: 'jornadatcg-api',
    audience: 'jornadatcg',
    expiresIn: 900,
  },
);
const date = new Date('2026-01-01T12:00:00Z');
const payment = {
  id: paymentId,
  orderId,
  provider: 'test-provider',
  method: 'PIX' as const,
  status: 'PENDING' as const,
  amount: new Prisma.Decimal('0.30'),
  installments: 1,
  createdAt: date,
  updatedAt: date,
  paidAt: null,
  failedAt: null,
  expiresAt: null,
};
const order = {
  id: orderId,
  status: 'PENDING_PAYMENT',
  total: new Prisma.Decimal('0.30'),
  items: [{ productId, quantity: 3 }],
};
const event: VerifiedPayment = {
  provider: payment.provider,
  providerPaymentId: 'external-123',
  orderId,
  amount: '0.30',
  currency: 'BRL',
  status: 'PAID',
  paidAt: date,
};

describe('Payments', () => {
  let app: INestApplication<App>;
  let service: PaymentsService;
  const db = {
    user: { findUnique: vi.fn() },
    order: { findFirst: vi.fn(), updateMany: vi.fn() },
    payment: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    inventory: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  const list = (id = orderId) =>
    request(app.getHttpServer())
      .get(`/orders/${id}/payments`)
      .set('Authorization', `Bearer ${token}`);
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [PaymentsModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    app = module.createNestApplication();
    await app.init();
    service = app.get(PaymentsService);
  });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', secret);
    db.user.findUnique.mockResolvedValue({
      id: userId,
      name: 'Customer',
      email: 'customer@example.com',
      role: 'CUSTOMER',
    });
    db.$transaction.mockImplementation(
      (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        work(db as unknown as Prisma.TransactionClient),
    );
    db.order.findFirst.mockResolvedValue({ id: orderId });
    db.order.updateMany.mockResolvedValue({ count: 1 });
    db.payment.findMany.mockResolvedValue([payment]);
    db.payment.findUnique.mockResolvedValue({ ...payment, order });
    db.payment.findUniqueOrThrow.mockResolvedValue({
      ...payment,
      status: 'PAID',
      paidAt: date,
    });
    db.payment.findFirst.mockResolvedValue(null);
    db.payment.updateMany.mockResolvedValue({ count: 1 });
    db.inventory.updateMany.mockResolvedValue({ count: 1 });
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await app.close();
  });

  it('lists normalized payments for the authenticated owner', async () => {
    const response = await list().expect(200);
    expect(response.body[0]).toMatchObject({
      id: paymentId,
      amount: '0.30',
      status: 'PENDING',
      createdAt: date.toISOString(),
    });
    expect(response.body[0]).not.toHaveProperty('providerPaymentId');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(db.order.findFirst).toHaveBeenCalledWith({
      where: { id: orderId, userId },
      select: { id: true },
    });
  });
  it('returns an empty array for an order without payments', async () => {
    db.payment.findMany.mockResolvedValue([]);
    expect((await list().expect(200)).body).toEqual([]);
  });
  it('hides foreign and missing orders', async () => {
    db.order.findFirst.mockResolvedValue(null);
    await list().expect(404);
    expect(db.payment.findMany).not.toHaveBeenCalled();
  });
  it('requires a valid UUID and authentication', async () => {
    await list('invalid').expect(400);
    await request(app.getHttpServer())
      .get(`/orders/${orderId}/payments`)
      .expect(401);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('does not expose an endpoint for clients to declare a payment paid', async () => {
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/payments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'PAID' })
      .expect(404);
    await request(app.getHttpServer())
      .post('/payments/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send(event)
      .expect(404);
  });
  it('atomically marks payment and order as paid and moves reserved units to sold', async () => {
    expect(await service.applyVerifiedPayment(event)).toMatchObject({
      status: 'PAID',
      amount: '0.30',
      paidAt: date.toISOString(),
    });
    expect(db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
    expect(db.order.updateMany).toHaveBeenCalledWith({
      where: { id: orderId, status: 'PENDING_PAYMENT' },
      data: { status: 'PAID', paidAt: date },
    });
    expect(db.inventory.updateMany).toHaveBeenCalledWith({
      where: {
        productId,
        reservedQuantity: { gte: 3 },
        soldQuantity: { lte: 2147483644 },
      },
      data: {
        reservedQuantity: { decrement: 3 },
        soldQuantity: { increment: 3 },
      },
    });
    expect(db.payment.updateMany).toHaveBeenCalledWith({
      where: { id: paymentId, status: 'PENDING' },
      data: { status: 'PAID', paidAt: date },
    });
  });
  it.each(['PAID', 'FAILED', 'CANCELLED', 'EXPIRED'] as const)(
    'ignores repeated or stale %s notifications after payment',
    async (status) => {
      db.payment.findUnique.mockResolvedValue({
        ...payment,
        status: 'PAID',
        paidAt: date,
        order: { ...order, status: 'SHIPPED' },
      });
      expect(
        await service.applyVerifiedPayment({ ...event, status }),
      ).toMatchObject({ status: 'PAID' });
      expect(db.inventory.updateMany).not.toHaveBeenCalled();
      expect(db.order.updateMany).not.toHaveBeenCalled();
      expect(db.payment.updateMany).not.toHaveBeenCalled();
    },
  );
  it.each(['FAILED', 'EXPIRED', 'CANCELLED'] as const)(
    'cancels and releases stock on a verified terminal %s payment',
    async (status) => {
      db.payment.findUniqueOrThrow.mockResolvedValue({ ...payment, status });
      expect(
        await service.applyVerifiedPayment({ ...event, status }),
      ).toMatchObject({ status });
      expect(db.order.updateMany).toHaveBeenCalledWith({
        where: { id: orderId, status: 'PENDING_PAYMENT' },
        data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
      });
      expect(db.inventory.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            reservedQuantity: { decrement: 3 },
            availableQuantity: { increment: 3 },
          },
        }),
      );
    },
  );
  it('keeps the reservation if another payment is still pending', async () => {
    db.payment.findFirst.mockResolvedValue({ id: productId });
    await service.applyVerifiedPayment({ ...event, status: 'EXPIRED' });
    expect(db.payment.updateMany).toHaveBeenCalled();
    expect(db.order.updateMany).not.toHaveBeenCalled();
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });
  it('does not release inventory on repeated terminal notifications', async () => {
    db.payment.findUnique.mockResolvedValue({
      ...payment,
      status: 'EXPIRED',
      order: { ...order, status: 'CANCELLED' },
    });
    await service.applyVerifiedPayment({ ...event, status: 'EXPIRED' });
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });
  it.each(['CANCELLED', 'PAID', 'SHIPPED'])(
    'rejects late approval for an order in %s',
    async (status) => {
      db.payment.findUnique.mockResolvedValue({
        ...payment,
        order: { ...order, status },
      });
      await expect(service.applyVerifiedPayment(event)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(db.inventory.updateMany).not.toHaveBeenCalled();
    },
  );
  it('rejects approval after a payment has expired', async () => {
    db.payment.findUnique.mockResolvedValue({
      ...payment,
      status: 'EXPIRED',
      order,
    });
    await expect(service.applyVerifiedPayment(event)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });
  it.each([
    { ...event, amount: '0.31' },
    { ...event, amount: '1e2' },
    { ...event, amount: '0.00' },
    { ...event, currency: 'USD' },
    { ...event, paidAt: undefined },
    { ...event, paidAt: new Date('invalid') },
    { ...event, paidAt: new Date('2999-01-01') },
  ])('rejects mismatched or malformed payment data', async (invalid) => {
    await expect(async () =>
      service.applyVerifiedPayment(invalid as VerifiedPayment),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
    expect(db.payment.updateMany).not.toHaveBeenCalled();
  });
  it.each([
    { ...event, provider: 'another-provider' },
    { ...event, orderId: userId },
  ])('rejects payment identity mismatches', async (invalid) => {
    await expect(service.applyVerifiedPayment(invalid)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });
  it('checks the stored order total independently of the payment amount', async () => {
    db.payment.findUnique.mockResolvedValue({
      ...payment,
      order: { ...order, total: new Prisma.Decimal('0.50') },
    });
    await expect(service.applyVerifiedPayment(event)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(db.order.updateMany).not.toHaveBeenCalled();
  });
  it('rejects a second approved payment for the same order', async () => {
    db.payment.findFirst.mockResolvedValue({ id: productId });
    await expect(service.applyVerifiedPayment(event)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(db.order.updateMany).not.toHaveBeenCalled();
  });
  it('rejects insufficient reserves and does not mark the payment paid', async () => {
    db.inventory.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.applyVerifiedPayment(event)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(db.payment.updateMany).not.toHaveBeenCalled();
  });
  it('rejects concurrent changes of order status before moving inventory', async () => {
    db.order.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.applyVerifiedPayment(event)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });
  it('reports a failed compare-and-set of the payment so the transaction rolls back', async () => {
    db.payment.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.applyVerifiedPayment(event)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('retries serialization conflicts and recognizes a payment completed concurrently', async () => {
    db.$transaction.mockRejectedValueOnce({ code: 'P2034' });
    db.payment.findUnique.mockResolvedValue({
      ...payment,
      status: 'PAID',
      paidAt: date,
      order: { ...order, status: 'PAID' },
    });
    await service.applyVerifiedPayment(event);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });
  it('bounds retry attempts', async () => {
    db.$transaction.mockRejectedValue({ code: 'P2034' });
    await expect(service.applyVerifiedPayment(event)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(db.$transaction).toHaveBeenCalledTimes(3);
  });
  it('sanitizes database failures', async () => {
    db.$transaction.mockRejectedValue(new Error('database secret'));
    await expect(service.applyVerifiedPayment(event)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    const response = await list().expect(503);
    expect(response.text).not.toContain('database secret');
  });
});

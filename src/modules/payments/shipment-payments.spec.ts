import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PaymentsModule } from './payments.module.js';
import { PaymentsService } from './payments.service.js';
import { AsaasService } from './integrations/asaas.service.js';
import { AsaasPixService } from './asaas-pix.service.js';

const userId = 'a99d3fe9-a5fb-4f35-9218-88592106d61f';
const shipmentId = 'b99d3fe9-a5fb-4f35-9218-88592106d61f';
const paymentId = 'c99d3fe9-a5fb-4f35-9218-88592106d61f';
const secret = 'freight-payments-test-secret-at-least-thirty-two-bytes';
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
const cpf = '52998224725';
const owner = {
  id: userId,
  name: 'Fixture',
  email: 'fixture@example.invalid',
  cpf,
};
const now = new Date();
const base = {
  id: paymentId,
  orderId: null,
  shipmentId,
  provider: 'asaas:sandbox',
  method: 'PIX',
  status: 'PENDING',
  amount: new Prisma.Decimal('12.34'),
  installments: 1,
  createdAt: now,
  updatedAt: now,
  expiresAt: new Date(Date.now() + 600000),
  paidAt: null,
  failedAt: null,
  providerCustomerId: null as string | null,
  providerPaymentId: null as string | null,
  providerRequestStartedAt: null as Date | null,
};
const shipment = () => ({
  id: shipmentId,
  status: 'PENDING',
  shippingPaidAt: null,
  shippingCost: base.amount,
  user: owner,
  selectedQuote: {
    shipmentId,
    amount: base.amount,
    expiresAt: base.expiresAt,
    provider: 'superfrete:sandbox',
  },
  items: [
    {
      orderItem: { order: { status: 'PAID', payments: [{ status: 'PAID' }] } },
    },
  ],
});
const remote = () => ({
  id: 'pay_freight',
  customer: 'cus_fixture',
  externalReference: paymentId,
  amount: '12.34',
  status: 'PENDING',
  billingType: 'PIX',
  deleted: false,
  paymentDate: null,
});

describe('Freight Pix HTTP and settlement', () => {
  let app: INestApplication<App>;
  let current: typeof base | null;
  let lifecycle: PaymentsService;
  let pix: AsaasPixService;
  const db = {
    user: { findUnique: vi.fn(), update: vi.fn() },
    shipment: { findFirst: vi.fn(), updateMany: vi.fn() },
    payment: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    inventory: { updateMany: vi.fn() },
    order: { updateMany: vi.fn() },
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
  const post = () =>
    request(app.getHttpServer())
      .post(`/shipments/${shipmentId}/payments/pix`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cpf });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [PaymentsModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(AsaasService)
      .useValue(asaas)
      .compile();
    app = module.createNestApplication();
    await app.init();
    lifecycle = app.get(PaymentsService);
    pix = app.get(AsaasPixService);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', secret);
    current = null;
    asaas.provider = 'asaas:sandbox';
    db.user.findUnique.mockResolvedValue({ id: userId, role: 'CUSTOMER' });
    db.shipment.findFirst.mockResolvedValue(shipment());
    db.shipment.updateMany.mockResolvedValue({ count: 1 });
    db.$transaction.mockImplementation((work: (tx: unknown) => unknown) =>
      work(db),
    );
    db.payment.findUnique.mockImplementation(async () => current);
    db.payment.findUniqueOrThrow.mockImplementation(async () => current);
    db.payment.create.mockImplementation(
      async ({ data }: { data: Partial<typeof base> }) =>
        (current = { ...base, ...data }),
    );
    db.payment.updateMany.mockImplementation(
      async ({ data }: { data: Partial<typeof base> }) => {
        if (current) current = { ...current, ...data };
        return { count: 1 };
      },
    );
    asaas.customer.mockResolvedValue('cus_fixture');
    asaas.createPix.mockResolvedValue(remote());
    asaas.getPayment.mockResolvedValue(remote());
    asaas.qrCode.mockResolvedValue({
      payload: 'fixture-pix',
      encodedImage: 'YWJj',
      expirationDate: '2030-01-01',
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('creates a separate freight intent and charges only the stored quote price', async () => {
    const r = await post().expect(200);
    expect(r.body.payment).toMatchObject({
      orderId: null,
      shipmentId,
      amount: '12.34',
    });
    expect(asaas.createPix.mock.calls[0][0]).toMatchObject({
      amount: '12.34',
      reference: paymentId,
      description: 'Frete JornadaTCG',
    });
    expect(db.payment.create.mock.calls[0][0].data).not.toHaveProperty(
      'orderId',
    );
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });
  it('reuses an existing intent and never charges twice', async () => {
    await post().expect(200);
    await post().expect(200);
    expect(asaas.createPix).toHaveBeenCalledTimes(1);
    expect(db.payment.create).toHaveBeenCalledTimes(1);
  });
  it('rejects a missing or foreign shipment', async () => {
    db.shipment.findFirst.mockResolvedValue(null);
    await post().expect(404);
  });
  it('requires a valid unexpired quote', async () => {
    db.shipment.findFirst.mockResolvedValue({
      ...shipment(),
      selectedQuote: { ...shipment().selectedQuote, expiresAt: new Date(0) },
    });
    await post().expect(409);
    expect(asaas.createPix).not.toHaveBeenCalled();
  });
  it('does not charge refunded purchases', async () => {
    db.shipment.findFirst.mockResolvedValue({
      ...shipment(),
      items: [
        {
          orderItem: {
            order: { status: 'PAID', payments: [{ status: 'REFUNDED' }] },
          },
        },
      ],
    });
    await post().expect(409);
  });
  it('does not charge cancelled shipments', async () => {
    db.shipment.findFirst.mockResolvedValue({
      ...shipment(),
      status: 'CANCELLED',
    });
    await post().expect(409);
  });
  it('cannot charge real money for sandbox freight', async () => {
    asaas.provider = 'asaas:production';
    await post().expect(409);
  });
  it('recovers ambiguous provider failures by reference, without reposting', async () => {
    asaas.createPix.mockRejectedValueOnce(new Error('uncertain'));
    await post().expect(503);
    asaas.findPayment.mockResolvedValue(remote());
    await post().expect(200);
    expect(asaas.createPix).toHaveBeenCalledTimes(1);
  });
  it('gets only own freight payment', async () => {
    current = { ...base, status: 'PAID', providerPaymentId: 'pay_freight' };
    db.payment.findFirst.mockResolvedValue({ id: paymentId });
    await request(app.getHttpServer())
      .get(`/shipments/${shipmentId}/payments/pix`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(db.payment.findFirst.mock.calls[0][0].where).toMatchObject({
      shipmentId,
      shipment: { userId },
    });
  });
  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .post(`/shipments/${shipmentId}/payments/pix`)
      .send({ cpf })
      .expect(401);
  });
  it('rejects invalid CPF', async () => {
    await request(app.getHttpServer())
      .post(`/shipments/${shipmentId}/payments/pix`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cpf: '123' })
      .expect(400);
  });

  const event = () => ({
    provider: 'asaas:sandbox',
    providerPaymentId: 'pay_freight',
    orderId: null,
    shipmentId,
    amount: '12.34',
    currency: 'BRL' as const,
    status: 'PAID' as const,
    paidAt: new Date(),
  });
  const prepare = () => {
    current = {
      ...base,
      providerCustomerId: 'cus_fixture',
      providerPaymentId: 'pay_freight',
      providerRequestStartedAt: now,
    };
    db.payment.findUnique.mockImplementation(async () => ({
      ...current,
      shipment: shipment(),
      order: null,
    }));
  };
  it('settles freight and advances shipment without altering purchased stock or order', async () => {
    prepare();
    const r = await lifecycle.applyVerifiedPayment(event());
    expect(r.status).toBe('PAID');
    expect(db.shipment.updateMany.mock.calls[0][0]).toMatchObject({
      where: { status: 'PENDING', shippingPaidAt: null },
      data: { status: 'PREPARING' },
    });
    expect(db.order.updateMany).not.toHaveBeenCalled();
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });
  it('does not settle a mismatched amount', async () => {
    prepare();
    await expect(
      lifecycle.applyVerifiedPayment({ ...event(), amount: '99.00' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(db.shipment.updateMany).not.toHaveBeenCalled();
  });
  it('is idempotent for duplicate confirmation', async () => {
    prepare();
    await lifecycle.applyVerifiedPayment(event());
    await lifecycle.applyVerifiedPayment(event());
    expect(db.shipment.updateMany).toHaveBeenCalledTimes(1);
  });
  it('does not prepare shipment on failed payment', async () => {
    prepare();
    await lifecycle.applyVerifiedPayment({ ...event(), status: 'CANCELLED' });
    expect(current?.status).toBe('CANCELLED');
    expect(db.shipment.updateMany).not.toHaveBeenCalled();
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });
  it('handles shipment confirmation through shared Asaas reconciliation', async () => {
    prepare();
    asaas.getPayment.mockResolvedValue({
      ...remote(),
      status: 'RECEIVED',
      paymentDate: '2026-01-01',
    });
    await pix.reconcileOne(paymentId);
    expect(current?.status).toBe('PAID');
    expect(db.shipment.updateMany).toHaveBeenCalledTimes(1);
  });
  it('deletes expired remote charge before marking freight cancelled', async () => {
    prepare();
    current = { ...current!, expiresAt: new Date(0) };
    asaas.getPayment
      .mockResolvedValueOnce(remote())
      .mockResolvedValueOnce({ ...remote(), deleted: true });
    await pix.reconcileOne(paymentId);
    expect(asaas.deletePayment).toHaveBeenCalledWith('pay_freight');
    expect(current?.status).toBe('CANCELLED');
    expect(db.shipment.updateMany).not.toHaveBeenCalled();
  });
  it('handles a payment arriving during expiration', async () => {
    prepare();
    current = { ...current!, expiresAt: new Date(0) };
    asaas.getPayment
      .mockResolvedValueOnce(remote())
      .mockResolvedValueOnce({
        ...remote(),
        status: 'RECEIVED',
        paymentDate: '2026-01-01',
      });
    await pix.reconcileOne(paymentId);
    expect(current?.status).toBe('PAID');
  });
});

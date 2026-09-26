import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ShipmentsModule } from './shipments.module.js';

const userId = 'a99d3fe9-a5fb-4f35-9218-88592106d61f';
const id = 'b99d3fe9-a5fb-4f35-9218-88592106d61f';
const itemId = 'c99d3fe9-a5fb-4f35-9218-88592106d61f';
const addressId = 'd99d3fe9-a5fb-4f35-9218-88592106d61f';
const secret = 'shipment-requests-test-secret-at-least-thirty-two-bytes';
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
const body = { addressId, items: [{ orderItemId: itemId, quantity: 2 }] };
const record = () => ({
  id,
  userId,
  status: 'PENDING',
  shippingMethod: 'TO_BE_DEFINED',
  shippingCost: new Prisma.Decimal(0),
  addressSnapshot: { addressId, city: 'Cuiabá' },
  trackingCode: null,
  providerShipmentId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  items: [
    {
      orderItemId: itemId,
      quantity: 2,
      orderItem: {
        id: itemId,
        orderId: id,
        cardName: 'Snapshot',
        unitPrice: new Prisma.Decimal(10),
      },
    },
  ],
});
describe('Shipment requests HTTP', () => {
  let app: INestApplication<App>;
  const db = {
    user: { findUnique: vi.fn() },
    address: { findFirst: vi.fn() },
    orderItem: { findMany: vi.fn() },
    shipment: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  const create = (input: unknown = body, key = id) =>
    request(app.getHttpServer())
      .post('/shipments')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(input as object);
  const cancel = () =>
    request(app.getHttpServer())
      .post(`/shipments/${id}/cancel`)
      .set('Authorization', `Bearer ${token}`);
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ShipmentsModule],
    })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', secret);
    db.user.findUnique.mockResolvedValue({ id: userId, role: 'CUSTOMER' });
    db.$transaction.mockImplementation(
      (work: (tx: unknown) => Promise<unknown>) => work(db),
    );
    db.address.findFirst.mockResolvedValue({
      id: addressId,
      recipientName: 'Test',
      zipCode: '78000000',
      street: 'Rua',
      number: '1',
      complement: null,
      neighborhood: 'Centro',
      city: 'Cuiabá',
      state: 'MT',
    });
    db.orderItem.findMany.mockResolvedValue([
      { id: itemId, quantity: 5, shipmentItems: [{ quantity: 3 }] },
    ]);
    db.shipment.create.mockResolvedValue(record());
    db.shipment.findFirst.mockResolvedValue(record());
    db.shipment.update.mockResolvedValue({ ...record(), status: 'CANCELLED' });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('creates a pending request with address snapshot and unquoted freight', async () => {
    const response = await create().expect(200);
    expect(response.body).toMatchObject({
      id,
      status: 'PENDING',
      shippingCost: null,
      items: [{ quantity: 2, subtotal: '20.00' }],
    });
    expect(db.shipment.create.mock.calls[0][0].data).toMatchObject({
      userId,
      addressSnapshot: { addressId, city: 'Cuiabá' },
      items: { create: body.items },
    });
    expect(db.$transaction.mock.calls[0][1].isolationLevel).toBe(
      'Serializable',
    );
    expect(db.orderItem.findMany.mock.calls[0][0].where.order).toMatchObject({
      userId,
      paidAt: { not: null },
      payments: { some: { status: 'PAID' }, none: { status: 'REFUNDED' } },
    });
  });
  it('replays the same key without allocating twice', async () => {
    db.shipment.findUnique.mockResolvedValue(record());
    await create().expect(200);
    expect(db.shipment.create).not.toHaveBeenCalled();
    expect(db.address.findFirst).not.toHaveBeenCalled();
  });
  it.each(['payload', 'owner'])(
    'rejects reused key with different %s',
    async (kind) => {
      db.shipment.findUnique.mockResolvedValue({
        ...record(),
        ...(kind === 'owner'
          ? { userId: addressId }
          : { addressSnapshot: { addressId: id } }),
      });
      await create().expect(409);
    },
  );
  it('rejects insufficient remaining quantities', async () => {
    await create({
      ...body,
      items: [{ orderItemId: itemId, quantity: 3 }],
    }).expect(409);
    expect(db.shipment.create).not.toHaveBeenCalled();
  });
  it('rejects unpaid, refunded, unknown or foreign items excluded by eligibility filter', async () => {
    db.orderItem.findMany.mockResolvedValue([]);
    await create().expect(409);
  });
  it('rejects a foreign or missing address', async () => {
    db.address.findFirst.mockResolvedValue(null);
    await create().expect(404);
  });
  it.each([
    {},
    { ...body, items: [] },
    { ...body, items: [body.items[0], body.items[0]] },
    { ...body, items: [{ orderItemId: itemId, quantity: 0 }] },
    { ...body, items: [{ orderItemId: itemId, quantity: 1.5 }] },
    { ...body, items: [{ orderItemId: itemId, quantity: '1' }] },
    { ...body, shippingCost: 0 },
    { ...body, addressId: 'bad' },
  ])('rejects invalid body %#', async (input) => {
    await create(input).expect(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('requires an idempotency UUID', async () => {
    await create(body, 'bad').expect(400);
  });
  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .post('/shipments')
      .send(body)
      .expect(401);
  });
  it('cancels pending requests without deleting allocations', async () => {
    const response = await cancel().expect(200);
    expect(response.body.status).toBe('CANCELLED');
  });
  it('replays cancellation', async () => {
    db.shipment.findFirst.mockResolvedValue({
      ...record(),
      status: 'CANCELLED',
    });
    await cancel().expect(200);
    expect(db.shipment.update).not.toHaveBeenCalled();
  });
  it.each(['PREPARING', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED'])(
    'prevents cancellation in %s',
    async (status) => {
      db.shipment.findFirst.mockResolvedValue({ ...record(), status });
      await cancel().expect(409);
    },
  );
  it('prevents cancellation after freight was defined', async () => {
    db.shipment.findFirst.mockResolvedValue({
      ...record(),
      shippingMethod: 'PAC',
    });
    await cancel().expect(409);
  });
  it('hides foreign shipment', async () => {
    db.shipment.findFirst.mockResolvedValue(null);
    await cancel().expect(404);
    expect(db.shipment.findFirst.mock.calls[0][0].where).toEqual({
      id,
      userId,
    });
  });
  it('lists only own shipments with pagination', async () => {
    db.shipment.findMany.mockResolvedValue([record()]);
    db.shipment.count.mockResolvedValue(1);
    const response = await request(app.getHttpServer())
      .get('/shipments?page=1&pageSize=10')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body.total).toBe(1);
    expect(db.shipment.findMany.mock.calls[0][0]).toMatchObject({
      where: { userId },
      take: 10,
    });
  });
  it('gets one own shipment', async () => {
    await request(app.getHttpServer())
      .get(`/shipments/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
  it('retries serialization conflicts', async () => {
    db.$transaction.mockRejectedValueOnce({ code: 'P2034' });
    await create().expect(200);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });
  it('limits conflict retries', async () => {
    db.$transaction.mockRejectedValue({ code: 'P2034' });
    await create().expect(409);
    expect(db.$transaction).toHaveBeenCalledTimes(3);
  });
  it('sanitizes internal failures', async () => {
    db.$transaction.mockRejectedValue(new Error('secret'));
    const response = await create().expect(503);
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });
});

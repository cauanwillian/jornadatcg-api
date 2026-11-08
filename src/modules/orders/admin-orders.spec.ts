import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { OrdersModule } from './orders.module.js';
import { AdminOrderListPipe } from './dto/admin-order-input.dto.js';

const adminId = '11111111-1111-4111-8111-111111111111';
const customerId = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';
const itemId = '44444444-4444-4444-8444-444444444444';
const shipmentId = '55555555-5555-4555-8555-555555555555';
const date = new Date('2026-11-04T12:00:00.000Z');
const secret = 'admin-order-test-secret-at-least-thirty-two-bytes';
const token = new JwtService().sign(
  {},
  {
    secret,
    subject: adminId,
    issuer: 'jornadatcg-api',
    audience: 'jornadatcg',
    expiresIn: 900,
  },
);
const customer = {
  id: customerId,
  name: 'Cliente de demonstração',
  email: 'customer@example.com',
};
const item = {
  id: itemId,
  productId: null,
  cardName: 'Pikachu',
  cardNumber: '025',
  setName: 'Coleção',
  conditionName: 'Near Mint',
  languageName: 'Português',
  categoryName: null,
  quantity: 3,
  unitPrice: new Prisma.Decimal('0.10'),
  totalPrice: new Prisma.Decimal('0.30'),
};
const payment = {
  id: itemId,
  orderId,
  shipmentId: null,
  provider: 'asaas:sandbox',
  method: 'PIX',
  status: 'PAID',
  amount: new Prisma.Decimal('0.30'),
  installments: 1,
  createdAt: date,
  updatedAt: date,
  paidAt: date,
  failedAt: null,
  expiresAt: null,
  providerPaymentId: 'SECRET_REMOTE_PAYMENT',
  providerCustomerId: 'SECRET_REMOTE_CUSTOMER',
};
const order = {
  id: orderId,
  orderNumber: 42,
  status: 'PAID',
  subtotal: new Prisma.Decimal('0.30'),
  total: new Prisma.Decimal('0.30'),
  shippingAmount: new Prisma.Decimal(0),
  discountAmount: new Prisma.Decimal(0),
  createdAt: date,
  updatedAt: date,
  paidAt: date,
  cancelledAt: null,
  expiresAt: null,
  userId: customerId,
  user: {
    ...customer,
    passwordHash: 'SECRET_PASSWORD_HASH',
    cpf: 'SECRET_CPF',
    authVersion: 2,
  },
  items: [{ ...item, providerMetadata: 'SECRET_ITEM_METADATA' }],
  payments: [payment],
  checkoutKey: 'SECRET_CHECKOUT_KEY',
  shippingAddress: { street: 'SECRET_ADDRESS' },
};
const shipment = {
  id: shipmentId,
  status: 'PREPARING',
  createdAt: date,
  shippedAt: null,
  deliveredAt: null,
  trackingCode: null,
  shippingCost: new Prisma.Decimal('12.68'),
  shippingPaidAt: date,
  items: [{ orderItemId: itemId, quantity: 2 }],
  addressSnapshot: 'SECRET_ADDRESS',
  providerShipmentId: 'SECRET_REMOTE_SHIPMENT',
};

describe('Administrative orders HTTP', () => {
  let app: INestApplication;
  const db = {
    user: { findUnique: vi.fn() },
    order: {
      count: vi.fn(),
      aggregate: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    shipment: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  const get = (path = '/admin/orders') =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [OrdersModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', secret);
    db.user.findUnique.mockResolvedValue({
      id: adminId,
      name: 'Gestor',
      email: 'admin@example.com',
      role: 'ADMIN',
      authVersion: 0,
    });
    db.$transaction.mockImplementation((work) => work(db));
    db.order.count.mockImplementation(({ where }) =>
      Promise.resolve(where.AND ? 0 : 1),
    );
    db.order.aggregate.mockResolvedValue({
      _count: { _all: 1 },
      _sum: {
        subtotal: new Prisma.Decimal('0.30'),
        discountAmount: new Prisma.Decimal(0),
      },
    });
    db.order.findMany.mockResolvedValue([order]);
    db.order.findUnique.mockResolvedValue(order);
    db.shipment.findMany.mockResolvedValue([shipment]);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => app.close());

  it('requires authentication before reading orders', async () => {
    await request(app.getHttpServer()).get('/admin/orders').expect(401);
    await request(app.getHttpServer())
      .get(`/admin/orders/${orderId}`)
      .expect(401);
    expect(db.order.findMany).not.toHaveBeenCalled();
    expect(db.order.findUnique).not.toHaveBeenCalled();
  });
  it('rejects customer accounts, including tokens claiming ADMIN', async () => {
    db.user.findUnique.mockResolvedValue({
      id: adminId,
      name: 'Cliente',
      email: 'customer@example.com',
      role: 'CUSTOMER',
      authVersion: 0,
    });
    const forgedRole = new JwtService().sign(
      { role: 'ADMIN' },
      {
        secret,
        subject: adminId,
        issuer: 'jornadatcg-api',
        audience: 'jornadatcg',
        expiresIn: 900,
      },
    );
    await request(app.getHttpServer())
      .get('/admin/orders')
      .set('Authorization', `Bearer ${forgedRole}`)
      .expect(403);
    await get(`/admin/orders/${orderId}`).expect(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('lists all customer orders and global filtered summary without private fields', async () => {
    const response = await get().expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      items: [
        {
          id: orderId,
          orderNumber: 42,
          status: 'PAID',
          total: '0.30',
          createdAt: date.toISOString(),
          paidAt: date.toISOString(),
          cancelledAt: null,
          customer,
          quantity: 3,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      summary: {
        orderCount: 1,
        pendingCount: 0,
        confirmedCount: 1,
        confirmedAmount: '0.30',
      },
    });
    expect(response.text).not.toContain('SECRET_');
    expect(db.order.findMany.mock.calls[0][0].where).toEqual({});
    expect(db.order.findMany.mock.calls[0][0]).toMatchObject({
      skip: 0,
      take: 20,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(db.order.findMany.mock.calls[0][0].select.user.select).toEqual({
      id: true,
      name: true,
      email: true,
    });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
      maxWait: 5000,
      timeout: 15000,
    });
  });
  it('keeps financial totals exact beyond JavaScript safe fractional precision and independent of the current page', async () => {
    db.order.count.mockImplementation(({ where }) =>
      Promise.resolve(where.AND ? 4 : 41),
    );
    db.order.aggregate.mockResolvedValue({
      _count: { _all: 37 },
      _sum: {
        subtotal: new Prisma.Decimal('1000000000000000.02'),
        discountAmount: new Prisma.Decimal('0.01'),
      },
    });
    db.order.findMany.mockResolvedValue([]);
    const response = await get('/admin/orders?page=4&pageSize=10').expect(200);
    expect(response.body.summary).toEqual({
      orderCount: 41,
      pendingCount: 4,
      confirmedCount: 37,
      confirmedAmount: '1000000000000000.01',
    });
    expect(db.order.findMany.mock.calls[0][0]).toMatchObject({
      skip: 30,
      take: 10,
    });
    expect(db.order.aggregate.mock.calls[0][0]).not.toHaveProperty('skip');
  });
  it('combines status, exact order number, literal customer text and inclusive/exclusive date boundaries', async () => {
    const from = '2026-11-01T04:00:00.000Z';
    const to = '2026-11-05T04:00:00.000Z';
    await get()
      .query({
        status: 'PENDING_PAYMENT',
        orderNumber: '42',
        customer: ' Ana%_\\Nome ',
        from,
        to,
      })
      .expect(200);
    const where = db.order.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      status: 'PENDING_PAYMENT',
      orderNumber: 42,
      user: {
        OR: [
          { name: { contains: 'Ana\\%\\_\\\\Nome', mode: 'insensitive' } },
          { email: { contains: 'Ana\\%\\_\\\\Nome', mode: 'insensitive' } },
        ],
      },
      createdAt: { gte: new Date(from), lt: new Date(to) },
    });
    expect(db.order.aggregate.mock.calls[0][0].where.AND[0]).toEqual(where);
    expect(db.order.aggregate.mock.calls[0][0].where.AND[1]).toEqual({
      status: {
        in: ['PAID', 'PREPARING', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED'],
      },
      paidAt: { not: null },
      payments: { some: { status: 'PAID' }, none: { status: 'REFUNDED' } },
    });
    expect(db.order.count.mock.calls[1][0].where).toEqual({
      AND: [where, { status: 'PENDING_PAYMENT' }],
    });
  });
  it('reports net card sales after discounts and excludes legacy order freight', async () => {
    db.order.findMany.mockResolvedValue([
      {
        ...order,
        subtotal: new Prisma.Decimal('100.00'),
        discountAmount: new Prisma.Decimal('10.00'),
        shippingAmount: new Prisma.Decimal('12.68'),
        total: new Prisma.Decimal('102.68'),
      },
    ]);
    db.order.aggregate.mockResolvedValue({
      _count: { _all: 1 },
      _sum: {
        subtotal: new Prisma.Decimal('100.00'),
        discountAmount: new Prisma.Decimal('10.00'),
      },
    });
    const response = await get().expect(200);
    expect(response.body.summary.confirmedAmount).toBe('90.00');
    expect(response.body.items[0].total).toBe('102.68');
    expect(db.order.aggregate.mock.calls[0][0]._sum).toEqual({
      subtotal: true,
      discountAmount: true,
    });
  });
  it('returns empty totals with a zero decimal amount', async () => {
    db.order.count.mockResolvedValue(0);
    db.order.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { subtotal: null, discountAmount: null },
    });
    db.order.findMany.mockResolvedValue([]);
    const response = await get().expect(200);
    expect(response.body).toMatchObject({
      items: [],
      total: 0,
      summary: {
        orderCount: 0,
        pendingCount: 0,
        confirmedCount: 0,
        confirmedAmount: '0.00',
      },
    });
  });
  it.each([
    'page=0',
    'page=1000001',
    'page=1.2',
    'pageSize=101',
    'pageSize=0',
    'status=UNKNOWN',
    'status=PAID&status=CANCELLED',
    'orderNumber=0',
    'orderNumber=2147483648',
    'orderNumber=01',
    'customer=',
    'customer=a&customer=b',
    'unknown=value',
    'userId=someone',
    'from=2026-02-30T00%3A00%3A00Z',
    'to=2026-11-04',
    'from=2026-11-04T24%3A00%3A00Z',
    'from=2026-11-04T00%3A00%3A00%2B04%3A00',
    'from=2026-11-05T00%3A00%3A00Z&to=2026-11-04T00%3A00%3A00Z',
    'from=2026-11-04T00%3A00%3A00Z&to=2026-11-04T00%3A00%3A00Z',
    `customer=${'a'.repeat(201)}`,
  ])('rejects invalid query %s before querying orders', async (query) => {
    await get(`/admin/orders?${query}`).expect(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('validates leap days, optional milliseconds, page limits and all order statuses', () => {
    const pipe = new AdminOrderListPipe();
    expect(
      pipe.transform({
        from: '2024-02-29T00:00:00Z',
        to: '2024-02-29T00:00:00.1Z',
        page: '1000000',
        pageSize: '100',
      }),
    ).toMatchObject({
      page: 1000000,
      pageSize: 100,
      from: new Date('2024-02-29T00:00:00Z'),
    });
    for (const status of [
      'PAID',
      'PENDING_PAYMENT',
      'PREPARING',
      'READY_TO_SHIP',
      'SHIPPED',
      'DELIVERED',
      'CANCELLED',
    ])
      expect(pipe.transform({ status }).status).toBe(status);
    for (const invalid of [
      null,
      [],
      { from: [] },
      { status: [] },
      { customer: 1 },
      { orderNumber: ['1'] },
    ])
      expect(() => pipe.transform(invalid)).toThrow();
  });
  it('returns sanitized order, payments and associated shipment items, preserving nullable categories', async () => {
    const response = await get(`/admin/orders/${orderId}`).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.customer).toEqual(customer);
    expect(response.body.order.items[0]).toMatchObject({
      categoryName: null,
      unitPrice: '0.10',
      totalPrice: '0.30',
    });
    expect(response.body.payments[0]).toMatchObject({
      amount: '0.30',
      method: 'PIX',
      status: 'PAID',
      orderId,
    });
    expect(response.body.shipments).toEqual([
      {
        id: shipmentId,
        status: 'PREPARING',
        requestedAt: date.toISOString(),
        shippedAt: null,
        deliveredAt: null,
        trackingCode: null,
        shippingCost: '12.68',
        shippingPaidAt: date.toISOString(),
        items: [{ orderItemId: itemId, quantity: 2 }],
      },
    ]);
    expect(response.text).not.toContain('SECRET_');
    expect(db.shipment.findMany.mock.calls[0][0].where).toEqual({
      userId: customerId,
      items: { some: { orderItem: { orderId } } },
    });
    expect(db.shipment.findMany.mock.calls[0][0].select.items.where).toEqual({
      orderItem: { orderId },
    });
    expect(db.order.findUnique.mock.calls[0][0].where).toEqual({ id: orderId });
  });
  it('supports legacy orders without payments or shipments', async () => {
    db.order.findUnique.mockResolvedValue({
      ...order,
      payments: [],
      paidAt: null,
      status: 'PENDING_PAYMENT',
    });
    db.shipment.findMany.mockResolvedValue([]);
    const response = await get(`/admin/orders/${orderId}`).expect(200);
    expect(response.body.payments).toEqual([]);
    expect(response.body.shipments).toEqual([]);
    expect(response.body.order.paidAt).toBeNull();
  });
  it('returns 404 for an absent order and 400 for an invalid UUID', async () => {
    db.order.findUnique.mockResolvedValue(null);
    await get(`/admin/orders/${orderId}`).expect(404);
    expect(db.shipment.findMany).not.toHaveBeenCalled();
    db.$transaction.mockClear();
    await get('/admin/orders/not-a-uuid').expect(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it.each(['/admin/orders', `/admin/orders/${orderId}`])(
    'sanitizes database failures for %s',
    async (path) => {
      db.$transaction.mockRejectedValue(new Error('SECRET_DATABASE_URL'));
      const response = await get(path).expect(503);
      expect(response.text).not.toContain('SECRET_');
      expect(response.body.message).toBe(
        'Pedidos administrativos temporariamente indisponíveis.',
      );
    },
  );
  it('does not expose an administrative mutation route', async () => {
    await request(app.getHttpServer())
      .post(`/admin/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

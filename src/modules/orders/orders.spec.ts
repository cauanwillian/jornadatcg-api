import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { OrdersModule } from './orders.module.js';
import type { CartProduct, CartRecord } from '../cart/dto/cart-result.dto.js';
import type { OrderRecord } from './dto/order-result.dto.js';

const userId = 'a99d3fe9-a5fb-4f35-9218-88592106d61f';
const productId = '7e66b17f-a4de-41ae-9234-50898fe75c6f';
const cartId = '08993746-ea1a-4bd0-b7fa-9d3753ea4c2f';
const orderId = '92030503-e053-4138-95c4-af75a9f65066';
const key = 'e0f58a11-0a82-4f35-b5c2-0846f362fe33';
const secret = 'orders-test-secret-with-at-least-thirty-two-bytes';
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
const product: CartProduct = {
  id: productId,
  price: new Prisma.Decimal('0.10'),
  active: true,
  card: {
    id: productId,
    name: 'Pikachu',
    number: '025',
    imageSmall: null,
    imageLarge: null,
    set: { id: productId, name: 'Base' },
  },
  condition: { id: productId, name: 'Near Mint', code: 'NM', active: true },
  language: { id: productId, name: 'Português', code: 'PT-BR', active: true },
  category: { id: productId, name: 'Singles', active: true },
  inventory: { availableQuantity: 10 },
};
const cart: CartRecord = {
  id: cartId,
  updatedAt: new Date('2026-09-26T12:00:00Z'),
  items: [{ id: productId, quantity: 3, product }],
};
const order: OrderRecord = {
  id: orderId,
  orderNumber: 42,
  status: 'PENDING_PAYMENT',
  subtotal: new Prisma.Decimal('0.30'),
  total: new Prisma.Decimal('0.30'),
  shippingAmount: new Prisma.Decimal(0),
  discountAmount: new Prisma.Decimal(0),
  createdAt: cart.updatedAt,
  updatedAt: cart.updatedAt,
  paidAt: null,
  expiresAt: null,
  cancelledAt: null,
  items: [
    {
      id: productId,
      productId,
      cardName: 'Pikachu',
      cardNumber: '025',
      setName: 'Base',
      conditionName: 'Near Mint',
      languageName: 'Português',
      categoryName: 'Singles',
      quantity: 3,
      unitPrice: product.price,
      totalPrice: new Prisma.Decimal('0.30'),
    },
  ],
};
const cancelled: OrderRecord = {
  ...order,
  status: 'CANCELLED',
  cancelledAt: cart.updatedAt,
};

describe('Orders HTTP', () => {
  let app: INestApplication<App>;
  const db = {
    user: { findUnique: vi.fn() },
    cart: { findUnique: vi.fn(), update: vi.fn() },
    cartItem: { deleteMany: vi.fn() },
    order: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    inventory: { updateMany: vi.fn() },
    payment: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  };
  const checkout = (idempotencyKey: string | null = key) => {
    const call = request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`);
    return idempotencyKey === null
      ? call
      : call.set('Idempotency-Key', idempotencyKey);
  };
  const get = (path = '/orders') =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);
  const cancel = () =>
    request(app.getHttpServer())
      .post(`/orders/${orderId}/cancel`)
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
      id: userId,
      name: 'Customer',
      email: 'customer@example.com',
      role: 'CUSTOMER',
    });
    db.$transaction.mockImplementation(
      (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        callback(db as unknown as Prisma.TransactionClient),
    );
    db.cart.findUnique.mockResolvedValue(cart);
    db.cart.update.mockResolvedValue({ id: cartId });
    db.cartItem.deleteMany.mockResolvedValue({ count: 1 });
    db.order.findUnique.mockResolvedValue(null);
    db.order.findFirst.mockResolvedValue(order);
    db.order.findMany.mockResolvedValue([order]);
    db.order.count.mockResolvedValue(1);
    db.order.create.mockResolvedValue(order);
    db.order.updateMany.mockResolvedValue({ count: 1 });
    db.inventory.updateMany.mockResolvedValue({ count: 1 });
    db.payment.findFirst.mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await app.close();
  });

  it('creates snapshots with exact prices, reserves stock and clears cart in one serializable transaction', async () => {
    const response = await checkout()
      .send({ expectedSubtotal: '0.30' })
      .expect(200);
    expect(response.body).toMatchObject({
      id: orderId,
      status: 'PENDING_PAYMENT',
      subtotal: '0.30',
      total: '0.30',
      shippingAmount: '0.00',
      paidAt: null,
    });
    expect(response.body.items[0]).toMatchObject({
      cardName: 'Pikachu',
      cardNumber: '025',
      unitPrice: '0.10',
      totalPrice: '0.30',
    });
    expect(response.body).not.toHaveProperty('userId');
    expect(response.body).not.toHaveProperty('checkoutKey');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
    expect(db.cart.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId } }),
    );
    expect(db.inventory.updateMany).toHaveBeenCalledWith({
      where: {
        productId,
        availableQuantity: { gte: 3 },
        reservedQuantity: { lte: 2147483644 },
      },
      data: {
        availableQuantity: { decrement: 3 },
        reservedQuantity: { increment: 3 },
      },
    });
    const data = db.order.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId,
      checkoutKey: key,
      shippingAmount: 0,
      discountAmount: 0,
    });
    expect(data.subtotal.toFixed(2)).toBe('0.30');
    expect(data.items.create[0]).toMatchObject({
      productId,
      quantity: 3,
      cardName: 'Pikachu',
      cardNumber: '025',
      setName: 'Base',
      conditionName: 'Near Mint',
      languageName: 'Português',
      categoryName: 'Singles',
    });
    expect(data).not.toHaveProperty('shippingAddress');
    expect(db.cartItem.deleteMany).toHaveBeenCalledWith({ where: { cartId } });
  });

  it.each([order, cancelled])(
    'replays existing $status orders without touching cart or stock',
    async (existing) => {
      db.order.findUnique.mockResolvedValue(existing);
      await checkout(key.toUpperCase())
        .send({ expectedSubtotal: '0.30' })
        .expect(200);
      expect(db.order.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_checkoutKey: { userId, checkoutKey: key } },
        }),
      );
      expect(db.cart.findUnique).not.toHaveBeenCalled();
      expect(db.order.create).not.toHaveBeenCalled();
      expect(db.inventory.updateMany).not.toHaveBeenCalled();
      expect(db.cartItem.deleteMany).not.toHaveBeenCalled();
    },
  );
  it('rejects different amounts for a reused key', async () => {
    db.order.findUnique.mockResolvedValue(order);
    await checkout().send({ expectedSubtotal: '0.40' }).expect(409);
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });
  it.each([null, 'invalid', ''])(
    'rejects missing or invalid idempotency key %s',
    async (value) => {
      await checkout(value).send({ expectedSubtotal: '0.30' }).expect(400);
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );
  it.each([
    {},
    { expectedSubtotal: 0.3 },
    { expectedSubtotal: '0.00' },
    { expectedSubtotal: '-0.30' },
    { expectedSubtotal: '1e2' },
    { expectedSubtotal: '0.301' },
    { expectedSubtotal: '0,30' },
    { expectedSubtotal: '10000000000.00' },
    { expectedSubtotal: '0.30', userId },
    { expectedSubtotal: '0.30', status: 'PAID' },
  ])('rejects invalid checkout %j', async (body) => {
    await checkout().send(body).expect(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects an empty cart', async () => {
    db.cart.findUnique.mockResolvedValue(null);
    await checkout().send({ expectedSubtotal: '0.30' }).expect(409);
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });
  it('requires confirmation after a price change', async () => {
    await checkout().send({ expectedSubtotal: '0.20' }).expect(409);
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
    expect(db.cartItem.deleteMany).not.toHaveBeenCalled();
  });
  it.each([
    { ...product, active: false },
    { ...product, category: { ...product.category, active: false } },
    { ...product, condition: { ...product.condition, active: false } },
    { ...product, language: { ...product.language, active: false } },
    { ...product, inventory: null },
    { ...product, inventory: { availableQuantity: 2 } },
    { ...product, price: new Prisma.Decimal(0) },
  ])(
    'rejects unavailable cart products before writing',
    async (unavailable) => {
      db.cart.findUnique.mockResolvedValue({
        ...cart,
        items: [{ ...cart.items[0], product: unavailable }],
      });
      await checkout().send({ expectedSubtotal: '0.30' }).expect(409);
      expect(db.inventory.updateMany).not.toHaveBeenCalled();
    },
  );
  it.each([0, -1, 1.5, 1000])(
    'rejects corrupt cart quantity %s',
    async (quantity) => {
      db.cart.findUnique.mockResolvedValue({
        ...cart,
        items: [{ ...cart.items[0], quantity }],
      });
      await checkout().send({ expectedSubtotal: '0.30' }).expect(409);
      expect(db.inventory.updateMany).not.toHaveBeenCalled();
    },
  );
  it('rejects totals outside the database monetary range before reserving', async () => {
    db.cart.findUnique.mockResolvedValue({
      ...cart,
      items: [
        {
          ...cart.items[0],
          product: { ...product, price: new Prisma.Decimal('9999999999.99') },
        },
      ],
    });
    await checkout().send({ expectedSubtotal: '9999999999.99' }).expect(409);
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });
  it('rejects atomic reservation failure without creating an order or clearing the cart', async () => {
    db.inventory.updateMany.mockResolvedValue({ count: 0 });
    await checkout().send({ expectedSubtotal: '0.30' }).expect(409);
    expect(db.order.create).not.toHaveBeenCalled();
    expect(db.cartItem.deleteMany).not.toHaveBeenCalled();
  });
  it.each(['P2034', 'P2002'])(
    'retries transaction conflict %s and returns the concurrent checkout',
    async (code) => {
      db.$transaction.mockRejectedValueOnce({ code });
      db.order.findUnique.mockResolvedValue(order);
      await checkout().send({ expectedSubtotal: '0.30' }).expect(200);
      expect(db.$transaction).toHaveBeenCalledTimes(2);
      expect(db.inventory.updateMany).not.toHaveBeenCalled();
    },
  );
  it('limits retries and hides database details', async () => {
    db.$transaction.mockRejectedValue({
      code: 'P2034',
      message: 'internal secret',
    });
    const response = await checkout()
      .send({ expectedSubtotal: '0.30' })
      .expect(409);
    expect(db.$transaction).toHaveBeenCalledTimes(3);
    expect(response.text).not.toContain('internal secret');
  });
  it('sanitizes unexpected database errors', async () => {
    db.order.create.mockRejectedValue(new Error('secret connection string'));
    const response = await checkout()
      .send({ expectedSubtotal: '0.30' })
      .expect(503);
    expect(response.text).not.toContain('secret connection');
    expect(db.cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it('lists only own orders with pagination and status filtering', async () => {
    const response = await get('/orders?page=2&pageSize=5&status=PAID').expect(
      200,
    );
    expect(response.body).toMatchObject({ total: 1, page: 2, pageSize: 5 });
    expect(db.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId, status: 'PAID' },
        skip: 5,
        take: 5,
      }),
    );
    expect(db.order.count).toHaveBeenCalledWith({
      where: { userId, status: 'PAID' },
    });
  });
  it('returns an empty list', async () => {
    db.order.findMany.mockResolvedValue([]);
    db.order.count.mockResolvedValue(0);
    expect((await get().expect(200)).body).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
  });
  it.each([
    'page=0',
    'page=1.5',
    'pageSize=101',
    'pageSize=0',
    'status=INVALID',
    'userId=other',
    'page=1&page=2',
  ])('rejects invalid query %s', async (query) => {
    await get(`/orders?${query}`).expect(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('scopes order details to authenticated user', async () => {
    await get(`/orders/${orderId}`).expect(200);
    expect(db.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: orderId, userId } }),
    );
  });
  it('hides nonexistent and foreign orders from detail and cancellation', async () => {
    db.order.findFirst.mockResolvedValue(null);
    await get(`/orders/${orderId}`).expect(404);
    await cancel().expect(404);
    expect(db.order.updateMany).not.toHaveBeenCalled();
  });
  it('rejects invalid order UUIDs', async () => {
    await get('/orders/invalid').expect(400);
  });
  it('requires authentication for all routes', async () => {
    await request(app.getHttpServer())
      .post('/orders')
      .send({ expectedSubtotal: '0.30' })
      .expect(401);
    await request(app.getHttpServer()).get('/orders').expect(401);
    await request(app.getHttpServer()).get(`/orders/${orderId}`).expect(401);
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/cancel`)
      .expect(401);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('cancels pending orders and releases exactly their reserved quantities', async () => {
    db.order.findFirst
      .mockResolvedValueOnce(order)
      .mockResolvedValue(cancelled);
    expect((await cancel().expect(200)).body.status).toBe('CANCELLED');
    expect(db.order.updateMany).toHaveBeenCalledWith({
      where: { id: orderId, userId, status: 'PENDING_PAYMENT' },
      data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
    });
    expect(db.inventory.updateMany).toHaveBeenCalledWith({
      where: {
        productId,
        reservedQuantity: { gte: 3 },
        availableQuantity: { lte: 2147483644 },
      },
      data: {
        availableQuantity: { increment: 3 },
        reservedQuantity: { decrement: 3 },
      },
    });
    expect(db.cart.update).not.toHaveBeenCalled();
  });
  it('does not release stock again when cancellation is repeated', async () => {
    db.order.findFirst.mockResolvedValue(cancelled);
    await cancel().expect(200);
    expect(db.order.updateMany).not.toHaveBeenCalled();
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });
  it.each(['PAID', 'PREPARING', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED'])(
    'blocks cancellation of %s orders',
    async (status) => {
      db.order.findFirst.mockResolvedValue({ ...order, status });
      await cancel().expect(409);
      expect(db.inventory.updateMany).not.toHaveBeenCalled();
    },
  );
  it('blocks cancellation while payment is in progress or confirmed', async () => {
    db.payment.findFirst.mockResolvedValue({ id: key });
    await cancel().expect(409);
    expect(db.payment.findFirst).toHaveBeenCalledWith({
      where: { orderId, status: { in: ['PENDING', 'PAID', 'REFUNDED'] } },
      select: { id: true },
    });
    expect(db.order.updateMany).not.toHaveBeenCalled();
  });
  it('blocks cancellation if the order changed before its transition', async () => {
    db.order.updateMany.mockResolvedValue({ count: 0 });
    await cancel().expect(409);
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });
  it('reports inconsistent stock without hiding it as successful cancellation', async () => {
    db.inventory.updateMany.mockResolvedValue({ count: 0 });
    await cancel().expect(409);
  });
  it('groups legacy repeated product rows before releasing stock', async () => {
    db.order.findFirst
      .mockResolvedValueOnce({
        ...order,
        items: [order.items[0], order.items[0]],
      })
      .mockResolvedValue(cancelled);
    await cancel().expect(200);
    expect(db.inventory.updateMany).toHaveBeenCalledTimes(1);
    expect(db.inventory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          availableQuantity: { increment: 6 },
          reservedQuantity: { decrement: 6 },
        },
      }),
    );
  });
  it('rejects cancellation if a reserved product has been removed', async () => {
    db.order.findFirst.mockResolvedValue({
      ...order,
      items: [{ ...order.items[0], productId: null }],
    });
    await cancel().expect(409);
    expect(db.order.updateMany).not.toHaveBeenCalled();
  });
});

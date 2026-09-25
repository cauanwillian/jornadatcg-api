import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { CartModule } from './cart.module.js';
import type { CartProduct, CartRecord } from './dto/cart-result.dto.js';

const userId = 'a99d3fe9-a5fb-4f35-9218-88592106d61f';
const productId = '7e66b17f-a4de-41ae-9234-50898fe75c6f';
const cartId = '08993746-ea1a-4bd0-b7fa-9d3753ea4c2f';
const otherUserId = '92030503-e053-4138-95c4-af75a9f65066';
const secret = 'cart-test-secret-with-at-least-thirty-two-bytes';
const tokenFor = (subject: string) =>
  new JwtService().sign(
    {},
    {
      secret,
      subject,
      issuer: 'jornadatcg-api',
      audience: 'jornadatcg',
      expiresIn: 900,
    },
  );
const token = tokenFor(userId);
const product: CartProduct = {
  id: productId,
  price: new Prisma.Decimal('0.10'),
  active: true,
  card: {
    id: productId,
    name: 'Pikachu',
    number: '58',
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
  updatedAt: new Date('2026-09-24T12:00:00Z'),
  items: [{ id: productId, quantity: 3, product }],
};

describe('User cart HTTP', () => {
  let app: INestApplication<App>;
  const db = {
    user: { findUnique: vi.fn() },
    product: { findUnique: vi.fn() },
    cart: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    cartItem: {
      findUnique: vi.fn(),
      count: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    inventory: { update: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  const get = () =>
    request(app.getHttpServer())
      .get('/cart')
      .set('Authorization', `Bearer ${token}`);
  const put = (path = `/cart/items/${productId}`) =>
    request(app.getHttpServer())
      .put(path)
      .set('Authorization', `Bearer ${token}`);
  const remove = (path: string) =>
    request(app.getHttpServer())
      .delete(path)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [CartModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', secret);
    db.user.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({
          id: where.id,
          name: 'Customer',
          email: 'customer@example.com',
          role: 'CUSTOMER',
        }),
    );
    db.$transaction.mockImplementation(
      (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        callback(db as unknown as Prisma.TransactionClient),
    );
    db.product.findUnique.mockResolvedValue(product);
    db.cart.findUnique.mockResolvedValue(cart);
    db.cart.upsert.mockResolvedValue({ id: cartId });
    db.cart.update.mockResolvedValue({ id: cartId });
    db.cartItem.findUnique.mockResolvedValue(null);
    db.cartItem.count.mockResolvedValue(0);
    db.cartItem.upsert.mockResolvedValue({ id: productId });
    db.cartItem.deleteMany.mockResolvedValue({ count: 1 });
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await app.close();
  });

  it('returns an empty cart without creating records', async () => {
    db.cart.findUnique.mockResolvedValue(null);
    const response = await get().expect(200);
    expect(response.body).toEqual({
      id: null,
      updatedAt: null,
      items: [],
      summary: {
        itemCount: 0,
        totalQuantity: 0,
        subtotal: '0.00',
        allItemsAvailable: false,
      },
    });
    expect(db.cart.upsert).not.toHaveBeenCalled();
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('returns customer cart with exact decimal totals and no internal stock fields', async () => {
    const response = await get().expect(200);
    expect(response.body.summary).toEqual({
      itemCount: 1,
      totalQuantity: 3,
      subtotal: '0.30',
      allItemsAvailable: true,
    });
    expect(response.body.items[0]).toMatchObject({
      productId,
      quantity: 3,
      unitPrice: '0.10',
      subtotal: '0.30',
      available: true,
    });
    expect(response.body).not.toHaveProperty('userId');
    expect(response.text).not.toContain('reservedQuantity');
    expect(response.text).not.toContain('soldQuantity');
  });

  it('adds or replaces a quantity without incrementing it on repeated PUTs', async () => {
    await put().send({ quantity: 3 }).expect(200);
    await put().send({ quantity: 3 }).expect(200);
    expect(db.cart.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId }, create: { userId } }),
    );
    for (const [args] of db.cartItem.upsert.mock.calls) {
      expect(args).toEqual({
        where: { cartId_productId: { cartId, productId } },
        create: { cartId, productId, quantity: 3 },
        update: { quantity: 3 },
        select: { id: true },
      });
    }
    expect(db.inventory.update).not.toHaveBeenCalled();
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { quantity: 0 },
    { quantity: -1 },
    { quantity: 1.5 },
    { quantity: '2' },
    { quantity: 1000 },
    { quantity: null },
    { quantity: 3, userId: otherUserId },
    { quantity: 3, price: '0.01' },
    [],
  ])('rejects invalid or untrusted item input %j', async (body) => {
    await put().send(body).expect(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('validates product UUID on update and delete', async () => {
    await put('/cart/items/invalid').send({ quantity: 1 }).expect(400);
    await remove('/cart/items/invalid').expect(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing product', async () => {
    db.product.findUnique.mockResolvedValue(null);
    await put().send({ quantity: 1 }).expect(404);
    expect(db.cart.upsert).not.toHaveBeenCalled();
  });

  it.each([
    { active: false },
    { inventory: null },
    { inventory: { availableQuantity: 0 } },
    { inventory: { availableQuantity: 2 } },
    { price: new Prisma.Decimal(0) },
    { condition: { ...product.condition, active: false } },
    { language: { ...product.language, active: false } },
    { category: { ...product.category, active: false } },
  ])(
    'rejects unavailable products or insufficient stock (%j)',
    async (override) => {
      db.product.findUnique.mockResolvedValue({ ...product, ...override });
      await put().send({ quantity: 3 }).expect(409);
      expect(db.cart.upsert).not.toHaveBeenCalled();
    },
  );

  it('enforces the distinct item limit but allows updates to an existing item', async () => {
    db.cartItem.count.mockResolvedValue(100);
    await put().send({ quantity: 3 }).expect(409);
    expect(db.cartItem.upsert).not.toHaveBeenCalled();
    db.cartItem.findUnique.mockResolvedValue({ id: productId });
    await put().send({ quantity: 3 }).expect(200);
  });

  it('recalculates prices and flags stock changes without silently removing items', async () => {
    db.cart.findUnique.mockResolvedValue({
      ...cart,
      items: [
        {
          id: productId,
          quantity: 3,
          product: {
            ...product,
            price: new Prisma.Decimal('1.25'),
            inventory: { availableQuantity: 2 },
          },
        },
      ],
    });
    const response = await get().expect(200);
    expect(response.body.items[0]).toMatchObject({
      quantity: 3,
      unitPrice: '1.25',
      subtotal: '3.75',
      available: false,
      unavailableReason: 'INSUFFICIENT_STOCK',
    });
    expect(response.body.summary.allItemsAvailable).toBe(false);
    expect(db.cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it('flags inactive cart items while keeping the cart readable', async () => {
    db.cart.findUnique.mockResolvedValue({
      ...cart,
      items: [{ ...cart.items[0], product: { ...product, active: false } }],
    });
    const response = await get().expect(200);
    expect(response.body.items[0].unavailableReason).toBe('PRODUCT_INACTIVE');
  });

  it('removes only the selected product from the current user cart', async () => {
    db.cart.findUnique
      .mockResolvedValueOnce({ id: cartId })
      .mockResolvedValueOnce({ ...cart, items: [] });
    const response = await remove(`/cart/items/${productId}`).expect(200);
    expect(db.cart.findUnique.mock.calls[0][0].where).toEqual({ userId });
    expect(db.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { cartId, productId },
    });
    expect(response.body.items).toEqual([]);
  });

  it('clears only the current user cart', async () => {
    db.cart.findUnique
      .mockResolvedValueOnce({ id: cartId })
      .mockResolvedValueOnce({ ...cart, items: [] });
    await remove('/cart').expect(200);
    expect(db.cartItem.deleteMany).toHaveBeenCalledWith({ where: { cartId } });
  });

  it('treats deletion of an absent cart as an idempotent empty result', async () => {
    db.cart.findUnique.mockResolvedValue(null);
    await remove('/cart').expect(200);
    await remove(`/cart/items/${productId}`).expect(200);
    expect(db.cartItem.deleteMany).not.toHaveBeenCalled();
    expect(db.cart.upsert).not.toHaveBeenCalled();
  });

  it('derives cart ownership from the authenticated user even with a forged query', async () => {
    const otherToken = tokenFor(otherUserId);
    db.cart.findUnique.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get(`/cart?userId=${userId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(db.cart.findUnique.mock.calls[0][0].where).toEqual({
      userId: otherUserId,
    });
    await request(app.getHttpServer())
      .put(`/cart/items/${productId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ quantity: 3 })
      .expect(200);
    expect(db.cart.upsert.mock.calls[0][0].where).toEqual({
      userId: otherUserId,
    });
  });

  it.each(['get', 'put', 'delete'] as const)(
    'rejects missing authentication for %s',
    async (method) => {
      const path = method === 'put' ? `/cart/items/${productId}` : '/cart';
      const req = request(app.getHttpServer())[method](path);
      if (method === 'put') req.send({ quantity: 3 });
      await req.expect(401);
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['P2002', 'P2034'])(
    'retries concurrent cart creation/update (%s)',
    async (code) => {
      db.cartItem.upsert
        .mockRejectedValueOnce({ code })
        .mockResolvedValueOnce({ id: productId });
      await put().send({ quantity: 3 }).expect(200);
      expect(db.$transaction).toHaveBeenCalledTimes(2);
      expect(db.product.findUnique).toHaveBeenCalledTimes(2);
    },
  );

  it('bounds concurrent retries and returns a conflict', async () => {
    db.$transaction.mockRejectedValue({ code: 'P2034' });
    await put().send({ quantity: 3 }).expect(409);
    expect(db.$transaction).toHaveBeenCalledTimes(3);
  });

  it('sanitizes database errors without returning partial success', async () => {
    db.cartItem.upsert.mockRejectedValue(new Error('private database details'));
    const response = await put().send({ quantity: 3 }).expect(503);
    expect(response.text).not.toContain('private');
    expect(db.cart.findUnique).not.toHaveBeenCalled();
  });
});

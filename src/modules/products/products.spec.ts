import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ProductsModule } from './products.module.js';
import type { ProductRecord } from './dto/product-result.dto.js';

const id = 'a99d3fe9-a5fb-4f35-9218-88592106d61f';
const secret = 'products-test-secret-with-at-least-32-bytes';
const jwt = new JwtService();
const token = jwt.sign(
  {},
  {
    secret,
    subject: id,
    issuer: 'jornadatcg-api',
    audience: 'jornadatcg',
    expiresIn: 900,
  },
);
const input = {
  cardId: id,
  conditionId: id,
  languageId: id,
  categoryId: id,
  price: '25.90',
  availableQuantity: 5,
};
const product: ProductRecord = {
  id,
  price: new Prisma.Decimal('25.90'),
  observation: null,
  active: true,
  createdAt: new Date('2026-09-24T12:00:00Z'),
  updatedAt: new Date('2026-09-24T12:00:00Z'),
  card: {
    id,
    externalId: 'base1-58',
    name: 'Pikachu',
    number: '58',
    imageSmall: null,
    imageLarge: null,
    set: { id, name: 'Base', externalId: 'base1' },
  },
  category: { id, name: 'Singles', slug: 'singles', active: true },
  condition: { id, name: 'Near Mint', code: 'NM', active: true },
  language: { id, name: 'Português', code: 'PT', active: true },
  inventory: {
    availableQuantity: 5,
    reservedQuantity: 2,
    soldQuantity: 3,
    updatedAt: new Date('2026-09-24T12:00:00Z'),
  },
};

describe('Administrative products HTTP', () => {
  let app: INestApplication<App>;
  const reference = () => ({
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
  });
  const db = {
    user: { findUnique: vi.fn() },
    card: { findUnique: vi.fn() },
    product: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    inventory: { updateMany: vi.fn() },
    category: reference(),
    condition: reference(),
    language: reference(),
    $transaction: vi.fn(),
  };
  const get = (path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);
  const post = (path: string) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`);
  const patch = (path: string) =>
    request(app.getHttpServer())
      .patch(path)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [ProductsModule] })
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
      id,
      name: 'Admin',
      email: 'admin@example.com',
      role: 'ADMIN',
    });
    db.$transaction.mockImplementation(
      (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        callback(db as unknown as Prisma.TransactionClient),
    );
    db.card.findUnique.mockResolvedValue({ id });
    for (const model of [db.category, db.condition, db.language]) {
      model.findFirst.mockResolvedValue({ id });
      model.findMany.mockResolvedValue([]);
      model.create.mockResolvedValue({ id });
    }
    db.product.create.mockResolvedValue(product);
    db.product.update.mockResolvedValue(product);
    db.product.findUnique.mockResolvedValue(product);
    db.product.findUniqueOrThrow.mockResolvedValue(product);
    db.product.findMany.mockResolvedValue([product]);
    db.product.count.mockResolvedValue(1);
    db.inventory.updateMany.mockResolvedValue({ count: 1 });
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await app.close();
  });

  it('creates a product and initial inventory atomically with decimal price', async () => {
    const response = await post('/products').send(input).expect(201);
    expect(response.body.price).toBe('25.90');
    expect(db.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          cardId: id,
          categoryId: id,
          languageId: id,
          conditionId: id,
          price: new Prisma.Decimal('25.90'),
          inventory: {
            create: {
              availableQuantity: 5,
              reservedQuantity: 0,
              soldQuantity: 0,
            },
          },
        },
      }),
    );
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(db.category.findFirst).toHaveBeenCalledWith({
      where: { id, active: true },
      select: { id: true },
    });
  });

  it('defaults initial available stock to zero', async () => {
    const { availableQuantity: _quantity, ...body } = input;
    await post('/products').send(body).expect(201);
    expect(
      db.product.create.mock.calls[0][0].data.inventory.create
        .availableQuantity,
    ).toBe(0);
  });

  it.each([
    '0',
    '-1',
    '12.345',
    '1e2',
    '1,99',
    '10000000000.00',
    '01.20',
    '',
    25.9,
    null,
  ])('rejects invalid price %j', async (price) => {
    await post('/products')
      .send({ ...input, price })
      .expect(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it.each(['0.01', '9999999999.99'])(
    'accepts valid decimal boundary %s',
    async (price) => {
      await post('/products')
        .send({ ...input, price })
        .expect(201);
      expect(db.product.create.mock.calls[0][0].data.price.toFixed(2)).toBe(
        price,
      );
    },
  );

  it.each([-1, 1.5, '5', 2147483648, null])(
    'rejects invalid initial quantity %j',
    async (availableQuantity) => {
      await post('/products')
        .send({ ...input, availableQuantity })
        .expect(400);
      expect(db.product.create).not.toHaveBeenCalled();
    },
  );

  it.each(['cardId', 'conditionId', 'languageId', 'categoryId'])(
    'requires a valid %s',
    async (field) => {
      await post('/products')
        .send({ ...input, [field]: 'invalid' })
        .expect(400);
    },
  );

  it.each(['card', 'category', 'condition', 'language'] as const)(
    'rejects absent or inactive %s before creating anything',
    async (model) => {
      if (model === 'card') db.card.findUnique.mockResolvedValue(null);
      else db[model].findFirst.mockResolvedValue(null);
      await post('/products').send(input).expect(400);
      expect(db.product.create).not.toHaveBeenCalled();
    },
  );

  it('sanitizes an atomic create failure without a separate stock write', async () => {
    db.product.create.mockRejectedValue(new Error('private database URL'));
    const response = await post('/products').send(input).expect(503);
    expect(response.text).not.toContain('private');
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });

  it('updates price, observation and active status without touching stock', async () => {
    await patch(`/products/${id}`)
      .send({ price: '30.50', observation: null, active: false })
      .expect(200);
    expect(db.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          price: new Prisma.Decimal('30.50'),
          observation: null,
          active: false,
        },
      }),
    );
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { availableQuantity: 9 },
    { reservedQuantity: 2 },
    { active: 'false' },
    { observation: 12 },
  ])('rejects invalid product patch %j', async (body) => {
    await patch(`/products/${id}`).send(body).expect(400);
    expect(db.product.update).not.toHaveBeenCalled();
  });

  it('validates changed references when patching', async () => {
    db.language.findFirst.mockResolvedValue(null);
    await patch(`/products/${id}`).send({ languageId: id }).expect(400);
    expect(db.product.update).not.toHaveBeenCalled();
  });

  it('updates available stock using compare-and-set, preserving reserved and sold', async () => {
    const response = await patch(`/products/${id}/inventory`)
      .send({ availableQuantity: 8, expectedAvailableQuantity: 5 })
      .expect(200);
    expect(db.inventory.updateMany).toHaveBeenCalledWith({
      where: { productId: id, availableQuantity: 5 },
      data: { availableQuantity: 8 },
    });
    expect(response.body.inventory.reservedQuantity).toBe(2);
    expect(response.body.inventory.soldQuantity).toBe(3);
  });

  it('returns 409 instead of overwriting concurrent stock changes', async () => {
    db.inventory.updateMany.mockResolvedValue({ count: 0 });
    await patch(`/products/${id}/inventory`)
      .send({ availableQuantity: 8, expectedAvailableQuantity: 5 })
      .expect(409);
    expect(db.product.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it.each([
    {},
    { availableQuantity: 5 },
    { availableQuantity: -1, expectedAvailableQuantity: 5 },
    { availableQuantity: 0, expectedAvailableQuantity: '5' },
    { availableQuantity: 0, expectedAvailableQuantity: 5, soldQuantity: 0 },
  ])('rejects unsafe inventory body %j', async (body) => {
    await patch(`/products/${id}/inventory`).send(body).expect(400);
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });

  it('retries serialization failures and rechecks the stock expectation', async () => {
    db.inventory.updateMany
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockResolvedValueOnce({ count: 0 });
    await patch(`/products/${id}/inventory`)
      .send({ availableQuantity: 8, expectedAvailableQuantity: 5 })
      .expect(409);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });

  it('limits serialization retries', async () => {
    db.$transaction.mockRejectedValue({ code: 'P2034' });
    await post('/products').send(input).expect(409);
    expect(db.$transaction).toHaveBeenCalledTimes(3);
  });

  it('lists paginated products with filters and a precise price string', async () => {
    db.product.count.mockResolvedValue(12);
    const response = await get(
      '/products?name=pika&active=false&page=2&limit=5',
    ).expect(200);
    expect(response.body.pagination).toEqual({
      page: 2,
      limit: 5,
      total: 12,
      totalPages: 3,
    });
    expect(response.body.data[0].price).toBe('25.90');
    expect(db.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          active: false,
          card: { name: { contains: 'pika', mode: 'insensitive' } },
        },
        skip: 5,
        take: 5,
      }),
    );
  });

  it('returns an empty page when no products match', async () => {
    db.product.count.mockResolvedValue(0);
    db.product.findMany.mockResolvedValue([]);
    await get('/products').expect(200, {
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });

  it.each([
    'limit=101',
    'page=0',
    'page=10001',
    'active=1',
    'cardId=abc',
    'name=',
    'limit=5&limit=6',
    'unknown=value',
  ])('validates query %s', async (query) => {
    await get(`/products?${query}`).expect(400);
    expect(db.product.findMany).not.toHaveBeenCalled();
  });

  it('gets product details and handles missing products', async () => {
    await get(`/products/${id}`).expect(200);
    db.product.findUnique.mockResolvedValue(null);
    await get(`/products/${id}`).expect(404);
    await patch(`/products/${id}`).send({ active: false }).expect(404);
    await patch(`/products/${id}/inventory`)
      .send({ availableQuantity: 0, expectedAvailableQuantity: 0 })
      .expect(404);
  });

  it('handles legacy products with no inventory without inventing stock', async () => {
    db.product.findUnique.mockResolvedValue({ ...product, inventory: null });
    const response = await get(`/products/${id}`).expect(200);
    expect(response.body.inventory).toBeNull();
  });

  it('lists active reference options before the UUID route', async () => {
    await get('/products/options').expect(200, {
      categories: [],
      conditions: [],
      languages: [],
    });
    expect(db.language.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
  });

  it.each([
    [
      'categories',
      { name: 'Singles', slug: 'SINGLES' },
      'category',
      { name: 'Singles', slug: 'singles' },
    ],
    [
      'conditions',
      { name: 'Near Mint', code: 'nm' },
      'condition',
      { name: 'Near Mint', code: 'NM' },
    ],
    [
      'languages',
      { name: 'Português', code: 'pt-br' },
      'language',
      { name: 'Português', code: 'PT-BR' },
    ],
  ] as const)('creates reference %s', async (path, body, model, expected) => {
    await post(`/products/${path}`).send(body).expect(201);
    expect(db[model].create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ...expected, active: true }),
      }),
    );
  });

  it('rejects malformed reference codes and duplicate references', async () => {
    await post('/products/categories')
      .send({ name: 'Singles', slug: 'invalid slug' })
      .expect(400);
    await post('/products/languages')
      .send({ name: 'PT', code: 'PT', active: false })
      .expect(400);
    db.condition.create.mockRejectedValue({
      code: 'P2002',
      message: 'private constraint',
    });
    const response = await post('/products/conditions')
      .send({ name: 'Near Mint', code: 'NM' })
      .expect(409);
    expect(response.text).not.toContain('private');
  });

  it.each(['/products', '/products/options', `/products/${id}`])(
    'protects administrative reads %s',
    async (path) => {
      await request(app.getHttpServer()).get(path).expect(401);
      db.user.findUnique.mockResolvedValue({ id, role: 'CUSTOMER' });
      await get(path).expect(403);
    },
  );

  it('blocks customer writes and missing credentials before database mutation', async () => {
    await request(app.getHttpServer())
      .post('/products')
      .send(input)
      .expect(401);
    db.user.findUnique.mockResolvedValue({ id, role: 'CUSTOMER' });
    await post('/products').send(input).expect(403);
    await patch(`/products/${id}`).send({ active: false }).expect(403);
    await patch(`/products/${id}/inventory`)
      .send({ availableQuantity: 0, expectedAvailableQuantity: 5 })
      .expect(403);
    await post('/products/categories')
      .send({ name: 'Singles', slug: 'singles' })
      .expect(403);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.category.create).not.toHaveBeenCalled();
  });
});

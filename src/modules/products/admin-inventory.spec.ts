import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { PrismaService } from '../../database/prisma.service.js';
import { ProductsModule } from './products.module.js';
import { AdminInventoryPipe } from './dto/admin-inventory.dto.js';

const id = '11111111-1111-4111-8111-111111111111';
const date = new Date('2026-11-05T12:00:00.000Z');
const secret = 'admin-inventory-test-secret-at-least-thirty-two-bytes';
const token = new JwtService().sign(
  {},
  {
    secret,
    subject: id,
    issuer: 'jornadatcg-api',
    audience: 'jornadatcg',
    expiresIn: 900,
  },
);
const product = {
  id,
  active: false,
  card: {
    id,
    name: 'Pikachu',
    number: '025',
    set: { id, name: 'Coleção', externalId: 'SECRET_SET_ID' },
    externalId: 'SECRET_CARD_ID',
  },
  category: { id, name: 'Cartas avulsas', internalMetadata: 'SECRET_CATEGORY' },
  condition: { id, name: 'Near Mint', code: 'SECRET_CONDITION' },
  language: { id, name: 'Português', code: 'SECRET_LANGUAGE' },
  inventory: {
    availableQuantity: 3,
    reservedQuantity: 2,
    soldQuantity: 7,
    updatedAt: date,
    id: 'SECRET_INVENTORY_ID',
    cost: 'SECRET_COST',
  },
  price: 'SECRET_PRICE',
  observation: 'SECRET_OBSERVATION',
};
const normalizedProduct = {
  id,
  active: false,
  card: { id, name: 'Pikachu', number: '025', set: { id, name: 'Coleção' } },
  category: { id, name: 'Cartas avulsas' },
  condition: { id, name: 'Near Mint' },
  language: { id, name: 'Português' },
  inventory: {
    availableQuantity: 3,
    reservedQuantity: 2,
    soldQuantity: 7,
    updatedAt: date.toISOString(),
  },
};

describe('Administrative inventory HTTP', () => {
  let app: INestApplication;
  const db = {
    user: { findUnique: vi.fn() },
    product: {
      count: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    inventory: { updateMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  };
  const get = (query = '') =>
    request(app.getHttpServer())
      .get(`/admin/inventory${query}`)
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
      name: 'Gestor',
      email: 'gestor@example.com',
      role: 'ADMIN',
      authVersion: 0,
    });
    db.$transaction.mockImplementation((work) => work(db));
    db.product.count
      .mockResolvedValueOnce(40)
      .mockResolvedValueOnce(30)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(15)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(4);
    db.product.findMany.mockResolvedValue([product]);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => app.close());

  it('requires a valid JWT before inventory reads', async () => {
    await request(app.getHttpServer()).get('/admin/inventory').expect(401);
    await request(app.getHttpServer())
      .get('/admin/inventory')
      .set('Authorization', 'Bearer invalid')
      .expect(401);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.product.findMany).not.toHaveBeenCalled();
  });
  it('checks the current database role rather than a role claimed in the token', async () => {
    db.user.findUnique.mockResolvedValue({
      id,
      name: 'Cliente',
      email: 'cliente@example.com',
      role: 'CUSTOMER',
      authVersion: 0,
    });
    const claimedAdmin = new JwtService().sign(
      { role: 'ADMIN' },
      {
        secret,
        subject: id,
        issuer: 'jornadatcg-api',
        audience: 'jornadatcg',
        expiresIn: 900,
      },
    );
    await request(app.getHttpServer())
      .get('/admin/inventory')
      .set('Authorization', `Bearer ${claimedAdmin}`)
      .expect(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('returns a normalized selection and summary for the complete result set', async () => {
    const response = await get().expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      items: [normalizedProduct],
      page: 1,
      pageSize: 20,
      total: 40,
      lowStockThreshold: 5,
      summary: {
        productCount: 40,
        availableCount: 30,
        outOfStockCount: 6,
        lowStockCount: 15,
        reservedCount: 8,
        missingInventoryCount: 4,
      },
    });
    expect(response.text).not.toContain('SECRET_');
    expect(db.product.findMany).toHaveBeenCalledWith({
      where: {},
      select: {
        id: true,
        active: true,
        card: {
          select: {
            id: true,
            name: true,
            number: true,
            set: { select: { id: true, name: true } },
          },
        },
        category: { select: { id: true, name: true } },
        condition: { select: { id: true, name: true } },
        language: { select: { id: true, name: true } },
        inventory: {
          select: {
            availableQuantity: true,
            reservedQuantity: true,
            soldQuantity: true,
            updatedAt: true,
          },
        },
      },
      orderBy: [{ card: { name: 'asc' } }, { id: 'asc' }],
      skip: 0,
      take: 20,
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'RepeatableRead',
      maxWait: 5000,
      timeout: 15000,
    });
    expect(db.product.count).toHaveBeenCalledTimes(6);
    expect(db.product.create).not.toHaveBeenCalled();
    expect(db.product.update).not.toHaveBeenCalled();
    expect(db.product.delete).not.toHaveBeenCalled();
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
    expect(db.inventory.create).not.toHaveBeenCalled();
  });
  it('paginates server-side without computing summary from the returned page', async () => {
    const response = await get('?page=3&pageSize=12').expect(200);
    expect(response.body.page).toBe(3);
    expect(response.body.pageSize).toBe(12);
    expect(response.body.total).toBe(40);
    expect(response.body.summary.productCount).toBe(40);
    expect(db.product.findMany.mock.calls[0][0]).toMatchObject({
      skip: 24,
      take: 12,
    });
  });
  it('combines literal name, inactive products, selected stock and threshold in every summary count', async () => {
    const response = await get(
      '?name=%20Pika%25_%5C%20&active=false&stock=low&lowStockThreshold=12',
    ).expect(200);
    expect(response.body.lowStockThreshold).toBe(12);
    const base = {
      card: { name: { contains: 'Pika\\%\\_\\\\', mode: 'insensitive' } },
      active: false,
      inventory: { is: { availableQuantity: { gt: 0, lte: 12 } } },
    };
    expect(db.product.findMany.mock.calls[0][0].where).toEqual(base);
    expect(db.product.count.mock.calls[0][0]).toEqual({ where: base });
    const conditions = [
      { inventory: { is: { availableQuantity: { gt: 0 } } } },
      { inventory: { is: { availableQuantity: 0 } } },
      { inventory: { is: { availableQuantity: { gt: 0, lte: 12 } } } },
      { inventory: { is: { reservedQuantity: { gt: 0 } } } },
      { inventory: null },
    ];
    expect(
      db.product.count.mock.calls.slice(1).map(([args]) => args.where),
    ).toEqual(conditions.map((condition) => ({ AND: [base, condition] })));
  });
  it.each([
    ['available', { inventory: { is: { availableQuantity: { gt: 0 } } } }],
    ['out', { inventory: { is: { availableQuantity: 0 } } }],
    ['low', { inventory: { is: { availableQuantity: { gt: 0, lte: 5 } } } }],
    ['reserved', { inventory: { is: { reservedQuantity: { gt: 0 } } } }],
    ['missing', { inventory: null }],
  ])(
    'uses the correct relation condition for stock=%s',
    async (stock, where) => {
      await get(`?stock=${stock}`).expect(200);
      expect(db.product.findMany.mock.calls[0][0].where).toEqual(where);
    },
  );
  it('preserves missing inventory instead of presenting it as a zero balance', async () => {
    db.product.findMany.mockResolvedValue([
      { ...product, inventory: null },
      { ...product, inventory: { ...product.inventory, availableQuantity: 0 } },
    ]);
    const response = await get().expect(200);
    expect(response.body.items[0].inventory).toBeNull();
    expect(response.body.items[1].inventory.availableQuantity).toBe(0);
    expect(response.body.items[1].inventory.reservedQuantity).toBe(2);
  });
  it('returns an empty list with zero indicators when no products match', async () => {
    db.product.count.mockReset().mockResolvedValue(0);
    db.product.findMany.mockResolvedValue([]);
    const response = await get('?name=SemResultado').expect(200);
    expect(response.body.items).toEqual([]);
    expect(response.body.total).toBe(0);
    expect(Object.values(response.body.summary)).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it.each([
    'page=0',
    'page=1000001',
    'page=1.5',
    'page=01',
    'page=-1',
    'pageSize=0',
    'pageSize=101',
    'pageSize=1e2',
    'lowStockThreshold=0',
    'lowStockThreshold=2147483648',
    'lowStockThreshold=2.5',
    'lowStockThreshold=',
    'lowStockThreshold=Infinity',
    'active=1',
    'active=TRUE',
    'active=',
    'stock=unknown',
    'stock=',
    'name=',
    'name=%20%20',
    `name=${'a'.repeat(201)}`,
    'unexpected=1',
    'limit=20',
    'page=1&page=2',
    'pageSize=20&pageSize=30',
    'name=Pika&name=Eevee',
    'active=true&active=false',
    'stock=out&stock=low',
    'lowStockThreshold=5&lowStockThreshold=10',
    'stock[]=out',
    'name[x]=Pikachu',
  ])(
    'rejects invalid or duplicated parameters before reads: %s',
    async (query) => {
      const response = await get(`?${query}`).expect(400);
      expect(response.body.message).toBe(
        'Filtros de estoque inválidos. Confira os dados informados.',
      );
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );
  it('accepts upper bounds and an explicit active filter', async () => {
    await get(
      '?page=1000000&pageSize=100&lowStockThreshold=2147483647&active=true',
    ).expect(200);
    expect(db.product.findMany.mock.calls[0][0]).toMatchObject({
      where: { active: true },
      skip: 99999900,
      take: 100,
    });
  });
  it('sanitizes database errors without exposing connection details', async () => {
    db.$transaction.mockRejectedValue(
      new Error(`SECRET_DATABASE_URL ${secret}`),
    );
    const response = await get().expect(503);
    expect(response.body.message).toBe(
      'Consulta de estoque temporariamente indisponível.',
    );
    expect(response.text).not.toContain('SECRET_');
    expect(response.text).not.toContain(secret);
  });
  it('does not expose writes or an inventory detail route on this controller', async () => {
    await request(app.getHttpServer())
      .post('/admin/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send({ availableQuantity: 100 })
      .expect(404);
    await get(`/${id}`).expect(404);
    expect(db.product.findMany).not.toHaveBeenCalled();
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });
});

describe('Administrative inventory input pipe', () => {
  const pipe = new AdminInventoryPipe();
  it.each([
    null,
    [],
    'page=1',
    1,
    { page: ['1'] },
    { active: true },
    { stock: {} },
    { name: ['Pika'] },
    { lowStockThreshold: 5 },
  ])('rejects malformed parsed query objects: %j', (input) => {
    expect(() => pipe.transform(input)).toThrow(
      'Filtros de estoque inválidos. Confira os dados informados.',
    );
  });
  it('normalizes only expected fields and preserves a false filter', () => {
    expect(
      pipe.transform({ name: ' Pikachu ', active: 'false', stock: 'low' }),
    ).toEqual({
      page: 1,
      pageSize: 20,
      lowStockThreshold: 5,
      name: 'Pikachu',
      active: false,
      stock: 'low',
    });
  });
});

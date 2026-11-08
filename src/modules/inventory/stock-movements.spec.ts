import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { PrismaService } from '../../database/prisma.service.js';
import { ProductsModule } from '../products/products.module.js';
import { StockMovementsPipe } from './dto/stock-movements.dto.js';

const adminId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';
const movementId = '44444444-4444-4444-8444-444444444444';
const date = new Date('2026-11-06T12:00:00.000Z');
const secret = 'stock-history-test-secret-at-least-thirty-two-bytes';
const sign = (claims: Record<string, unknown> = {}) =>
  new JwtService().sign(claims, {
    secret,
    subject: adminId,
    issuer: 'jornadatcg-api',
    audience: 'jornadatcg',
    expiresIn: 900,
  });
const movement = {
  id: movementId,
  sequence: 9007199254740993123n,
  type: 'MANUAL_ADJUSTMENT',
  productId,
  orderId: null,
  orderNumber: null,
  actorId: adminId,
  actor: {
    id: adminId,
    name: 'Gestor',
    email: 'SECRET_EMAIL',
    passwordHash: 'SECRET_PASSWORD',
    cpf: 'SECRET_CPF',
  },
  reason: 'Conferência das unidades recebidas',
  cardName: 'Pikachu no momento do ajuste',
  cardNumber: '025',
  setName: 'Coleção histórica',
  categoryName: 'Cartas avulsas',
  conditionName: 'Near Mint',
  languageName: 'Português',
  availableBefore: 8,
  reservedBefore: 2,
  soldBefore: 12,
  availableDelta: -3,
  reservedDelta: 0,
  soldDelta: 0,
  availableAfter: 5,
  reservedAfter: 2,
  soldAfter: 12,
  createdAt: date,
  internalMetadata: 'SECRET_METADATA',
  product: { card: { name: 'Nome atual diferente' }, price: 'SECRET_PRICE' },
  order: {
    user: { email: 'SECRET_CUSTOMER' },
    checkoutKey: 'SECRET_CHECKOUT_KEY',
  },
};
const normalized = {
  id: movementId,
  sequence: '9007199254740993123',
  type: 'MANUAL_ADJUSTMENT',
  createdAt: date.toISOString(),
  product: {
    id: productId,
    cardName: 'Pikachu no momento do ajuste',
    cardNumber: '025',
    setName: 'Coleção histórica',
    categoryName: 'Cartas avulsas',
    conditionName: 'Near Mint',
    languageName: 'Português',
  },
  order: null,
  actor: { id: adminId, name: 'Gestor' },
  reason: 'Conferência das unidades recebidas',
  before: { availableQuantity: 8, reservedQuantity: 2, soldQuantity: 12 },
  change: { availableQuantity: -3, reservedQuantity: 0, soldQuantity: 0 },
  after: { availableQuantity: 5, reservedQuantity: 2, soldQuantity: 12 },
};

describe('Administrative stock movement history HTTP', () => {
  let app: INestApplication;
  const db = {
    user: { findUnique: vi.fn() },
    inventoryMovement: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    inventory: { updateMany: vi.fn(), create: vi.fn() },
    product: { findUnique: vi.fn(), update: vi.fn() },
    payment: { update: vi.fn() },
    $transaction: vi.fn(),
  };
  const get = (query = '') =>
    request(app.getHttpServer())
      .get(`/admin/inventory/movements${query}`)
      .set('Authorization', `Bearer ${sign()}`);
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
      id: adminId,
      name: 'Gestor',
      email: 'admin@example.com',
      role: 'ADMIN',
      authVersion: 0,
    });
    db.$transaction.mockImplementation((work) => work(db));
    db.inventoryMovement.count.mockResolvedValue(42);
    db.inventoryMovement.findMany.mockResolvedValue([movement]);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => app.close());

  it('requires valid authentication before reading the history', async () => {
    await request(app.getHttpServer())
      .get('/admin/inventory/movements')
      .expect(401);
    await request(app.getHttpServer())
      .get('/admin/inventory/movements')
      .set('Authorization', 'Bearer invalid')
      .expect(401);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.inventoryMovement.findMany).not.toHaveBeenCalled();
  });
  it('uses the current account role rather than ADMIN claimed in a token', async () => {
    db.user.findUnique.mockResolvedValue({
      id: adminId,
      name: 'Cliente',
      role: 'CUSTOMER',
      authVersion: 0,
    });
    await request(app.getHttpServer())
      .get('/admin/inventory/movements')
      .set('Authorization', `Bearer ${sign({ role: 'ADMIN' })}`)
      .expect(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('serializes exact sequence, signed changes and immutable product snapshots without private fields', async () => {
    const response = await get().expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      items: [normalized],
      page: 1,
      pageSize: 20,
      total: 42,
    });
    expect(response.text).not.toContain('SECRET_');
    expect(response.text).not.toContain('Nome atual diferente');
    expect(db.product.findUnique).not.toHaveBeenCalled();
    const query = db.inventoryMovement.findMany.mock.calls[0][0];
    expect(query.select.actor).toEqual({ select: { id: true, name: true } });
    expect(query.select.product).toBeUndefined();
    expect(query.select.order).toBeUndefined();
  });
  it('reads the count and page in one consistent snapshot in stable ledger sequence order', async () => {
    await get('?page=3&pageSize=12').expect(200);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'RepeatableRead',
      maxWait: 5000,
      timeout: 15000,
    });
    expect(db.inventoryMovement.count).toHaveBeenCalledWith({ where: {} });
    expect(db.inventoryMovement.findMany.mock.calls[0][0]).toMatchObject({
      where: {},
      orderBy: { sequence: 'desc' },
      skip: 24,
      take: 12,
    });
    expect(db.inventoryMovement.count).toHaveBeenCalledTimes(1);
    expect(db.inventoryMovement.findMany).toHaveBeenCalledTimes(1);
  });
  it('combines product, event type and inclusive/exclusive date bounds in count and list', async () => {
    await get(
      `?productId=${productId}&type=ORDER_RESERVED&from=2026-11-01T00%3A00%3A00Z&to=2026-11-07T00%3A00%3A00.12Z`,
    ).expect(200);
    const where = {
      productId,
      type: 'ORDER_RESERVED',
      createdAt: {
        gte: new Date('2026-11-01T00:00:00Z'),
        lt: new Date('2026-11-07T00:00:00.120Z'),
      },
    };
    expect(db.inventoryMovement.count).toHaveBeenCalledWith({ where });
    expect(db.inventoryMovement.findMany.mock.calls[0][0].where).toEqual(where);
  });
  it.each([
    'OPENING_BALANCE',
    'INITIAL_STOCK',
    'MANUAL_ADJUSTMENT',
    'ORDER_RESERVED',
    'ORDER_CANCELLED',
    'ORDER_EXPIRED',
    'PAYMENT_CONFIRMED',
    'PAYMENT_RELEASED',
  ])('accepts the event type %s', async (type) => {
    await get(`?type=${type}`).expect(200);
    expect(db.inventoryMovement.count).toHaveBeenCalledWith({
      where: { type },
    });
  });
  it('allows either date bound independently', async () => {
    await get('?from=2026-11-01T00%3A00%3A00Z').expect(200);
    expect(db.inventoryMovement.count).toHaveBeenLastCalledWith({
      where: { createdAt: { gte: new Date('2026-11-01T00:00:00Z') } },
    });
    await get('?to=2026-11-06T00%3A00%3A00Z').expect(200);
    expect(db.inventoryMovement.count).toHaveBeenLastCalledWith({
      where: { createdAt: { lt: new Date('2026-11-06T00:00:00Z') } },
    });
  });
  it('keeps the historical order number if the order reference was removed', async () => {
    db.inventoryMovement.findMany.mockResolvedValue([
      {
        ...movement,
        type: 'ORDER_RESERVED',
        actor: null,
        orderId: null,
        orderNumber: 123,
        reason: null,
      },
    ]);
    const response = await get().expect(200);
    expect(response.body.items[0]).toMatchObject({
      order: { id: null, orderNumber: 123 },
      actor: null,
      reason: null,
    });
  });
  it('links an existing order by ID without loading its customer or payment records', async () => {
    db.inventoryMovement.findMany.mockResolvedValue([
      {
        ...movement,
        type: 'PAYMENT_CONFIRMED',
        actor: null,
        orderId,
        orderNumber: 456,
      },
    ]);
    const response = await get().expect(200);
    expect(response.body.items[0].order).toEqual({
      id: orderId,
      orderNumber: 456,
    });
    expect(db.product.findUnique).not.toHaveBeenCalled();
    expect(db.payment.update).not.toHaveBeenCalled();
  });
  it('returns an empty list for a product with no movements', async () => {
    db.inventoryMovement.count.mockResolvedValue(0);
    db.inventoryMovement.findMany.mockResolvedValue([]);
    const response = await get(`?productId=${productId}`).expect(200);
    expect(response.body).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
  });
  it('allows a page beyond the current result count without inventing a not-found error', async () => {
    db.inventoryMovement.count.mockResolvedValue(15);
    db.inventoryMovement.findMany.mockResolvedValue([]);
    const response = await get('?page=2').expect(200);
    expect(response.body).toEqual({
      items: [],
      page: 2,
      pageSize: 20,
      total: 15,
    });
  });
  it.each([
    '?page=0',
    '?page=-1',
    '?page=1.5',
    '?page=1000001',
    '?page=01',
    '?page=',
    '?pageSize=0',
    '?pageSize=101',
    '?pageSize=twenty',
    '?pageSize=20&pageSize=20',
    '?page=1&page=1',
    '?unknown=x',
    '?productId=01',
    '?productId=',
    '?productId[]=x',
    `?productId=${productId}&productId=${productId}`,
    '?type=ADJUSTMENT',
    '?type=',
    '?type=ORDER_RESERVED&type=ORDER_RESERVED',
    '?from=',
    '?from=2026-11-01',
    '?from=2026-11-01T00%3A00%3A00-04%3A00',
    '?from=2026-02-30T00%3A00%3A00Z',
    '?to=2026-11-06T24%3A00%3A00Z',
    '?to=2026-11-06T00%3A00%3A00.1234Z',
    '?from=2026-11-07T00%3A00%3A00Z&to=2026-11-06T00%3A00%3A00Z',
    '?from=2026-11-06T00%3A00%3A00Z&to=2026-11-06T00%3A00%3A00Z',
    '?to=2026-11-06T00%3A00%3A00Z&to=2026-11-07T00%3A00%3A00Z',
  ])(
    'rejects invalid filters before accessing the ledger: %s',
    async (query) => {
      const response = await get(query).expect(400);
      expect(response.body.message).toBe(
        'Filtros de movimentações inválidos. Confira os dados informados.',
      );
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );
  it.each(['count', 'findMany'] as const)(
    'sanitizes %s database errors without leaking infrastructure or credentials',
    async (operation) => {
      db.inventoryMovement[operation].mockRejectedValueOnce(
        new Error('SECRET_DATABASE_URL database password expired'),
      );
      const response = await get().expect(503);
      expect(response.body.message).toBe(
        'Histórico de estoque temporariamente indisponível.',
      );
      expect(response.text).not.toContain('SECRET_');
      expect(response.text).not.toContain('password');
    },
  );
  it('sanitizes transaction acquisition failures', async () => {
    db.$transaction.mockRejectedValueOnce(new Error('SECRET_CONNECTION_POOL'));
    await get().expect(503);
  });
  it('never creates or edits movement, stock, product or payment records while reading', async () => {
    await get().expect(200);
    expect(db.inventoryMovement.create).not.toHaveBeenCalled();
    expect(db.inventoryMovement.update).not.toHaveBeenCalled();
    expect(db.inventoryMovement.delete).not.toHaveBeenCalled();
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
    expect(db.inventory.create).not.toHaveBeenCalled();
    expect(db.product.update).not.toHaveBeenCalled();
    expect(db.payment.update).not.toHaveBeenCalled();
  });
  it.each(['post', 'patch', 'delete'] as const)(
    'does not expose a public %s mutation for the ledger',
    async (method) => {
      await request(app.getHttpServer())
        [method]('/admin/inventory/movements')
        .set('Authorization', `Bearer ${sign()}`)
        .send({ reason: 'attempt' })
        .expect(404);
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );
});

describe('Stock movement pipe non-HTTP values', () => {
  it.each([
    null,
    undefined,
    [],
    'page=1',
    { page: 1 },
    { pageSize: true },
    { productId: [productId] },
    { type: ['ORDER_RESERVED'] },
    { from: new Date() },
  ])('rejects untrusted programmatic values %j', (value) => {
    expect(() => new StockMovementsPipe().transform(value)).toThrow(
      'Filtros de movimentações inválidos. Confira os dados informados.',
    );
  });
});

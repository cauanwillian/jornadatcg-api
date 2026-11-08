import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ProductsModule } from '../products/products.module.js';
import type { StockMovementRecord } from './dto/stock-movement-result.dto.js';
import { stockEntryOperationKey } from './dto/stock-entry.dto.js';

const adminId = '11111111-1111-4111-8111-111111111111';
const otherAdminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const productId = '22222222-2222-4222-8222-222222222222';
const otherProductId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const key = '33333333-3333-4333-8333-333333333333';
const secondKey = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const secret = 'stock-entries-test-secret-at-least-thirty-two-bytes';
const date = new Date('2026-11-07T12:00:00.000Z');
const input = { quantity: 3, reason: 'Compra de novas unidades' };
const sign = (claims: Record<string, unknown> = {}) =>
  new JwtService().sign(claims, {
    secret,
    subject: adminId,
    issuer: 'jornadatcg-api',
    audience: 'jornadatcg',
    expiresIn: 900,
  });
interface Stock {
  availableQuantity: number;
  reservedQuantity: number;
  soldQuantity: number;
}
type StoredMovement = StockMovementRecord & {
  actorId: string | null;
  operationKey: string | null;
};
type LedgerData = Omit<
  StoredMovement,
  'id' | 'sequence' | 'createdAt' | 'actor'
>;
type Lookup = {
  where: {
    productId_operationKey: { productId: string; operationKey: string };
  };
};
const lookupKey = (id: string, operationKey: string) => `${id}:${operationKey}`;
function existingReceipt(
  changes: Partial<StoredMovement> = {},
): StoredMovement {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    sequence: 9007199254740993n,
    type: 'STOCK_RECEIPT',
    productId,
    actorId: adminId,
    actor: { id: adminId, name: 'Gestor' },
    operationKey: key,
    reason: input.reason,
    orderId: null,
    orderNumber: null,
    cardName: 'Pikachu registrado na entrada',
    cardNumber: '025',
    setName: 'Coleção da entrada',
    categoryName: 'Cartas avulsas',
    conditionName: 'Near Mint',
    languageName: 'Português',
    availableBefore: 5,
    reservedBefore: 2,
    soldBefore: 9,
    availableDelta: 3,
    reservedDelta: 0,
    soldDelta: 0,
    availableAfter: 8,
    reservedAfter: 2,
    soldAfter: 9,
    createdAt: date,
    ...changes,
  };
}

describe('Administrative stock entry HTTP', () => {
  let app: INestApplication;
  const db = {
    user: { findUnique: vi.fn() },
    product: { findUnique: vi.fn(), update: vi.fn() },
    inventory: {
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
    },
    inventoryMovement: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  const state: {
    productExists: boolean;
    stock: Stock | null;
    receipts: Map<string, StoredMovement>;
    insertFailures: unknown[];
    lookupFailures: unknown[];
    afterRollback: ((error: unknown) => void) | null;
    hideReceiptAfterInsert: boolean;
  } = {
    productExists: true,
    stock: null,
    receipts: new Map(),
    insertFailures: [],
    lookupFailures: [],
    afterRollback: null,
    hideReceiptAfterInsert: false,
  };
  const base = `/products/${productId}/inventory/entries`;
  const post = (operationKey = key, id = productId) =>
    request(app.getHttpServer())
      .post(`/products/${id}/inventory/entries`)
      .set('Authorization', `Bearer ${sign()}`)
      .set('Idempotency-Key', operationKey);
  const get = (operationKey = key, id = productId) =>
    request(app.getHttpServer())
      .get(`/products/${id}/inventory/entries/${operationKey}`)
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
    state.productExists = true;
    state.stock = {
      availableQuantity: 5,
      reservedQuantity: 2,
      soldQuantity: 9,
    };
    state.receipts = new Map();
    state.insertFailures = [];
    state.lookupFailures = [];
    state.afterRollback = null;
    state.hideReceiptAfterInsert = false;
    db.user.findUnique.mockResolvedValue({
      id: adminId,
      name: 'Gestor',
      email: 'PRIVATE_EMAIL',
      role: 'ADMIN',
      authVersion: 0,
    });
    db.product.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        state.productExists && where.id === productId
          ? { id: productId }
          : null,
    );
    db.inventory.updateMany.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { productId: string; availableQuantity: { lte: number } };
        data: { availableQuantity: { increment: number } };
      }) => {
        if (
          !state.stock ||
          where.productId !== productId ||
          state.stock.availableQuantity > where.availableQuantity.lte
        )
          return { count: 0 };
        state.stock.availableQuantity += data.availableQuantity.increment;
        return { count: 1 };
      },
    );
    db.inventory.findUniqueOrThrow.mockImplementation(async () => {
      if (!state.stock) throw new Error('PRIVATE_MISSING_STOCK');
      return {
        ...state.stock,
        product: {
          card: {
            name: 'Pikachu registrado na entrada',
            number: '025',
            set: { name: 'Coleção da entrada' },
          },
          category: { name: 'Cartas avulsas' },
          condition: { name: 'Near Mint' },
          language: { name: 'Português' },
        },
      };
    });
    db.inventoryMovement.findUnique.mockImplementation(
      async ({ where }: Lookup) => {
        if (state.lookupFailures.length) throw state.lookupFailures.shift();
        if (state.hideReceiptAfterInsert && state.receipts.size) return null;
        return (
          state.receipts.get(
            lookupKey(
              where.productId_operationKey.productId,
              where.productId_operationKey.operationKey,
            ),
          ) ?? null
        );
      },
    );
    db.inventoryMovement.create.mockImplementation(
      async ({ data }: { data: LedgerData }) => {
        if (state.insertFailures.length) throw state.insertFailures.shift();
        const identity = lookupKey(data.productId, data.operationKey!);
        if (state.receipts.has(identity)) throw { code: 'P2002' };
        const actor = data.actorId
          ? {
              id: data.actorId,
              name: 'Gestor',
              email: 'PRIVATE_EMAIL',
              passwordHash: 'PRIVATE_HASH',
            }
          : null;
        const receipt: StoredMovement = {
          ...data,
          id: '44444444-4444-4444-8444-444444444444',
          sequence: 9007199254740993n + BigInt(state.receipts.size),
          createdAt: date,
          actor,
        };
        state.receipts.set(identity, receipt);
        return receipt;
      },
    );
    db.$transaction.mockImplementation(
      async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
        const stockBefore = state.stock ? { ...state.stock } : null;
        const receiptsBefore = new Map(state.receipts);
        try {
          return await work(db as unknown as Prisma.TransactionClient);
        } catch (error) {
          state.stock = stockBefore;
          state.receipts = receiptsBefore;
          state.afterRollback?.(error);
          throw error;
        }
      },
    );
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => app.close());

  it('requires authentication for creating and consulting an entry', async () => {
    await request(app.getHttpServer())
      .post(base)
      .set('Idempotency-Key', key)
      .send(input)
      .expect(401);
    await request(app.getHttpServer()).get(`${base}/${key}`).expect(401);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.inventoryMovement.findUnique).not.toHaveBeenCalled();
  });
  it('uses the current ADMIN role instead of trusting a token claim', async () => {
    db.user.findUnique.mockResolvedValue({
      id: adminId,
      name: 'Cliente',
      role: 'CUSTOMER',
      authVersion: 0,
    });
    await request(app.getHttpServer())
      .post(base)
      .set('Authorization', `Bearer ${sign({ role: 'ADMIN' })}`)
      .set('Idempotency-Key', key)
      .send(input)
      .expect(403);
    await get().expect(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects revoked credential versions before any stock access', async () => {
    db.user.findUnique.mockResolvedValue({
      id: adminId,
      role: 'ADMIN',
      authVersion: 1,
    });
    await post().send(input).expect(401);
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });
  it('increments only available units and stores exact snapshots, reason and authenticated actor atomically', async () => {
    const response = await post()
      .send({ ...input, reason: `  ${input.reason}  ` })
      .expect(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      id: '44444444-4444-4444-8444-444444444444',
      sequence: '9007199254740993',
      type: 'STOCK_RECEIPT',
      createdAt: date.toISOString(),
      product: {
        id: productId,
        cardName: 'Pikachu registrado na entrada',
        cardNumber: '025',
        setName: 'Coleção da entrada',
        categoryName: 'Cartas avulsas',
        conditionName: 'Near Mint',
        languageName: 'Português',
      },
      order: null,
      actor: { id: adminId, name: 'Gestor' },
      reason: input.reason,
      before: { availableQuantity: 5, reservedQuantity: 2, soldQuantity: 9 },
      change: { availableQuantity: 3, reservedQuantity: 0, soldQuantity: 0 },
      after: { availableQuantity: 8, reservedQuantity: 2, soldQuantity: 9 },
    });
    expect(response.text).not.toContain('PRIVATE_');
    expect(response.body.operationKey).toBeUndefined();
    expect(db.inventory.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { productId, availableQuantity: { lte: 2147483644 } },
      data: { availableQuantity: { increment: 3 } },
    });
    expect(db.inventoryMovement.create).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({
        productId,
        operationKey: key,
        actorId: adminId,
        type: 'STOCK_RECEIPT',
        reason: input.reason,
        availableBefore: 5,
        availableDelta: 3,
        availableAfter: 8,
        reservedBefore: 2,
        reservedDelta: 0,
        reservedAfter: 2,
        soldBefore: 9,
        soldDelta: 0,
        soldAfter: 9,
      }),
    });
    expect(db.$transaction).toHaveBeenCalledExactlyOnceWith(
      expect.any(Function),
      { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15000 },
    );
    expect(db.product.update).not.toHaveBeenCalled();
    expect(db.inventory.create).not.toHaveBeenCalled();
  });
  it('replays the same key without changing stock, even after later reservations or sales', async () => {
    const original = await post().send(input).expect(201);
    state.stock = {
      availableQuantity: 4,
      reservedQuantity: 4,
      soldQuantity: 11,
    };
    db.inventory.updateMany.mockClear();
    db.inventoryMovement.create.mockClear();
    const replay = await post()
      .send({ ...input, reason: ` ${input.reason} ` })
      .expect(201);
    expect(replay.body).toEqual(original.body);
    expect(state.stock).toEqual({
      availableQuantity: 4,
      reservedQuantity: 4,
      soldQuantity: 11,
    });
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
    expect(db.inventoryMovement.create).not.toHaveBeenCalled();
    expect(state.receipts.size).toBe(1);
  });
  it.each([
    { quantity: 4, reason: input.reason },
    { quantity: input.quantity, reason: 'Outro recebimento' },
  ])('refuses a different payload using an existing key (%j)', async (body) => {
    await post().send(input).expect(201);
    db.inventory.updateMany.mockClear();
    await post().send(body).expect(409);
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
    expect(state.stock?.availableQuantity).toBe(8);
  });
  it('refuses a key belonging to another administrator or movement type', async () => {
    state.receipts.set(
      lookupKey(productId, key),
      existingReceipt({ actorId: otherAdminId }),
    );
    await post().send(input).expect(409);
    state.receipts.set(
      lookupKey(productId, key),
      existingReceipt({ type: 'MANUAL_ADJUSTMENT' }),
    );
    await post().send(input).expect(409);
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });
  it('permits another independently confirmed entry under a different key', async () => {
    await post().send(input).expect(201);
    await post(secondKey).send(input).expect(201);
    expect(state.stock).toEqual({
      availableQuantity: 11,
      reservedQuantity: 2,
      soldQuantity: 9,
    });
    expect(state.receipts.size).toBe(2);
  });
  it('normalizes uppercase UUIDs before looking up the product and key', async () => {
    await post(secondKey.toUpperCase(), productId.toUpperCase())
      .send(input)
      .expect(201);
    expect(db.inventoryMovement.findUnique.mock.calls[0][0].where).toEqual({
      productId_operationKey: { productId, operationKey: secondKey },
    });
  });
  it('consults its receipt without changing stock or exposing private fields', async () => {
    const original = await post().send(input).expect(201);
    db.inventory.updateMany.mockClear();
    db.inventoryMovement.create.mockClear();
    db.$transaction.mockClear();
    const found = await get().expect(200);
    expect(found.headers['cache-control']).toBe('no-store');
    expect(found.body).toEqual(original.body);
    expect(found.text).not.toContain('PRIVATE_');
    expect(found.body.operationKey).toBeUndefined();
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
    expect(db.inventoryMovement.create).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    const select = db.inventoryMovement.findUnique.mock.calls.at(-1)![0].select;
    expect(select.actor).toEqual({ select: { id: true, name: true } });
    expect(select.operationKey).toBeUndefined();
    expect(select.product).toBeUndefined();
  });
  it('returns the same 404 for absent, other-actor or non-entry receipts', async () => {
    await get().expect(404);
    state.receipts.set(
      lookupKey(productId, key),
      existingReceipt({ actorId: otherAdminId }),
    );
    await get().expect(404);
    state.receipts.set(
      lookupKey(productId, key),
      existingReceipt({ type: 'MANUAL_ADJUSTMENT' }),
    );
    await get().expect(404);
    await get(key, otherProductId).expect(404);
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });
  it.each([
    null,
    [],
    {},
    { quantity: '3', reason: input.reason },
    { quantity: 0, reason: input.reason },
    { quantity: -1, reason: input.reason },
    { quantity: 1.2, reason: input.reason },
    { quantity: 2147483648, reason: input.reason },
    { quantity: 3, reason: '' },
    { quantity: 3, reason: ' ab ' },
    { quantity: 3, reason: 'x'.repeat(501) },
    { quantity: 3, reason: 'bad\u0000reason' },
    { quantity: 3, reason: 'bad\nreason' },
    { quantity: 3, reason: null },
    { ...input, actorId: otherAdminId },
    { ...input, availableQuantity: 8 },
  ])('rejects an unsafe body before stock changes (%j)', async (body) => {
    await post().send(body).expect(400);
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it.each([
    '',
    'not-a-uuid',
    `${key},${secondKey}`,
    '00000000-0000-0000-0000-000000000000',
  ])(
    'rejects invalid idempotency header %s before writing',
    async (operationKey) => {
      await post(operationKey).send(input).expect(400);
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );
  it('requires the idempotency header', async () => {
    await request(app.getHttpServer())
      .post(base)
      .set('Authorization', `Bearer ${sign()}`)
      .send(input)
      .expect(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('refuses repeated raw idempotency headers even if a parser preserves one value', () => {
    expect(() =>
      stockEntryOperationKey({
        headers: { 'idempotency-key': key },
        rawHeaders: ['Idempotency-Key', key, 'idempotency-key', key],
      }),
    ).toThrow('uma única chave');
    expect(() =>
      stockEntryOperationKey({
        headers: { 'idempotency-key': [key] },
        rawHeaders: ['Idempotency-Key', key],
      }),
    ).toThrow('uma única chave');
  });
  it('rejects malformed route identifiers', async () => {
    await post(key, 'invalid').send(input).expect(400);
    await get('invalid').expect(400);
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });
  it('returns 404 for a missing product without creating inventory', async () => {
    state.productExists = false;
    await post().send(input).expect(404);
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
    expect(db.inventory.create).not.toHaveBeenCalled();
  });
  it('returns 409 for a missing inventory without presuming zero', async () => {
    state.stock = null;
    await post().send(input).expect(409);
    expect(db.inventory.create).not.toHaveBeenCalled();
    expect(db.inventoryMovement.create).not.toHaveBeenCalled();
  });
  it('prevents overflow and still permits reaching the maximum exact available balance', async () => {
    state.stock!.availableQuantity = 2147483646;
    await post()
      .send({ ...input, quantity: 2 })
      .expect(409);
    expect(state.stock!.availableQuantity).toBe(2147483646);
    expect(state.receipts.size).toBe(0);
    const accepted = await post()
      .send({ ...input, quantity: 1 })
      .expect(201);
    expect(accepted.body.after.availableQuantity).toBe(2147483647);
  });
  it('rolls back stock when its ledger write fails and sanitizes the failure', async () => {
    state.insertFailures.push(new Error('PRIVATE_DATABASE_PASSWORD'));
    const failed = await post().send(input).expect(503);
    expect(failed.text).not.toContain('PRIVATE_');
    expect(state.stock).toEqual({
      availableQuantity: 5,
      reservedQuantity: 2,
      soldQuantity: 9,
    });
    expect(state.receipts.size).toBe(0);
  });
  it('rolls back the ledger and stock when the inserted receipt cannot be read', async () => {
    state.hideReceiptAfterInsert = true;
    await post().send(input).expect(503);
    expect(state.stock!.availableQuantity).toBe(5);
    expect(state.receipts.size).toBe(0);
  });
  it('retries serialization failure in the same operation without a duplicate committed entry', async () => {
    state.insertFailures.push({ code: 'P2034' });
    await post().send(input).expect(201);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(state.stock!.availableQuantity).toBe(8);
    expect(state.receipts.size).toBe(1);
  });
  it('rereads a committed competing key after uniqueness failure instead of adding again', async () => {
    state.insertFailures.push({ code: 'P2002' });
    state.afterRollback = (error) => {
      if ((error as { code?: string }).code !== 'P2002') return;
      state.stock = {
        availableQuantity: 8,
        reservedQuantity: 2,
        soldQuantity: 9,
      };
      state.receipts.set(lookupKey(productId, key), existingReceipt());
    };
    const result = await post().send(input).expect(201);
    expect(result.body.id).toBe(existingReceipt().id);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.inventory.updateMany).toHaveBeenCalledTimes(1);
    expect(state.stock!.availableQuantity).toBe(8);
    expect(state.receipts.size).toBe(1);
  });
  it.each(['P2034', 'P2002'])(
    'limits retries for unresolved %s conflicts',
    async (code) => {
      db.$transaction.mockRejectedValue({ code });
      await post().send(input).expect(409);
      expect(db.$transaction).toHaveBeenCalledTimes(3);
      expect(state.stock!.availableQuantity).toBe(5);
    },
  );
  it('sanitizes a lookup outage for both POST and GET', async () => {
    state.lookupFailures.push(new Error('PRIVATE_LOOKUP_URL'));
    const postFailure = await post().send(input).expect(503);
    state.lookupFailures.push(new Error('PRIVATE_LOOKUP_URL'));
    const getFailure = await get().expect(503);
    expect(postFailure.text + getFailure.text).not.toContain('PRIVATE_');
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });
  it('does not offer updates or deletion of a stock entry', async () => {
    await request(app.getHttpServer())
      .patch(`${base}/${key}`)
      .set('Authorization', `Bearer ${sign()}`)
      .send(input)
      .expect(404);
    await request(app.getHttpServer())
      .delete(`${base}/${key}`)
      .set('Authorization', `Bearer ${sign()}`)
      .expect(404);
    expect(db.inventoryMovement.update).not.toHaveBeenCalled();
    expect(db.inventoryMovement.delete).not.toHaveBeenCalled();
  });
});

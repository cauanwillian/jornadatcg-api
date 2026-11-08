import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { NotificationsModule } from './notifications.module.js';
import {
  encodeNotificationCursor,
  notificationKinds,
} from './dto/notifications-query.dto.js';
import type { NotificationKind } from './dto/notifications-query.dto.js';

const userId = 'a99d3fe9-a5fb-4f35-9218-88592106d61f';
const otherUserId = 'b99d3fe9-a5fb-4f35-9218-88592106d61f';
const id1 = '11111111-1111-4111-8111-111111111111';
const id2 = '22222222-2222-4222-8222-222222222222';
const id3 = '33333333-3333-4333-8333-333333333333';
const secret = 'notifications-test-secret-at-least-thirty-two-bytes';
const token = (subject = userId) =>
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
const date = new Date('2026-10-23T12:00:00.000Z');
type Row = Record<string, unknown> & { id: string; userId: string };
const order = (id = id1, overrides: Record<string, unknown> = {}): Row => ({
  id,
  userId,
  orderNumber: 42,
  createdAt: date,
  paidAt: null,
  cancelledAt: null,
  updatedAt: new Date('2026-10-24T12:00:00.000Z'),
  email: 'PRIVATE_EMAIL',
  cpf: 'PRIVATE_DOCUMENT',
  total: 'PRIVATE_VALUE',
  shippingAddress: { street: 'PRIVATE_STREET' },
  passwordHash: 'PRIVATE_HASH',
  ...overrides,
});
const shipment = (id = id1, overrides: Record<string, unknown> = {}): Row => ({
  id,
  userId,
  createdAt: date,
  shippingPaidAt: null,
  packedAt: null,
  shippedAt: null,
  deliveredAt: null,
  updatedAt: new Date('2026-10-24T12:00:00.000Z'),
  status: 'PENDING',
  addressSnapshot: { recipientName: 'PRIVATE_RECIPIENT' },
  label: { requestSnapshot: { cpf: 'PRIVATE_DOCUMENT' } },
  providerShipmentId: 'PRIVATE_REMOTE_ID',
  trackingCode: 'PRIVATE_TRACKING',
  ...overrides,
});

type Where = Record<string, unknown>;
function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR')
      return (condition as Where[]).some((branch) => matches(row, branch));
    const value = row[key];
    if (condition instanceof Date)
      return value instanceof Date && value.getTime() === condition.getTime();
    if (condition && typeof condition === 'object') {
      return Object.entries(condition).every(([operator, operand]) => {
        if (operator === 'not') return value !== operand;
        if (value == null) return false;
        if (operator === 'lt') return (value as Date) < (operand as Date);
        if (operator === 'lte') return (value as Date) <= (operand as Date);
        if (operator === 'gt')
          return (
            typeof value === 'string' &&
            typeof operand === 'string' &&
            value > operand
          );
        throw new Error('Unexpected filter in notification query');
      });
    }
    return value === condition;
  });
}
type Query = {
  where: Where;
  select: Record<string, boolean>;
  orderBy: Record<string, 'asc' | 'desc'>[];
  take: number;
};
function queryRows(rows: Row[], query: Query) {
  return rows
    .filter((row) => matches(row, query.where))
    .sort((left, right) => {
      for (const sort of query.orderBy) {
        const [field, direction] = Object.entries(sort)[0];
        const first = left[field] as Date | string;
        const second = right[field] as Date | string;
        const compared = first < second ? -1 : first > second ? 1 : 0;
        if (compared) return direction === 'asc' ? compared : -compared;
      }
      return 0;
    })
    .slice(0, query.take)
    .map((row) =>
      Object.fromEntries(
        Object.entries(query.select)
          .filter(([, selected]) => selected)
          .map(([key]) => [key, row[key]]),
      ),
    );
}

describe('Customer updates HTTP', () => {
  let app: INestApplication<App>;
  let orders: Row[];
  let shipments: Row[];
  const db = {
    user: { findUnique: vi.fn() },
    order: { findMany: vi.fn() },
    shipment: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  const get = (query = '') =>
    request(app.getHttpServer())
      .get(`/notifications${query}`)
      .set('Authorization', `Bearer ${token()}`);
  const cursor = (overrides: Record<string, unknown> = {}) =>
    Buffer.from(
      JSON.stringify({
        v: 1,
        date: date.toISOString(),
        kind: 'ORDER_CREATED',
        entityId: id1,
        ...overrides,
      }),
    ).toString('base64url');

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [NotificationsModule],
    })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', secret);
    orders = [];
    shipments = [];
    db.user.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({
          id: where.id,
          name: 'Customer',
          email: 'customer@example.com',
          role: 'CUSTOMER',
        }),
    );
    db.order.findMany.mockImplementation((query: Query) =>
      Promise.resolve(queryRows(orders, query)),
    );
    db.shipment.findMany.mockImplementation((query: Query) =>
      Promise.resolve(queryRows(shipments, query)),
    );
    db.$transaction.mockImplementation(
      (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        callback(db as unknown as Prisma.TransactionClient),
    );
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await app.close();
  });

  it('requires JWT before querying any sources', async () => {
    await request(app.getHttpServer()).get('/notifications').expect(401);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.order.findMany).not.toHaveBeenCalled();
    expect(db.shipment.findMany).not.toHaveBeenCalled();
  });
  it('rejects an invalid JWT', async () => {
    await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', 'Bearer invalid')
      .expect(401);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('returns an empty no-store feed for an authenticated customer', async () => {
    const response = await get().expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
      maxWait: 5000,
      timeout: 10000,
    });
    for (const call of [
      ...db.order.findMany.mock.calls,
      ...db.shipment.findMany.mock.calls,
    ])
      expect(call[0].take).toBe(21);
  });
  it('normalizes all eight stored milestones without private fields or duplicate payment events', async () => {
    orders = [order(id1, { paidAt: date, cancelledAt: date })];
    shipments = [
      shipment(id2, {
        shippingPaidAt: date,
        packedAt: date,
        shippedAt: date,
        deliveredAt: date,
      }),
    ];
    const response = await get().expect(200);
    expect(
      response.body.items.map((entry: { kind: string }) => entry.kind),
    ).toEqual(notificationKinds);
    expect(
      response.body.items.find(
        (entry: { kind: string }) => entry.kind === 'ORDER_PAID',
      ),
    ).toEqual({
      id: `ORDER_PAID:${id1}`,
      kind: 'ORDER_PAID',
      occurredAt: date.toISOString(),
      title: 'Pagamento do pedido #42 confirmado',
      message:
        'O pagamento deste pedido foi confirmado. Consulte suas compras para acompanhar os próximos passos.',
      target: { type: 'order', id: id1 },
      orderNumber: 42,
    });
    expect(
      response.body.items.find(
        (entry: { kind: string }) => entry.kind === 'SHIPMENT_CREATED',
      ),
    ).toEqual({
      id: `SHIPMENT_CREATED:${id2}`,
      kind: 'SHIPMENT_CREATED',
      occurredAt: date.toISOString(),
      title: 'Solicitação de envio registrada',
      message:
        'Sua solicitação de envio foi registrada. Consulte o envio para verificar o frete e as próximas etapas.',
      target: { type: 'shipment', id: id2 },
    });
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE');
    expect(response.body).toMatchObject({ hasMore: false, nextCursor: null });
  });
  it('does not fabricate milestones from updatedAt or current state', async () => {
    orders = [order(id1, { status: 'DELIVERED' })];
    shipments = [shipment(id2, { status: 'CANCELLED' })];
    const response = await get().expect(200);
    expect(
      response.body.items.map((entry: { kind: string }) => entry.kind),
    ).toEqual(['ORDER_CREATED', 'SHIPMENT_CREATED']);
    expect(
      response.body.items.every(
        (entry: { occurredAt: string }) =>
          entry.occurredAt === date.toISOString(),
      ),
    ).toBe(true);
  });
  it('filters every source by the JWT owner and selects only the milestone data', async () => {
    orders = [
      order(id1, { paidAt: date, cancelledAt: date }),
      order(id2, { userId: otherUserId, paidAt: date, cancelledAt: date }),
    ];
    shipments = [
      shipment(id1, {
        shippingPaidAt: date,
        packedAt: date,
        shippedAt: date,
        deliveredAt: date,
      }),
      shipment(id2, {
        userId: otherUserId,
        shippingPaidAt: date,
        packedAt: date,
        shippedAt: date,
        deliveredAt: date,
      }),
    ];
    const response = await get().expect(200);
    expect(response.body.items).toHaveLength(8);
    expect(
      response.body.items.every(
        (entry: { target: { id: string } }) => entry.target.id === id1,
      ),
    ).toBe(true);
    expect(db.order.findMany).toHaveBeenCalledTimes(3);
    expect(db.shipment.findMany).toHaveBeenCalledTimes(5);
    expect(db.order.findMany.mock.calls[0][0].where).toEqual({ userId });
    expect(db.shipment.findMany.mock.calls[0][0].where).toEqual({ userId });
    for (const [query] of db.order.findMany.mock.calls) {
      expect(query.where.userId).toBe(userId);
      expect(
        Object.keys(query.select).filter((key) => query.select[key]),
      ).toHaveLength(3);
      expect(query.select).not.toHaveProperty('user');
      expect(query).not.toHaveProperty('include');
      expect(query).not.toHaveProperty('skip');
    }
    for (const [query] of db.shipment.findMany.mock.calls) {
      expect(query.where.userId).toBe(userId);
      expect(
        Object.keys(query.select).filter((key) => query.select[key]),
      ).toHaveLength(2);
      expect(query).not.toHaveProperty('include');
      expect(query).not.toHaveProperty('skip');
    }
  });
  it('uses the current authenticated owner even when a cursor came from another user', async () => {
    const old = new Date(date.getTime() - 1000);
    orders = [
      order(id2, { userId: otherUserId, createdAt: old }),
      order(id3, { createdAt: old }),
    ];
    const response = await request(app.getHttpServer())
      .get(`/notifications?cursor=${cursor()}`)
      .set('Authorization', `Bearer ${token(otherUserId)}`)
      .expect(200);
    expect(
      response.body.items.map(
        (entry: { target: { id: string } }) => entry.target.id,
      ),
    ).toEqual([id2]);
    for (const [query] of [
      ...db.order.findMany.mock.calls,
      ...db.shipment.findMany.mock.calls,
    ])
      expect(query.where.userId).toBe(otherUserId);
  });

  it.each([1, 2, 3, 7, 50])(
    'paginates every global event once with limit %i and ties between kinds and UUIDs',
    async (limit) => {
      const older = new Date(date.getTime() - 1000);
      orders = [
        order(id2, { paidAt: date, cancelledAt: older }),
        order(id1, { paidAt: date, cancelledAt: date }),
      ];
      shipments = [
        shipment(id2, {
          shippingPaidAt: date,
          packedAt: older,
          shippedAt: date,
          deliveredAt: date,
        }),
        shipment(id1, {
          shippingPaidAt: date,
          packedAt: date,
          shippedAt: date,
          deliveredAt: date,
        }),
      ];
      const expected: {
        id: string;
        kind: NotificationKind;
        occurredAt: string;
        entityId: string;
      }[] = [];
      for (const row of orders)
        for (const [kind, field] of [
          ['ORDER_CREATED', 'createdAt'],
          ['ORDER_PAID', 'paidAt'],
          ['ORDER_CANCELLED', 'cancelledAt'],
        ] as const)
          expected.push({
            id: `${kind}:${row.id}`,
            kind,
            occurredAt: (row[field] as Date).toISOString(),
            entityId: row.id,
          });
      for (const row of shipments)
        for (const [kind, field] of [
          ['SHIPMENT_CREATED', 'createdAt'],
          ['SHIPMENT_FREIGHT_PAID', 'shippingPaidAt'],
          ['SHIPMENT_PACKED', 'packedAt'],
          ['SHIPMENT_SHIPPED', 'shippedAt'],
          ['SHIPMENT_DELIVERED', 'deliveredAt'],
        ] as const)
          expected.push({
            id: `${kind}:${row.id}`,
            kind,
            occurredAt: (row[field] as Date).toISOString(),
            entityId: row.id,
          });
      expected.sort(
        (left, right) =>
          right.occurredAt.localeCompare(left.occurredAt) ||
          notificationKinds.indexOf(left.kind) -
            notificationKinds.indexOf(right.kind) ||
          left.entityId.localeCompare(right.entityId),
      );
      const ids: string[] = [];
      let next: string | null = null;
      for (let page = 0; page < 20; page++) {
        const response = await get(
          `?limit=${limit}${next ? `&cursor=${next}` : ''}`,
        ).expect(200);
        expect(response.body.items.length).toBeLessThanOrEqual(limit);
        ids.push(
          ...response.body.items.map((entry: { id: string }) => entry.id),
        );
        expect(response.body.hasMore).toBe(response.body.nextCursor !== null);
        next = response.body.nextCursor;
        if (!next) break;
      }
      expect(next).toBeNull();
      expect(ids).toEqual(expected.map((entry) => entry.id));
      expect(new Set(ids).size).toBe(ids.length);
      for (const [query] of [
        ...db.order.findMany.mock.calls,
        ...db.shipment.findMany.mock.calls,
      ])
        expect(query.take).toBe(limit + 1);
    },
  );
  it('does not repeat the first item when a newer event arrives between pages', async () => {
    orders = [order(id1), order(id2)];
    const first = await get('?limit=1').expect(200);
    orders.push(order(id3, { createdAt: new Date(date.getTime() + 1000) }));
    const second = await get(`?limit=1&cursor=${first.body.nextCursor}`).expect(
      200,
    );
    expect(second.body.items.map((entry: { id: string }) => entry.id)).toEqual([
      `ORDER_CREATED:${id2}`,
    ]);
    expect(second.body.nextCursor).toBeNull();
    const fresh = await get('?limit=1').expect(200);
    expect(fresh.body.items[0].id).toBe(`ORDER_CREATED:${id3}`);
  });
  it('returns an empty terminal page for a valid cursor beyond all events', async () => {
    orders = [order(id1)];
    const encoded = encodeNotificationCursor({
      date: new Date(date.getTime() - 1000).toISOString(),
      kind: 'ORDER_CREATED',
      entityId: id1,
    });
    const response = await get(`?cursor=${encoded}`).expect(200);
    expect(response.body).toEqual({
      items: [],
      hasMore: false,
      nextCursor: null,
    });
  });
  it.each([
    '?limit=',
    '?limit=0',
    '?limit=51',
    '?limit=-1',
    '?limit=1.5',
    '?limit=abc',
    '?limit=01',
    '?limit=1e1',
    '?limit=1&limit=2',
    '?limit[]=1',
    '?cursor=',
    '?cursor=%20',
    '?cursor=not-json',
    '?cursor=a===',
    '?cursor=a&cursor=b',
    '?userId=other',
    '?page=1',
  ])(
    'rejects malformed or unsupported query %s without reading sources',
    async (query) => {
      await get(query).expect(400);
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );
  it.each([
    { v: 2 },
    { date: 'not-a-date' },
    { date: '2026-02-30T12:00:00.000Z' },
    { date: '2026-10-23T12:00:00Z' },
    { kind: 'REFUNDED' },
    { kind: null },
    { entityId: 'any-order' },
    { entityId: id1.toUpperCase().replace('11111111', 'AAAAAAAA') },
    { userId: otherUserId },
    { date: null },
  ])('rejects invalid cursor fields %j', async (fields) => {
    await get(`?cursor=${cursor(fields)}`).expect(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects oversized cursor without reading sources', async () => {
    await get(`?cursor=${'a'.repeat(513)}`).expect(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it.each(['[]', 'null', '"text"', '{}'])(
    'rejects cursor payload %s',
    async (payload) => {
      await get(`?cursor=${Buffer.from(payload).toString('base64url')}`).expect(
        400,
      );
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );
  it('sanitizes database failures without leaking connection or secret details', async () => {
    db.$transaction.mockRejectedValue(
      new Error('postgres://PRIVATE_PASSWORD@PRIVATE_HOST/PRIVATE_DB'),
    );
    const response = await get().expect(503);
    expect(response.body).toEqual({
      message: 'Atualizações temporariamente indisponíveis.',
      error: 'Service Unavailable',
      statusCode: 503,
    });
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE');
  });
});

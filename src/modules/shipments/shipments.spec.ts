import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ShipmentsModule } from './shipments.module.js';

const userId = 'a99d3fe9-a5fb-4f35-9218-88592106d61f';
const secret = 'shipments-test-secret-with-at-least-thirty-two-bytes';
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
describe('Available purchases HTTP', () => {
  let app: INestApplication<App>;
  const db = {
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  };
  const get = (query = '') =>
    request(app.getHttpServer())
      .get(`/shipments/available-items${query}`)
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
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', secret);
    db.user.findUnique.mockResolvedValue({
      id: userId,
      role: 'CUSTOMER',
      name: 'Test',
      email: 'test@example.com',
    });
    db.$transaction.mockImplementation(
      (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        work(db as unknown as Prisma.TransactionClient),
    );
    db.$queryRaw
      .mockResolvedValueOnce([
        {
          total: 1n,
          availableQuantity: 2n,
          availableValue: new Prisma.Decimal('0.20'),
        },
      ])
      .mockResolvedValueOnce([
        {
          orderItemId: 'item-1',
          orderId: 'order-1',
          orderNumber: 1,
          paidAt: new Date('2026-01-01T00:00:00Z'),
          productId: null,
          cardName: 'Snapshot name',
          cardNumber: '025',
          setName: 'Snapshot set',
          conditionName: 'NM',
          languageName: 'Português',
          categoryName: null,
          purchasedQuantity: 3,
          allocatedQuantity: 1,
          availableQuantity: 2,
          unitPrice: new Prisma.Decimal('0.10'),
          availableSubtotal: new Prisma.Decimal('0.20'),
        },
      ]);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await app.close();
  });
  it('returns historical purchase details, remaining quantities and exact decimal totals', async () => {
    const response = await get().expect(200);
    expect(response.body).toMatchObject({
      total: 1,
      page: 1,
      pageSize: 20,
      summary: { availableQuantity: 2, availableValue: '0.20' },
    });
    expect(response.body.items[0]).toMatchObject({
      cardName: 'Snapshot name',
      productId: null,
      purchasedQuantity: 3,
      allocatedQuantity: 1,
      availableQuantity: 2,
      unitPrice: '0.10',
      availableSubtotal: '0.20',
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'RepeatableRead' }),
    );
  });
  it('binds ownership and pagination as parameters instead of interpolated SQL', async () => {
    await get('?page=2&pageSize=5').expect(200);
    const countSql = db.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    const pageSql = db.$queryRaw.mock.calls[1][0] as Prisma.Sql;
    expect(countSql.values).toEqual([userId]);
    expect(pageSql.values).toEqual([userId, 5, 5]);
    expect(pageSql.sql).not.toContain(userId);
  });
  it('returns an empty list and zero summary', async () => {
    db.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([
        {
          total: 0n,
          availableQuantity: 0n,
          availableValue: new Prisma.Decimal(0),
        },
      ])
      .mockResolvedValueOnce([]);
    expect((await get().expect(200)).body).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      summary: { availableQuantity: 0, availableValue: '0.00' },
    });
  });
  it.each([
    '?page=0',
    '?page=1.5',
    '?pageSize=101',
    '?pageSize=-1',
    '?page=1&page=2',
    '?userId=other',
    '?status=PAID',
    '?page=1%20OR%201=1',
  ])('rejects invalid query %s', async (query) => {
    await get(query).expect(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .get('/shipments/available-items')
      .expect(401);
  });
  it('sanitizes query failures', async () => {
    db.$transaction.mockRejectedValue(new Error('secret SQL connection'));
    expect((await get().expect(503)).text).not.toContain('secret SQL');
  });
});

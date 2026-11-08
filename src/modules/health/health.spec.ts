import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthModule } from './health.module.js';
import { PrismaService } from '../../database/prisma.service.js';

const query = vi.fn();
const transaction = vi.fn();
let app: INestApplication;
beforeAll(async () => {
  const module = await Test.createTestingModule({ imports: [HealthModule] })
    .overrideProvider(PrismaService)
    .useValue({ $transaction: transaction })
    .compile();
  app = module.createNestApplication();
  await app.init();
});
beforeEach(() => {
  vi.resetAllMocks();
  query.mockResolvedValue([{ '?column?': 1 }]);
  transaction.mockImplementation((work) => work({ $queryRaw: query }));
});
afterAll(async () => app.close());
it('keeps liveness independent of database availability', async () => {
  transaction.mockRejectedValue(new Error('secret database error'));
  const response = await request(app.getHttpServer())
    .get('/health')
    .expect(200);
  expect(response.body).toEqual({ status: 'ok' });
  expect(response.headers['cache-control']).toBe('no-store');
  expect(transaction).not.toHaveBeenCalled();
});
it('checks database readiness with bounded transaction settings', async () => {
  const response = await request(app.getHttpServer())
    .get('/health/ready')
    .expect(200);
  expect(response.body).toEqual({ status: 'ok', database: 'up' });
  expect(response.headers['cache-control']).toBe('no-store');
  expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
    maxWait: 1000,
    timeout: 2000,
  });
  expect(query).toHaveBeenCalledOnce();
});
it.each(['transaction', 'query'])(
  'returns sanitized 503 on %s failure',
  async (source) => {
    (source === 'transaction' ? transaction : query).mockRejectedValue(
      new Error('postgresql://user:secret@example.com/db'),
    );
    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      statusCode: 503,
      message: 'API temporariamente indisponível.',
      error: 'Service Unavailable',
    });
    expect(JSON.stringify(response.body)).not.toContain('secret');
  },
);

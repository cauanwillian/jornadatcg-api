import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import request from 'supertest';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { CardsModule } from './cards.module.js';
import type { LocalCardRecord } from './dto/local-card.dto.js';

const id = 'a99d3fe9-a5fb-4f35-9218-88592106d61f';
const secret = 'test-only-jwt-secret-with-at-least-32-bytes';
const token = new JwtService().sign(
  {},
  {
    secret,
    algorithm: 'HS256',
    subject: id,
    issuer: 'jornadatcg-api',
    audience: 'jornadatcg',
    expiresIn: 900,
  },
);
const setId = '7e66b17f-a4de-41ae-9234-50898fe75c6f';
const source = {
  id: 'base1-58',
  name: 'Pikachu',
  number: '58',
  rarity: 'Common',
  artist: 'Mitsuhiro Arita',
  expansion: {
    id: 'base1',
    name: 'Base',
    series: 'Base',
    printed_total: 102,
    total: 102,
    code: 'BS',
    release_date: '1999/01/09',
    logo: 'https://example.com/logo.png',
    symbol: 'https://example.com/symbol.png',
  },
  images: [
    {
      type: 'front',
      small: 'https://example.com/small.png',
      large: 'https://example.com/large.png',
    },
  ],
};
const local: LocalCardRecord = {
  id,
  externalId: source.id,
  name: source.name,
  number: source.number,
  rarity: source.rarity,
  artist: source.artist,
  imageSmall: source.images[0].small,
  imageLarge: source.images[0].large,
  createdAt: new Date('2026-09-24T12:00:00Z'),
  updatedAt: new Date('2026-09-24T12:00:00Z'),
  set: {
    id: setId,
    externalId: 'base1',
    name: 'Base',
    series: 'Base',
    printedTotal: 102,
    total: 102,
    code: 'BS',
    releaseDate: new Date('1999-01-09T00:00:00Z'),
    logoUrl: source.expansion.logo,
    symbolUrl: source.expansion.symbol,
  },
};

describe('Cards local catalog HTTP', () => {
  let app: INestApplication<App>;
  const fetchMock = vi.fn<typeof fetch>();
  const tx = {
    card: {
      findUnique: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    cardSet: { upsert: vi.fn() },
  };
  const database = {
    user: { findUnique: vi.fn() },
    card: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  };
  const importRequest = () =>
    request(app.getHttpServer())
      .post('/cards/import')
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [CardsModule] })
      .overrideProvider(PrismaService)
      .useValue(database)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', secret);
    database.user.findUnique.mockResolvedValue({
      id,
      name: 'Admin',
      email: 'admin@example.com',
      role: 'ADMIN',
    });
    vi.stubEnv('SCRYDEX_API_KEY', 'test-key');
    vi.stubEnv('SCRYDEX_TEAM_ID', 'test-team');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: source })));
    database.$transaction.mockImplementation(
      (callback: (client: Prisma.TransactionClient) => Promise<unknown>) =>
        callback(tx as unknown as Prisma.TransactionClient),
    );
    database.card.findUnique.mockResolvedValue(local);
    tx.card.findUnique.mockResolvedValue(null);
    tx.card.create.mockResolvedValue(local);
    tx.cardSet.upsert.mockResolvedValue(local.set);
    tx.card.count.mockResolvedValue(1);
    tx.card.findMany.mockResolvedValue([local]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await app.close();
  });

  it('imports authoritative provider data and maps set fields in one transaction', async () => {
    const response = await importRequest()
      .send({ externalId: source.id })
      .expect(200);
    expect((fetchMock.mock.calls[0][0] as URL).pathname).toBe(
      '/pokemon/v1/cards/base1-58',
    );
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(
      database.$transaction.mock.invocationCallOrder[0],
    );
    expect(database.$transaction).toHaveBeenCalledOnce();
    expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      maxWait: 5000,
      timeout: 5000,
    });
    expect(tx.cardSet.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { externalId: 'base1' },
        update: {},
        create: {
          externalId: 'base1',
          name: 'Base',
          series: 'Base',
          code: 'BS',
          printedTotal: 102,
          total: 102,
          releaseDate: new Date('1999-01-09T00:00:00Z'),
          logoUrl: source.expansion.logo,
          symbolUrl: source.expansion.symbol,
        },
      }),
    );
    expect(tx.card.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          externalId: source.id,
          name: source.name,
          number: source.number,
          rarity: source.rarity,
          artist: source.artist,
          imageSmall: source.images[0].small,
          imageLarge: source.images[0].large,
          setId,
        },
      }),
    );
    expect(response.body).toMatchObject({
      id,
      externalId: source.id,
      images: { small: source.images[0].small, large: source.images[0].large },
      set: { id: setId, releaseDate: '1999-01-09' },
    });
    expect(response.body).not.toHaveProperty('metadata');
    expect(response.body).not.toHaveProperty('products');
    expect(response.body).not.toHaveProperty('imageSmall');
  });

  it('returns the existing card without updating or creating records', async () => {
    tx.card.findUnique.mockResolvedValueOnce(local);
    const response = await importRequest()
      .send({ externalId: source.id })
      .expect(200);
    expect(response.body.id).toBe(id);
    expect(tx.cardSet.upsert).not.toHaveBeenCalled();
    expect(tx.card.create).not.toHaveBeenCalled();
  });

  it('rejects a different externalId occupying the same set and number', async () => {
    tx.card.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id });
    await importRequest().send({ externalId: source.id }).expect(409);
    expect(tx.card.create).not.toHaveBeenCalled();
    expect(database.$transaction).toHaveBeenCalledOnce();
  });

  it.each(['P2002', 'P2034'])(
    'retries the complete transaction after %s and returns the concurrent winner',
    async (code) => {
      tx.card.create.mockRejectedValueOnce({ code });
      tx.card.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(local);
      await importRequest().send({ externalId: source.id }).expect(200);
      expect(database.$transaction).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ['P2002', 409],
    ['P2034', 503],
  ] as const)('bounds retries for persistent %s', async (code, status) => {
    database.$transaction.mockRejectedValue({
      code,
      message: 'secret database details',
    });
    const response = await importRequest()
      .send({ externalId: source.id })
      .expect(status);
    expect(database.$transaction).toHaveBeenCalledTimes(3);
    expect(response.text).not.toContain('secret');
  });

  it('propagates a failed card insert out of the transaction without returning partial success', async () => {
    tx.card.create.mockRejectedValue(new Error('secret database details'));
    const response = await importRequest()
      .send({ externalId: source.id })
      .expect(503);
    expect(tx.cardSet.upsert).toHaveBeenCalledOnce();
    expect(response.text).not.toContain('secret');
    expect(response.body).not.toHaveProperty('id');
  });

  it.each([undefined, 'Bearer incorrect', 'Basic abc'])(
    'blocks unauthorized imports (%s)',
    async (authorization) => {
      const req = request(app.getHttpServer()).post('/cards/import');
      if (authorization) req.set('Authorization', authorization);
      await req.send({ externalId: source.id }).expect(401);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(database.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['', 'short', ' '.repeat(40)])(
    'disables import when token configuration is invalid',
    async (configured) => {
      vi.stubEnv('JWT_SECRET', configured);
      await importRequest().send({ externalId: source.id }).expect(503);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('rejects customer access even with a valid JWT', async () => {
    database.user.findUnique.mockResolvedValue({
      id,
      name: 'Customer',
      email: 'customer@example.com',
      role: 'CUSTOMER',
    });
    await importRequest().send({ externalId: source.id }).expect(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it('rejects the retired static import token', async () => {
    vi.stubEnv('CARDS_IMPORT_TOKEN', 'old-static-token');
    await request(app.getHttpServer())
      .post('/cards/import')
      .set('Authorization', 'Bearer old-static-token')
      .send({ externalId: source.id })
      .expect(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { externalId: '' },
    { externalId: '../cards' },
    { externalId: 123 },
    { externalId: ['base1-58'] },
    { externalId: 'x'.repeat(101) },
    { externalId: source.id, name: 'Forged name' },
    [],
  ])('rejects invalid import body %j', async (body) => {
    await importRequest().send(body).expect(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    [404, 404],
    [429, 503],
    [500, 503],
  ] as const)(
    'handles upstream HTTP %s without database writes',
    async (upstreamStatus, status) => {
      fetchMock.mockResolvedValue(
        new Response('private upstream details', { status: upstreamStatus }),
      );
      const response = await importRequest()
        .send({ externalId: source.id })
        .expect(status);
      expect(database.$transaction).not.toHaveBeenCalled();
      expect(response.text).not.toContain('private');
    },
  );

  it('maps upstream timeout to 504 without starting a transaction', async () => {
    fetchMock.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    await importRequest().send({ externalId: source.id }).expect(504);
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { data: { ...source, id: 'another-card' } },
    {
      data: {
        ...source,
        expansion: { ...source.expansion, release_date: '1999/02/30' },
      },
    },
    { data: { ...source, expansion: { ...source.expansion, total: '102' } } },
    {
      data: {
        ...source,
        expansion: { ...source.expansion, printed_total: 2147483648 },
      },
    },
    { data: { ...source, expansion: { ...source.expansion, logo: 42 } } },
  ])(
    'rejects invalid external data before persisting (%j)',
    async (payload) => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify(payload)));
      await importRequest().send({ externalId: source.id }).expect(502);
      expect(database.$transaction).not.toHaveBeenCalled();
    },
  );

  it('lists local cards with default pagination and no external requests', async () => {
    const response = await request(app.getHttpServer())
      .get('/cards')
      .expect(200);
    expect(response.body.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    expect(response.body.data[0].id).toBe(id);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('filters by name and collection using consistent totals and stable pagination', async () => {
    tx.card.count.mockResolvedValue(12);
    const response = await request(app.getHttpServer())
      .get('/cards')
      .query({ name: 'pika', setId, page: '2', limit: '5' })
      .expect(200);
    const where = { name: { contains: 'pika', mode: 'insensitive' }, setId };
    expect(tx.card.count).toHaveBeenCalledWith({ where });
    expect(tx.card.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        skip: 5,
        take: 5,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(response.body.pagination).toEqual({
      page: 2,
      limit: 5,
      total: 12,
      totalPages: 3,
    });
  });

  it('treats SQL pattern characters in the name as literal text', async () => {
    await request(app.getHttpServer())
      .get('/cards')
      .query({ name: '100%_pika' })
      .expect(200);
    expect(tx.card.count).toHaveBeenCalledWith({
      where: { name: { contains: '100\\%\\_pika', mode: 'insensitive' } },
    });
  });

  it('returns an empty paginated result for an empty catalog', async () => {
    tx.card.count.mockResolvedValue(0);
    tx.card.findMany.mockResolvedValue([]);
    await request(app.getHttpServer())
      .get('/cards')
      .expect(200, {
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
  });

  it.each([
    'page=0',
    'page=-1',
    'page=1.5',
    'page=10001',
    'limit=101',
    'limit=0',
    'limit=abc',
    'setId=invalid',
    'name=',
    'name=a&name=b',
    'page=1&page=2',
    'unknown=value',
  ])('rejects invalid list query %s', async (query) => {
    await request(app.getHttpServer()).get(`/cards?${query}`).expect(400);
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it('gets a local card by UUID without calling the provider', async () => {
    const response = await request(app.getHttpServer())
      .get(`/cards/${id}`)
      .expect(200);
    expect(response.body.id).toBe(id);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects invalid local UUIDs', async () => {
    await request(app.getHttpServer()).get('/cards/invalid').expect(400);
    expect(database.card.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing local card', async () => {
    database.card.findUnique.mockResolvedValue(null);
    await request(app.getHttpServer()).get(`/cards/${id}`).expect(404);
  });

  it('sanitizes database failures on both read routes', async () => {
    database.card.findUnique.mockRejectedValue(
      new Error('secret database URL'),
    );
    database.$transaction.mockRejectedValue(new Error('secret database URL'));
    for (const path of ['/cards', `/cards/${id}`]) {
      const response = await request(app.getHttpServer()).get(path).expect(503);
      expect(response.text).not.toContain('secret');
    }
  });
});

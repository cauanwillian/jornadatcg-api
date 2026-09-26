import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AddressesModule } from './addresses.module.js';

const userId = 'a99d3fe9-a5fb-4f35-9218-88592106d61f';
const id = '92030503-e053-4138-95c4-af75a9f65066';
const nextId = 'e0f58a11-0a82-4f35-b5c2-0846f362fe33';
const secret = 'address-test-secret-with-at-least-thirty-two-bytes';
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
const body = {
  label: 'Casa',
  recipientName: 'Pessoa de teste',
  zipCode: '78000-000',
  street: 'Rua de Teste',
  number: 's/n',
  complement: null,
  neighborhood: 'Centro',
  city: 'Cuiabá',
  state: 'mt',
  isDefault: true,
};
const record = {
  ...body,
  id,
  zipCode: '78000000',
  state: 'MT',
  createdAt: new Date('2026-01-01T12:00:00Z'),
  updatedAt: new Date('2026-01-01T12:00:00Z'),
};

describe('Addresses HTTP', () => {
  let app: INestApplication<App>;
  const db = {
    user: { findUnique: vi.fn() },
    address: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  const get = (path = '/addresses') =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);
  const post = () =>
    request(app.getHttpServer())
      .post('/addresses')
      .set('Authorization', `Bearer ${token}`);
  const put = () =>
    request(app.getHttpServer())
      .put(`/addresses/${id}`)
      .set('Authorization', `Bearer ${token}`);
  const remove = () =>
    request(app.getHttpServer())
      .delete(`/addresses/${id}`)
      .set('Authorization', `Bearer ${token}`);
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AddressesModule],
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
      name: 'Test',
      email: 'test@example.com',
      role: 'CUSTOMER',
    });
    db.$transaction.mockImplementation(
      (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        work(db as unknown as Prisma.TransactionClient),
    );
    db.address.findMany.mockResolvedValue([record]);
    db.address.findFirst.mockResolvedValue(record);
    db.address.count.mockResolvedValue(0);
    db.address.create.mockResolvedValue(record);
    db.address.update.mockResolvedValue(record);
    db.address.updateMany.mockResolvedValue({ count: 1 });
    db.address.delete.mockResolvedValue(record);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await app.close();
  });
  it('creates a normalized address owned by the authenticated user', async () => {
    const response = await post().send(body).expect(201);
    expect(response.body).toMatchObject({
      zipCode: '78000000',
      state: 'MT',
      isDefault: true,
      createdAt: record.createdAt.toISOString(),
    });
    expect(response.body).not.toHaveProperty('userId');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(db.address.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { ...body, zipCode: '78000000', state: 'MT', userId },
      }),
    );
  });
  it('always makes the first address default, even when false was requested', async () => {
    await post()
      .send({ ...body, isDefault: false })
      .expect(201);
    expect(db.address.create.mock.calls[0][0].data.isDefault).toBe(true);
  });
  it('does not change the default when adding a nondefault address', async () => {
    db.address.count.mockResolvedValue(1);
    await post()
      .send({ ...body, isDefault: false })
      .expect(201);
    expect(db.address.updateMany).not.toHaveBeenCalled();
    expect(db.address.create.mock.calls[0][0].data.isDefault).toBe(false);
  });
  it('sets a new default inside the same serializable transaction', async () => {
    db.address.count.mockResolvedValue(1);
    await post().send(body).expect(201);
    expect(db.address.updateMany).toHaveBeenCalledWith({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
    expect(db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
  });
  it('limits accounts to 20 addresses', async () => {
    db.address.count.mockResolvedValue(20);
    await post().send(body).expect(409);
    expect(db.address.create).not.toHaveBeenCalled();
  });
  it.each([
    { ...body, userId: nextId },
    { ...body, zipCode: '123' },
    { ...body, zipCode: 78000000 },
    { ...body, state: 'XX' },
    { ...body, state: 'Mato Grosso' },
    { ...body, recipientName: ' ' },
    { ...body, street: 'x'.repeat(201) },
    { ...body, number: 123 },
    { ...body, isDefault: 'true' },
    { ...body, complement: ['apt'] },
    { ...body, city: 'Cuiaba\nInjected' },
    {},
  ])('rejects invalid or unauthorized fields %j', async (invalid) => {
    await post().send(invalid).expect(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('lists and reads only own addresses', async () => {
    await get().expect(200);
    await get(`/addresses/${id}`).expect(200);
    expect(db.address.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId } }),
    );
    expect(db.address.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id, userId } }),
    );
  });
  it('returns an empty address book', async () => {
    db.address.findMany.mockResolvedValue([]);
    expect((await get().expect(200)).body).toEqual([]);
  });
  it('hides foreign addresses for reading, updating and deleting', async () => {
    db.address.findFirst.mockResolvedValue(null);
    await get(`/addresses/${id}`).expect(404);
    await put().send(body).expect(404);
    await remove().expect(404);
    expect(db.address.update).not.toHaveBeenCalled();
    expect(db.address.delete).not.toHaveBeenCalled();
  });
  it('replaces details while preserving the default flag if omitted', async () => {
    const { isDefault: _default, ...replacement } = body;
    await put()
      .send({ ...replacement, number: '45' })
      .expect(200);
    expect(db.address.update.mock.calls[0][0]).toMatchObject({
      where: { id, userId },
      data: { number: '45', isDefault: true },
    });
  });
  it('requires another address to become default before clearing the current one', async () => {
    await put()
      .send({ ...body, isDefault: false })
      .expect(409);
    expect(db.address.update).not.toHaveBeenCalled();
  });
  it('promotes the oldest remaining address after deleting the default', async () => {
    db.address.findFirst
      .mockResolvedValueOnce(record)
      .mockResolvedValueOnce({ id: nextId });
    await remove().expect(204);
    expect(db.address.delete).toHaveBeenCalledWith({ where: { id, userId } });
    expect(db.address.update).toHaveBeenCalledWith({
      where: { id: nextId, userId },
      data: { isDefault: true },
    });
  });
  it('allows removing the last address', async () => {
    db.address.findFirst
      .mockResolvedValueOnce(record)
      .mockResolvedValueOnce(null);
    await remove().expect(204);
    expect(db.address.update).not.toHaveBeenCalled();
  });
  it('does not change defaults when deleting another address', async () => {
    db.address.findFirst.mockResolvedValue({ ...record, isDefault: false });
    await remove().expect(204);
    expect(db.address.update).not.toHaveBeenCalled();
  });
  it('requires authentication on every operation', async () => {
    await request(app.getHttpServer()).get('/addresses').expect(401);
    await request(app.getHttpServer()).get(`/addresses/${id}`).expect(401);
    await request(app.getHttpServer())
      .post('/addresses')
      .send(body)
      .expect(401);
    await request(app.getHttpServer())
      .put(`/addresses/${id}`)
      .send(body)
      .expect(401);
    await request(app.getHttpServer()).delete(`/addresses/${id}`).expect(401);
  });
  it('validates IDs', async () => {
    await get('/addresses/invalid').expect(400);
  });
  it('retries serialization conflicts and bounds attempts', async () => {
    db.$transaction.mockRejectedValueOnce({ code: 'P2034' });
    await post().send(body).expect(201);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    db.$transaction.mockClear().mockRejectedValue({ code: 'P2034' });
    await post().send(body).expect(409);
    expect(db.$transaction).toHaveBeenCalledTimes(3);
  });
  it('sanitizes database failures', async () => {
    db.$transaction.mockRejectedValue(new Error('secret connection'));
    expect((await get().expect(503)).text).not.toContain('secret connection');
  });
});

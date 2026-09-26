import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../../database/prisma.service.js';
import { PaymentsModule } from './payments.module.js';
import { AsaasPixService } from './asaas-pix.service.js';

const userId = 'a99d3fe9-a5fb-4f35-9218-88592106d61f';
const orderId = '92030503-e053-4138-95c4-af75a9f65066';
const secret = 'pix-test-secret-with-at-least-thirty-two-bytes';
const webhookToken = 'webhook-test-token-with-at-least-thirty-two-bytes';
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
describe('Asaas HTTP validation and webhook security', () => {
  let app: INestApplication<App>;
  const pix = { create: vi.fn(), get: vi.fn(), handleWebhook: vi.fn() };
  const create = () =>
    request(app.getHttpServer())
      .post(`/orders/${orderId}/payments/pix`)
      .set('Authorization', `Bearer ${token}`);
  const webhook = () =>
    request(app.getHttpServer())
      .post('/webhooks/asaas')
      .set('asaas-access-token', webhookToken);
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [PaymentsModule] })
      .overrideProvider(PrismaService)
      .useValue({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: userId,
            role: 'CUSTOMER',
            name: 'Test',
            email: 'test@example.com',
          }),
        },
      })
      .overrideProvider(AsaasPixService)
      .useValue(pix)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', secret);
    vi.stubEnv('ASAAS_WEBHOOK_TOKEN', webhookToken);
    vi.stubEnv('ASAAS_API_KEY', 'test-api-key');
    pix.create.mockResolvedValue({
      payment: { status: 'PENDING' },
      pix: { payload: '000201' },
    });
    pix.get.mockResolvedValue({ payment: { status: 'PAID' }, pix: null });
    pix.handleWebhook.mockResolvedValue({ received: true });
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await app.close();
  });
  it('accepts only a valid CPF and derives order and owner from route and token', async () => {
    await create().send({ cpf: '52998224725' }).expect(200);
    expect(pix.create).toHaveBeenCalledWith(userId, orderId, {
      cpf: '52998224725',
    });
  });
  it.each([
    {},
    { cpf: '11111111111' },
    { cpf: '52998224726' },
    { cpf: '529.982.247-25' },
    { cpf: 52998224725 },
    { cpf: '52998224725', amount: '0.01' },
    { cpf: '52998224725', userId },
    { cpf: '52998224725', status: 'PAID' },
  ])('rejects malformed or tampered input %j', async (body) => {
    await create().send(body).expect(400);
    expect(pix.create).not.toHaveBeenCalled();
  });
  it('protects create and query with JWT', async () => {
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/payments/pix`)
      .send({ cpf: '52998224725' })
      .expect(401);
    await request(app.getHttpServer())
      .get(`/orders/${orderId}/payments/pix`)
      .expect(401);
  });
  it('queries Pix for the current user', async () => {
    await request(app.getHttpServer())
      .get(`/orders/${orderId}/payments/pix`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(pix.get).toHaveBeenCalledWith(userId, orderId);
  });
  it('authenticates webhook and forwards only the remote payment ID', async () => {
    await webhook()
      .send({
        id: 'evt_1',
        event: 'PAYMENT_RECEIVED',
        payment: { id: 'pay_123', value: 0.01, status: 'RECEIVED' },
      })
      .expect(200);
    expect(pix.handleWebhook).toHaveBeenCalledWith('pay_123');
  });
  it('rejects missing and wrong webhook credentials, even with a user JWT', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/asaas')
      .set('Authorization', `Bearer ${token}`)
      .send({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_123' } })
      .expect(401);
    await request(app.getHttpServer())
      .post('/webhooks/asaas')
      .set('asaas-access-token', 'wrong')
      .send({})
      .expect(401);
    expect(pix.handleWebhook).not.toHaveBeenCalled();
  });
  it.each([
    '',
    'short',
    'has spaces with at least thirty two characters',
    'test-api-key',
  ])('fails closed with invalid webhook configuration', async (value) => {
    vi.stubEnv('ASAAS_WEBHOOK_TOKEN', value);
    await webhook().send({}).expect(503);
  });
  it.each([
    {},
    { event: 'PAYMENT_RECEIVED' },
    { event: 'PAYMENT_RECEIVED', payment: { id: '../secret' } },
  ])('rejects malformed payment events', async (body) => {
    await webhook().send(body).expect(400);
    expect(pix.handleWebhook).not.toHaveBeenCalled();
  });
  it('acknowledges unrelated events without calling the provider', async () => {
    await webhook().send({ event: 'CUSTOMER_CREATED' }).expect(200);
    expect(pix.handleWebhook).not.toHaveBeenCalled();
  });
});

import { Test } from '@nestjs/testing';
import { GatewayTimeoutException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ShipmentsModule } from './shipments.module.js';
import { ShippingProvidersService } from './integrations/shipping-providers.service.js';

const userId = 'a99d3fe9-a5fb-4f35-9218-88592106d61f';
const id = 'b99d3fe9-a5fb-4f35-9218-88592106d61f';
const quoteId = 'c99d3fe9-a5fb-4f35-9218-88592106d61f';
const secret = 'quotes-test-secret-at-least-thirty-two-bytes';
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
const option = {
  provider: 'superfrete:sandbox',
  serviceCode: '1',
  serviceName: 'PAC',
  carrier: 'Correios',
  amount: '12.34',
  deliveryDays: 5,
};
describe('Shipping quotes HTTP', () => {
  let app: INestApplication<App>;
  const db = {
    user: { findUnique: vi.fn() },
    shipment: { findFirst: vi.fn(), update: vi.fn() },
    shippingQuote: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  };
  const providers = { configured: vi.fn(), quote: vi.fn() };
  const post = (path = '') =>
    request(app.getHttpServer())
      .post(`/shipments/${id}/quotes${path}`)
      .set('Authorization', `Bearer ${token}`);
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ShipmentsModule],
    })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(ShippingProvidersService)
      .useValue(providers)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', secret);
    vi.stubEnv('SHIPPING_ORIGIN_ZIP_CODE', '78556858');
    db.user.findUnique.mockResolvedValue({ id: userId, role: 'CUSTOMER' });
    db.shipment.findFirst.mockResolvedValue({
      id,
      userId,
      status: 'PENDING',
      updatedAt: new Date(0),
      addressSnapshot: { zipCode: '78000000' },
      payments: [],
      items: [
        { quantity: 31, orderItem: { unitPrice: new Prisma.Decimal('0.10') } },
      ],
    });
    db.$transaction.mockImplementation((work: (tx: unknown) => unknown) =>
      work(db),
    );
    providers.configured.mockReturnValue(true);
    providers.quote.mockResolvedValue([option]);
    db.shippingQuote.create.mockResolvedValue({ id: quoteId });
    db.shippingQuote.findFirst.mockResolvedValue({
      ...option,
      id: quoteId,
      shipmentId: id,
      amount: new Prisma.Decimal('12.34'),
      expiresAt: new Date(Date.now() + 60000),
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('quotes from historical prices and server-selected package', async () => {
    const response = await post().send({ price: '0.01' }).expect(200);
    expect(response.body.package).toMatchObject({
      name: 'Média',
      weight: 0.15,
    });
    expect(providers.quote.mock.calls[0][1]).toMatchObject({
      from: '78556858',
      to: '78000000',
      declaredValue: '3.10',
    });
    expect(db.shippingQuote.create.mock.calls[0][0].data).toMatchObject({
      amount: '12.34',
      shipmentId: id,
    });
    expect(db.shipment.findFirst.mock.calls[0][0].where).toEqual({
      id,
      userId,
    });
  });
  it('returns remaining options when a provider times out', async () => {
    providers.quote.mockRejectedValueOnce(new GatewayTimeoutException());
    const r = await post().expect(200);
    expect(r.body.options).toHaveLength(2);
    expect(r.body.providers[0].status).toBe('TIMEOUT');
  });
  it('returns 503 without fake quotes when no token is configured', async () => {
    providers.configured.mockReturnValue(false);
    const r = await post().expect(503);
    expect(
      r.body.providers.every(
        (p: { status: string }) => p.status === 'NOT_CONFIGURED',
      ),
    ).toBe(true);
    expect(db.shippingQuote.create).not.toHaveBeenCalled();
  });
  it('returns empty options for no coverage', async () => {
    providers.quote.mockResolvedValue([]);
    const r = await post().expect(200);
    expect(r.body.options).toEqual([]);
  });
  it('rejects foreign shipments', async () => {
    db.shipment.findFirst.mockResolvedValue(null);
    await post().expect(404);
    expect(providers.quote).not.toHaveBeenCalled();
  });
  it('blocks quotation with existing payment', async () => {
    db.shipment.findFirst.mockResolvedValue({
      status: 'PENDING',
      payments: [{ id }],
    });
    await post().expect(409);
  });
  it('rejects concurrent shipment change after network response', async () => {
    db.shipment.findFirst
      .mockResolvedValueOnce({
        status: 'PENDING',
        updatedAt: new Date(0),
        payments: [],
        addressSnapshot: { zipCode: '78000000' },
        items: [
          { quantity: 1, orderItem: { unitPrice: new Prisma.Decimal(1) } },
        ],
      })
      .mockResolvedValueOnce({
        status: 'CANCELLED',
        payments: [],
        updatedAt: new Date(),
      });
    await post().expect(409);
  });
  it('selects only a saved quote from this shipment', async () => {
    const r = await post(`/${quoteId}/select`).expect(200);
    expect(r.body.shippingCost).toBe('12.34');
    expect(db.shippingQuote.findFirst.mock.calls[0][0].where).toMatchObject({
      id: quoteId,
      shipmentId: id,
    });
  });
  it('rejects expired or foreign quotes', async () => {
    db.shippingQuote.findFirst.mockResolvedValue(null);
    await post(`/${quoteId}/select`).expect(409);
  });
  it('does not allow changing quote after charge creation', async () => {
    db.shipment.findFirst.mockResolvedValue({
      status: 'PENDING',
      payments: [{ id }],
    });
    await post(`/${quoteId}/select`).expect(409);
  });
  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .post(`/shipments/${id}/quotes`)
      .expect(401);
  });
  it('rejects malformed quote IDs', async () => {
    await post('/bad/select').expect(400);
  });
});

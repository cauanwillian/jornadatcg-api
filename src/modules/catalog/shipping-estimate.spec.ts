import { Test } from '@nestjs/testing';
import { GatewayTimeoutException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CatalogModule } from './catalog.module.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ShippingProvidersService } from '../shipments/integrations/shipping-providers.service.js';
const id = 'a99d3fe9-a5fb-4f35-9218-88592106d61f';
describe('Public shipping estimate', () => {
  let app: INestApplication;
  const db = { product: { findFirst: vi.fn() } };
  const providers = { configured: vi.fn(), quote: vi.fn() };
  const url = `/catalog/products/${id}/shipping-estimate`;
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubEnv('SHIPPING_ORIGIN_ZIP_CODE', '78556858');
    db.product.findFirst.mockResolvedValue({
      id,
      price: new Prisma.Decimal('10.25'),
      inventory: { availableQuantity: 70 },
    });
    providers.configured.mockImplementation((p) => p === 'melhorenvio');
    providers.quote.mockResolvedValue([
      {
        provider: 'melhorenvio:sandbox',
        serviceCode: '2',
        serviceName: 'SEDEX',
        carrier: 'Correios',
        amount: '12.68',
        deliveryDays: 2,
      },
    ]);
    const module = await Test.createTestingModule({ imports: [CatalogModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(ShippingProvidersService)
      .useValue(providers)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });
  it('quotes without authentication using server price and package, without persistence', async () => {
    const r = await request(app.getHttpServer())
      .get(url)
      .query({ zipCode: '78000-000', quantity: 2 })
      .expect(200);
    expect(r.body).toMatchObject({
      estimated: true,
      quantity: 2,
      declaredValue: '20.50',
      options: [{ amount: '12.68' }],
    });
    expect(r.headers['cache-control']).toBe('no-store');
    expect(providers.quote).toHaveBeenCalledWith(
      'melhorenvio',
      expect.objectContaining({
        from: '78556858',
        to: '78000000',
        declaredValue: '20.50',
        package: {
          name: 'Pequena',
          height: 3,
          width: 12,
          length: 17,
          weight: 0.15,
        },
      }),
    );
    expect(db.product.findFirst.mock.calls[0][0].where).toMatchObject({
      active: true,
      category: { active: true },
    });
  });
  it.each([30, 31, 70])('uses quantity %s for packaging', async (quantity) => {
    const r = await request(app.getHttpServer())
      .get(url)
      .query({ zipCode: '78000000', quantity })
      .expect(200);
    expect(r.body.package.name).toBe(quantity <= 30 ? 'Pequena' : 'Média');
  });
  it.each([
    '',
    'zipCode=abc',
    'zipCode=78000000&quantity=0',
    'zipCode=78000000&quantity=71',
    'zipCode=78000000&quantity=1.5',
    'zipCode=78000000&quantity=1&quantity=2',
    'zipCode=78000000&price=0',
  ])('rejects invalid parameters %s', async (query) => {
    await request(app.getHttpServer()).get(`${url}?${query}`).expect(400);
    expect(providers.quote).not.toHaveBeenCalled();
  });
  it('rejects absent or hidden product', async () => {
    db.product.findFirst.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get(url)
      .query({ zipCode: '78000000' })
      .expect(404);
    expect(providers.quote).not.toHaveBeenCalled();
  });
  it('rejects unavailable quantities', async () => {
    db.product.findFirst.mockResolvedValue({
      price: new Prisma.Decimal(10),
      inventory: null,
    });
    await request(app.getHttpServer())
      .get(url)
      .query({ zipCode: '78000000' })
      .expect(409);
  });
  it('keeps successful quotes when another provider times out', async () => {
    providers.configured.mockReturnValue(true);
    providers.quote.mockRejectedValueOnce(new GatewayTimeoutException());
    const r = await request(app.getHttpServer())
      .get(url)
      .query({ zipCode: '78000000' })
      .expect(200);
    expect(r.body.providers[0].status).toBe('TIMEOUT');
    expect(r.body.options).toHaveLength(2);
  });
  it('returns 503 when none is available', async () => {
    providers.configured.mockReturnValue(false);
    await request(app.getHttpServer())
      .get(url)
      .query({ zipCode: '78000000' })
      .expect(503);
  });
  it('returns empty options if providers have no services for the route', async () => {
    providers.quote.mockResolvedValue([]);
    const r = await request(app.getHttpServer())
      .get(url)
      .query({ zipCode: '78000000' })
      .expect(200);
    expect(r.body.options).toEqual([]);
  });
  it('limits external quote requests per IP', async () => {
    for (let i = 0; i < 10; i++)
      await request(app.getHttpServer())
        .get(url)
        .query({ zipCode: '78000000' })
        .expect(200);
    await request(app.getHttpServer())
      .get(url)
      .query({ zipCode: '78000000' })
      .expect(429);
    expect(providers.quote).toHaveBeenCalledTimes(10);
  });
});

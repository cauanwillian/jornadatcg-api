import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ShipmentsModule } from './shipments.module.js';
import { MelhorEnvioLabelsService } from './integrations/melhor-envio-labels.service.js';

const adminId = 'a99d3fe9-a5fb-4f35-9218-88592106d61f';
const customerId = 'b99d3fe9-a5fb-4f35-9218-88592106d61f';
const id = 'c99d3fe9-a5fb-4f35-9218-88592106d61f';
const secret = 'shipping-detail-fixture-secret-at-least-thirty-two-bytes';
const token = new JwtService().sign(
  {},
  {
    secret,
    subject: adminId,
    issuer: 'jornadatcg-api',
    audience: 'jornadatcg',
    expiresIn: 900,
  },
);
const now = new Date('2026-10-23T12:00:00.000Z');
const fixture = () => ({
  id,
  userId: customerId,
  status: 'PREPARING',
  provider: 'melhorenvio:sandbox',
  shippingMethod: '2',
  shippingCost: new Prisma.Decimal('12.68'),
  packedAt: now,
  shippingPaidAt: now,
  trackingCode: 'TESTE123BR',
  createdAt: now,
  updatedAt: now,
  shippedAt: null,
  deliveredAt: null,
  addressSnapshot: {
    addressId: 'd99d3fe9-a5fb-4f35-9218-88592106d61f',
    recipientName: 'Destinatário de demonstração',
    zipCode: '01001000',
    street: 'Rua de demonstração',
    number: '100',
    complement: null,
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    cpf: 'DO_NOT_EXPOSE_CPF',
    phone: 'DO_NOT_EXPOSE_PHONE',
  },
  selectedQuote: {
    provider: 'melhorenvio:sandbox',
    carrier: 'Correios',
    serviceName: 'SEDEX',
    serviceCode: '2',
    amount: new Prisma.Decimal('12.68'),
    packageSnapshot: {
      name: 'Pequena',
      height: 3,
      width: 12,
      length: 17,
      weight: 0.15,
      originZipCode: '78556858',
      destinationZipCode: '01001000',
      declaredValue: '10.00',
      secret: 'DO_NOT_EXPOSE_PACKAGE_SECRET',
    },
  },
  label: {
    id: 'e99d3fe9-a5fb-4f35-9218-88592106d61f',
    shipmentId: id,
    provider: 'melhorenvio:sandbox',
    remoteId: null,
    status: 'INTENT',
    cost: new Prisma.Decimal('12.68'),
    generatedAt: null,
    createStartedAt: now,
    checkoutStartedAt: null,
    generateStartedAt: null,
    requestedById: adminId,
    requestSnapshot: { secret: 'DO_NOT_EXPOSE_REQUEST_SNAPSHOT' },
  },
  items: [
    {
      quantity: 2,
      orderItem: {
        cardName: 'Pikachu',
        cardNumber: '025',
        setName: 'Coleção de demonstração',
        conditionName: 'Near mint',
        languageName: 'Português',
        unitPrice: new Prisma.Decimal('5.00'),
        order: { user: { passwordHash: 'DO_NOT_EXPOSE_PASSWORD' } },
      },
    },
  ],
  user: { email: 'DO_NOT_EXPOSE_EMAIL' },
  payments: [{ id: 'DO_NOT_EXPOSE_PAYMENT_ID' }],
});

describe('Administrative shipment detail', () => {
  let app: INestApplication<App>;
  const db = {
    user: { findUnique: vi.fn() },
    shipment: { findUnique: vi.fn() },
  };
  const provider = {
    assertConfigured: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    checkout: vi.fn(),
    generate: vi.fn(),
    print: vi.fn(),
  };
  const get = (shipmentId = id) =>
    request(app.getHttpServer())
      .get(`/admin/shipments/${shipmentId}`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ShipmentsModule],
    })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(MelhorEnvioLabelsService)
      .useValue(provider)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', secret);
    db.user.findUnique.mockResolvedValue({ id: adminId, role: 'ADMIN' });
    db.shipment.findUnique.mockResolvedValue(fixture());
  });
  afterEach(() => vi.unstubAllEnvs());

  it('requires authentication without querying the shipment', async () => {
    await request(app.getHttpServer())
      .get(`/admin/shipments/${id}`)
      .expect(401);
    expect(db.shipment.findUnique).not.toHaveBeenCalled();
  });
  it('rejects a customer even when requesting their own shipment', async () => {
    db.user.findUnique.mockResolvedValue({ id: customerId, role: 'CUSTOMER' });
    await get().expect(403);
    expect(db.shipment.findUnique).not.toHaveBeenCalled();
  });
  it('validates the shipment UUID before querying', async () => {
    await get('ID_DO_ENVIO').expect(400);
    expect(db.shipment.findUnique).not.toHaveBeenCalled();
  });
  it('returns a missing shipment as 404', async () => {
    db.shipment.findUnique.mockResolvedValue(null);
    const result = await get().expect(404);
    expect(result.body.message).toBe('Envio não encontrado.');
  });
  it('allows an administrator to inspect a different customer and normalizes dates and money', async () => {
    const result = await get().expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).toMatchObject({
      id,
      userId: customerId,
      status: 'PREPARING',
      shippingCost: '12.68',
      shippingPaidAt: now.toISOString(),
      packedAt: now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      shippedAt: null,
      deliveredAt: null,
      quote: { provider: 'melhorenvio:sandbox', amount: '12.68' },
      label: {
        shipmentId: id,
        cost: '12.68',
        createStartedAt: now.toISOString(),
      },
      items: [
        { quantity: 2, orderItem: { cardName: 'Pikachu', unitPrice: '5.00' } },
      ],
    });
    expect(db.shipment.findUnique).toHaveBeenCalledWith({
      where: { id },
      select: expect.any(Object),
    });
  });
  it('uses a minimal relation selection without loading customer or payment secrets', async () => {
    await get().expect(200);
    const query = db.shipment.findUnique.mock.calls[0][0] as {
      select: Record<string, unknown>;
    };
    expect(query.select).not.toHaveProperty('user');
    expect(query.select).not.toHaveProperty('payments');
    expect(query.select.label).toEqual({
      select: {
        id: true,
        shipmentId: true,
        provider: true,
        remoteId: true,
        status: true,
        cost: true,
        generatedAt: true,
        createStartedAt: true,
        checkoutStartedAt: true,
        generateStartedAt: true,
      },
    });
    const output = JSON.stringify(query);
    for (const field of [
      'requestSnapshot',
      'requestedById',
      'passwordHash',
      'email',
    ])
      expect(output).not.toContain(field);
  });
  it('whitelists even unexpected historical JSON fields and extra mocked relations', async () => {
    const result = await get().expect(200);
    const output = JSON.stringify(result.body);
    expect(output).not.toContain('DO_NOT_EXPOSE');
    expect(result.body.address).toEqual({
      addressId: 'd99d3fe9-a5fb-4f35-9218-88592106d61f',
      recipientName: 'Destinatário de demonstração',
      zipCode: '01001000',
      street: 'Rua de demonstração',
      number: '100',
      complement: null,
      neighborhood: 'Centro',
      city: 'São Paulo',
      state: 'SP',
    });
    expect(result.body.quote.package).toEqual({
      name: 'Pequena',
      height: 3,
      width: 12,
      length: 17,
      weight: 0.15,
      originZipCode: '78556858',
      destinationZipCode: '01001000',
      declaredValue: '10.00',
    });
    expect(result.body.items[0].orderItem).not.toHaveProperty('order');
  });
  it('returns absent snapshots, quote and label as null and does not present unquoted shipping as free', async () => {
    db.shipment.findUnique.mockResolvedValue({
      ...fixture(),
      addressSnapshot: null,
      selectedQuote: null,
      label: null,
      shippingMethod: 'TO_BE_DEFINED',
      shippingCost: new Prisma.Decimal(0),
    });
    const result = await get().expect(200);
    expect(result.body).toMatchObject({
      address: null,
      quote: null,
      label: null,
      shippingCost: null,
    });
  });
  it('does not invent missing or malformed historical address and package fields', async () => {
    db.shipment.findUnique.mockResolvedValue({
      ...fixture(),
      addressSnapshot: { recipientName: 'Incompleto' },
      selectedQuote: {
        ...fixture().selectedQuote,
        packageSnapshot: { name: 'Pequena', weight: -1 },
      },
    });
    const result = await get().expect(200);
    expect(result.body.address).toBeNull();
    expect(result.body.quote.package).toBeNull();
  });
  it('reads delivered shipments after they leave the active queue', async () => {
    db.shipment.findUnique.mockResolvedValue({
      ...fixture(),
      status: 'DELIVERED',
      shippedAt: now,
      deliveredAt: now,
      label: { ...fixture().label, status: 'DELIVERED', generatedAt: now },
    });
    const result = await get().expect(200);
    expect(result.body).toMatchObject({
      status: 'DELIVERED',
      shippedAt: now.toISOString(),
      deliveredAt: now.toISOString(),
      label: { status: 'DELIVERED', generatedAt: now.toISOString() },
    });
  });
  it('does not require provider configuration or call any external operation', async () => {
    provider.assertConfigured.mockImplementation(() => {
      throw new Error('Unconfigured');
    });
    await get().expect(200);
    for (const operation of Object.values(provider))
      expect(operation).not.toHaveBeenCalled();
  });
  it('does not leak database errors', async () => {
    db.shipment.findUnique.mockRejectedValue(
      new Error('postgres://DO_NOT_EXPOSE_DATABASE'),
    );
    const result = await get().expect(503);
    expect(result.body.message).toBe(
      'Operação de etiqueta indisponível. Consulte o estado antes de repetir.',
    );
    expect(JSON.stringify(result.body)).not.toContain('DO_NOT_EXPOSE');
  });
});

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { ShipmentLabel } from '../../generated/prisma/client.js';
import { ShipmentsModule } from './shipments.module.js';
import {
  MelhorEnvioLabelsService,
  LabelRequestRejected,
} from './integrations/melhor-envio-labels.service.js';
import type { RemoteLabel } from './integrations/melhor-envio-labels.service.js';

const userId = 'a99d3fe9-a5fb-4f35-9218-88592106d61f';
const id = 'b99d3fe9-a5fb-4f35-9218-88592106d61f';
const remoteId = 'c99d3fe9-a5fb-4f35-9218-88592106d61f';
const labelId = 'd99d3fe9-a5fb-4f35-9218-88592106d61f';
const secret = 'label-fixture-secret-at-least-thirty-two-bytes';
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
  recipientDocument: '52998224725',
  recipientPhone: '65999999999',
};
const amount = new Prisma.Decimal('12.68');
const fixture = () => ({
  id,
  userId,
  status: 'PREPARING',
  provider: 'melhorenvio:sandbox',
  shippingPaidAt: new Date(),
  shippingCost: amount,
  packedAt: new Date() as Date | null,
  packedById: userId,
  shippedAt: null,
  deliveredAt: null,
  user: { email: 'fixture@example.invalid' },
  payments: [{ status: 'PAID', amount, provider: 'asaas:sandbox' }],
  selectedQuote: {
    provider: 'melhorenvio:sandbox',
    amount,
    serviceCode: '2',
    packageSnapshot: {
      height: 3,
      width: 12,
      length: 17,
      weight: 0.15,
      originZipCode: '78556858',
      destinationZipCode: '78000000',
    },
  },
  addressSnapshot: {
    recipientName: 'Fixture',
    zipCode: '78000000',
    street: 'Rua',
    number: '1',
    complement: null,
    neighborhood: 'Centro',
    city: 'Cuiabá',
    state: 'MT',
  },
  items: [
    {
      quantity: 1,
      orderItem: {
        cardName: 'Snapshot',
        unitPrice: new Prisma.Decimal(10),
        order: {
          userId,
          paidAt: new Date(),
          status: 'PAID',
          payments: [{ status: 'PAID' }],
        },
      },
    },
  ],
});
const remoteFixture = (): RemoteLabel => ({
  id: remoteId,
  serviceCode: '2',
  status: 'pending',
  cost: '12.68',
  paid: false,
  generatedAt: null,
  postedAt: null,
  deliveredAt: null,
  tracking: null,
  tags: [id],
  fromZip: '78556858',
  toZip: '78000000',
  recipientDocument: body.recipientDocument,
});
describe('Administrative shipping labels', () => {
  let app: INestApplication<App>;
  let label: ShipmentLabel | null;
  let row: ReturnType<typeof fixture>;
  let remote: RemoteLabel;
  const db = {
    user: { findUnique: vi.fn() },
    shipment: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    shipmentLabel: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  const provider = {
    provider: 'melhorenvio:sandbox',
    assertConfigured: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    checkout: vi.fn(),
    generate: vi.fn(),
    print: vi.fn(),
  };
  const post = (path: string, input: unknown = {}) =>
    request(app.getHttpServer())
      .post(`/admin/shipments/${id}/${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(input as object);
  const create = () => post('label', body);
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
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', secret);
    vi.stubEnv('SHIPPING_ORIGIN_ZIP_CODE', '78556858');
    for (const [key, value] of Object.entries({
      NAME: 'Fixture',
      DOCUMENT: '52998224725',
      PHONE: '65999999999',
      EMAIL: 'fixture@example.invalid',
      STREET: 'Rua',
      NUMBER: '1',
      COMPLEMENT: '',
      NEIGHBORHOOD: 'Centro',
      CITY: 'Sinop',
      STATE: 'MT',
      STATE_REGISTER: '',
    }))
      vi.stubEnv(`SHIPPING_SENDER_${key}`, value);
    label = null;
    row = fixture();
    remote = remoteFixture();
    provider.provider = 'melhorenvio:sandbox';
    db.user.findUnique.mockResolvedValue({ id: userId, role: 'ADMIN' });
    db.$transaction.mockImplementation((work: (tx: unknown) => unknown) =>
      work(db),
    );
    db.shipment.findUnique.mockImplementation(async () => ({ ...row, label }));
    db.shipment.update.mockImplementation(
      async ({ data }: { data: Partial<typeof row> }) => {
        row = { ...row, ...data };
        return row;
      },
    );
    db.shipmentLabel.findUnique.mockImplementation(async () => label);
    db.shipmentLabel.create.mockImplementation(
      async ({ data }: { data: Partial<ShipmentLabel> }) => {
        label = {
          id: labelId,
          shipmentId: id,
          provider: provider.provider,
          requestedById: userId,
          requestSnapshot: {},
          status: 'INTENT',
          cost: null,
          remoteId: null,
          createStartedAt: null,
          checkoutStartedAt: null,
          generateStartedAt: null,
          generatedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        return label;
      },
    );
    db.shipmentLabel.update.mockImplementation(
      async ({ data }: { data: Partial<ShipmentLabel> }) => {
        label = { ...label!, ...data };
        if (typeof label.cost === 'string')
          label.cost = new Prisma.Decimal(label.cost);
        return label;
      },
    );
    db.shipmentLabel.updateMany.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<ShipmentLabel>;
      }) => {
        if (!label) return { count: 0 };
        for (const key of [
          'createStartedAt',
          'generateStartedAt',
          'remoteId',
        ] as const)
          if (where[key] === null && label[key] !== null) return { count: 0 };
        label = { ...label, ...data };
        return { count: 1 };
      },
    );
    provider.create.mockResolvedValue(remoteId);
    provider.get.mockImplementation(async () => remote);
    provider.checkout.mockImplementation(async () => {
      remote = { ...remote, paid: true, status: 'released' };
    });
    provider.generate.mockImplementation(async () => {
      remote = { ...remote, generatedAt: new Date(), tracking: 'TRACK123' };
    });
    provider.print.mockResolvedValue({
      url: 'https://sandbox.melhorenvio.com.br/imprimir/fixture',
      mode: 'private',
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('requires admin role', async () => {
    db.user.findUnique.mockResolvedValue({ id: userId, role: 'CUSTOMER' });
    await create().expect(403);
    expect(provider.create).not.toHaveBeenCalled();
  });
  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .post(`/admin/shipments/${id}/pack`)
      .expect(401);
  });
  it('records packing actor only after payment', async () => {
    row.packedAt = null;
    await post('pack').expect(200);
    expect(db.shipment.update.mock.calls[0][0].data.packedById).toBe(userId);
  });
  it('does not change packing actor on replay', async () => {
    await post('pack').expect(200);
    expect(db.shipment.update).not.toHaveBeenCalled();
  });
  it('rejects unpaid freight', async () => {
    row.payments = [];
    await create().expect(409);
    expect(provider.create).not.toHaveBeenCalled();
  });
  it('rejects refunded purchases', async () => {
    row.items[0].orderItem.order.payments = [{ status: 'REFUNDED' }];
    await create().expect(409);
  });
  it('requires confirmed packing', async () => {
    row.packedAt = null;
    await create().expect(409);
  });
  it('validates sender configuration without making a remote call', async () => {
    vi.stubEnv('SHIPPING_SENDER_NAME', '');
    await create().expect(503);
    expect(provider.create).not.toHaveBeenCalled();
  });
  it('requires same origin as paid quote', async () => {
    vi.stubEnv('SHIPPING_ORIGIN_ZIP_CODE', '01310100');
    await create().expect(409);
  });
  it('builds exact historical contents and snapshots recipient document separately from payer', async () => {
    const r = await create().expect(200);
    expect(r.body).toMatchObject({
      remoteId,
      status: 'PENDING',
      cost: '12.68',
    });
    expect(provider.create.mock.calls[0][0]).toMatchObject({
      service: 2,
      to: { document: body.recipientDocument },
      products: [{ name: 'Snapshot', quantity: 1, unitary_value: 10 }],
      volumes: [{ weight: 0.15 }],
      options: { tags: [{ tag: id, url: null }], non_commercial: true },
    });
    expect(r.body).not.toHaveProperty('requestSnapshot');
  });
  it('replays creation without posting another cart item', async () => {
    await create().expect(200);
    await create().expect(200);
    expect(provider.create).toHaveBeenCalledTimes(1);
  });
  it('rejects changed recipient on replay', async () => {
    await create().expect(200);
    await post('label', { ...body, recipientPhone: '11999999999' }).expect(409);
  });
  it('does not blindly retry ambiguous creation', async () => {
    provider.create.mockRejectedValue(new Error('uncertain'));
    await create().expect(503);
    await create().expect(409);
    expect(provider.create).toHaveBeenCalledTimes(1);
  });
  it('allows corrected provider validation failure to retry safely', async () => {
    provider.create.mockRejectedValueOnce(new LabelRequestRejected());
    await create().expect(400);
    await post('label', { ...body, recipientPhone: '11999999999' }).expect(200);
    expect(provider.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        to: expect.objectContaining({ phone: '11999999999' }),
      }),
    );
  });
  it('recovers a timed-out creation only from matching external data', async () => {
    provider.create.mockRejectedValueOnce(new Error('uncertain'));
    await create().expect(503);
    await post(`label/recover/${remoteId}`).expect(200);
    expect(label?.remoteId).toBe(remoteId);
  });
  it('rejects unrelated external label during recovery', async () => {
    provider.create.mockRejectedValueOnce(new Error('uncertain'));
    await create().expect(503);
    remote.tags = [];
    await post(`label/recover/${remoteId}`).expect(409);
    expect(label?.remoteId).toBeNull();
  });
  it('rejects a race when a different recovery already bound the label', async () => {
    provider.create.mockRejectedValueOnce(new Error('uncertain'));
    await create().expect(503);
    db.shipmentLabel.updateMany.mockResolvedValueOnce({ count: 0 });
    await post(`label/recover/${remoteId}`).expect(409);
  });
  it('requires expected cost to match remote cost', async () => {
    await create().expect(200);
    await post('label/checkout', { expectedCost: '10.00' }).expect(409);
    expect(provider.checkout).not.toHaveBeenCalled();
  });
  it('blocks a higher cost than the paid freight', async () => {
    await create().expect(200);
    remote.cost = '20.00';
    await post('label/checkout', { expectedCost: '20.00' }).expect(409);
    expect(provider.checkout).not.toHaveBeenCalled();
  });
  it('purchases once and generates before marking ready', async () => {
    await create().expect(200);
    await post('label/checkout', { expectedCost: '12.68' }).expect(200);
    expect(row.status).toBe('PREPARING');
    await post('label/checkout', { expectedCost: '12.68' }).expect(200);
    expect(provider.checkout).toHaveBeenCalledTimes(1);
    await post('label/generate').expect(200);
    expect(row.status).toBe('READY_TO_SHIP');
    await post('label/generate').expect(200);
    expect(provider.generate).toHaveBeenCalledTimes(1);
    await request(app.getHttpServer())
      .get(`/admin/shipments/${id}/label/print`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
  it('does not blindly repeat uncertain purchase', async () => {
    await create().expect(200);
    provider.checkout.mockRejectedValue(new Error('uncertain'));
    await post('label/checkout', { expectedCost: '12.68' }).expect(503);
    await post('label/checkout', { expectedCost: '12.68' }).expect(409);
    expect(provider.checkout).toHaveBeenCalledTimes(1);
  });
  it('lets insufficient-balance rejection retry after funding', async () => {
    await create().expect(200);
    provider.checkout.mockRejectedValueOnce(new LabelRequestRejected());
    await post('label/checkout', { expectedCost: '12.68' }).expect(400);
    await post('label/checkout', { expectedCost: '12.68' }).expect(200);
  });
  it('does not generate without a purchased label', async () => {
    await create().expect(200);
    await post('label/generate').expect(409);
  });
  it('does not blindly repeat uncertain generation', async () => {
    await create().expect(200);
    await post('label/checkout', { expectedCost: '12.68' }).expect(200);
    provider.generate.mockRejectedValue(new Error('uncertain'));
    await post('label/generate').expect(503);
    await post('label/generate').expect(409);
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it('syncs posting and delivery without downgrading shipping status', async () => {
    await create().expect(200);
    remote = {
      ...remote,
      paid: true,
      status: 'posted',
      generatedAt: new Date(),
      postedAt: new Date(),
      tracking: 'TRACK123',
    };
    await post('label/sync').expect(200);
    expect(row.status).toBe('SHIPPED');
    remote = { ...remote, status: 'delivered', deliveredAt: new Date() };
    await post('label/sync').expect(200);
    expect(row.status).toBe('DELIVERED');
    remote = remoteFixture();
    await post('label/sync').expect(200);
    expect(row.status).toBe('DELIVERED');
  });
  it('retains allocated items for cancelled remote labels pending review', async () => {
    await create().expect(200);
    remote.status = 'canceled';
    const r = await post('label/sync').expect(200);
    expect(r.body.status).toBe('REVIEW_REQUIRED');
    expect(row.status).toBe('PREPARING');
  });
  it('requires matching provider environment', async () => {
    await create().expect(200);
    provider.provider = 'melhorenvio:production';
    await post('label/sync').expect(409);
  });
  it('blocks production without invoice data', async () => {
    provider.provider = 'melhorenvio:production';
    row.provider = provider.provider;
    row.selectedQuote.provider = provider.provider;
    await create().expect(409);
  });
  it.each([
    {},
    { recipientDocument: '11111111111', recipientPhone: '123' },
    { ...body, invoiceKey: '123' },
    { ...body, shippingCost: '0.00' },
  ])('rejects invalid label body %#', async (input) => {
    await post('label', input).expect(400);
  });
  it('sanitizes internal failures', async () => {
    db.shipment.findUnique.mockRejectedValue(new Error('secret'));
    const r = await create().expect(503);
    expect(JSON.stringify(r.body)).not.toContain('secret');
  });
});

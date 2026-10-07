import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service.js';
import type { MelhorEnvioLabelsService } from './integrations/melhor-envio-labels.service.js';
import type { ShippingLabelsService } from './shipping-labels.service.js';
import { ShippingLabelSyncWorker } from './shipping-label-sync.worker.js';

describe('Shipping label synchronization worker', () => {
  const db = { shipmentLabel: { findMany: vi.fn() } };
  const labels = { sync: vi.fn() };
  const provider = {
    provider: 'melhorenvio:sandbox',
    assertConfigured: vi.fn(),
  };
  let worker: ShippingLabelSyncWorker;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('MELHOR_ENVIO_TOKEN', 'fixture');
    vi.stubEnv('SHIPPING_LABEL_SYNC_ENABLED', 'true');
    vi.stubEnv('SHIPPING_LABEL_SYNC_INTERVAL_SECONDS', '60');
    db.shipmentLabel.findMany.mockResolvedValue([]);
    worker = new ShippingLabelSyncWorker(
      db as unknown as PrismaService,
      provider as unknown as MelhorEnvioLabelsService,
      labels as unknown as ShippingLabelsService,
    );
  });
  afterEach(async () => {
    await worker.onModuleDestroy();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it('skips work without a token or when disabled', async () => {
    vi.stubEnv('MELHOR_ENVIO_TOKEN', '');
    await worker.tick();
    vi.stubEnv('MELHOR_ENVIO_TOKEN', 'fixture');
    vi.stubEnv('SHIPPING_LABEL_SYNC_ENABLED', 'false');
    worker.onModuleInit();
    await worker.tick();
    expect(db.shipmentLabel.findMany).not.toHaveBeenCalled();
  });
  it('filters environment, remote binding and terminal shipments', async () => {
    await worker.tick();
    expect(db.shipmentLabel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: 'melhorenvio:sandbox',
          remoteId: { not: null },
          status: {
            notIn: expect.arrayContaining(['DELIVERED', 'REVIEW_REQUIRED']),
          },
          shipment: {
            status: { in: ['PREPARING', 'READY_TO_SHIP', 'SHIPPED'] },
          },
        }),
      }),
    );
  });
  it('isolates failures and advances then resets the cursor', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    db.shipmentLabel.findMany.mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, i) => ({
        id: `label-${i}`,
        shipmentId: `shipment-${i}`,
      })),
    );
    labels.sync.mockRejectedValueOnce(new Error('secret'));
    await worker.tick();
    expect(labels.sync).toHaveBeenCalledTimes(20);
    expect(warn.mock.calls[0][0]).not.toContain('secret');
    await worker.tick();
    expect(db.shipmentLabel.findMany.mock.calls[1][0].where.id).toEqual({
      gt: 'label-19',
    });
    await worker.tick();
    expect(db.shipmentLabel.findMany.mock.calls[2][0].where.id).toBeUndefined();
  });
  it('uses configured interval, prevents overlap and stops on shutdown', async () => {
    vi.useFakeTimers();
    vi.stubEnv('SHIPPING_LABEL_SYNC_INTERVAL_SECONDS', '30');
    let finish!: (value: []) => void;
    db.shipmentLabel.findMany.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    worker.onModuleInit();
    await vi.advanceTimersByTimeAsync(90000);
    expect(db.shipmentLabel.findMany).toHaveBeenCalledTimes(1);
    finish([]);
    await worker.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(90000);
    await worker.tick();
    expect(db.shipmentLabel.findMany).toHaveBeenCalledTimes(1);
  });
  it.each(['0', '29', '3601', 'abc', '30.5'])(
    'rejects invalid interval %s',
    (value) => {
      vi.stubEnv('SHIPPING_LABEL_SYNC_INTERVAL_SECONDS', value);
      expect(() => worker.onModuleInit()).toThrow('entre 30 e 3600');
    },
  );
  it('recovers on the next tick after a database failure without logging secrets', async () => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    db.shipmentLabel.findMany.mockRejectedValueOnce(
      new Error('secret connection'),
    );
    await worker.tick();
    await worker.tick();
    expect(db.shipmentLabel.findMany).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).not.toContain('secret');
  });
});

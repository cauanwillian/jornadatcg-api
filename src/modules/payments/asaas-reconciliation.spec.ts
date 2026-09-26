import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service.js';
import type { AsaasService } from './integrations/asaas.service.js';
import type { AsaasPixService } from './asaas-pix.service.js';
import { AsaasReconciliationWorker } from './asaas-reconciliation.worker.js';

describe('Asaas reconciliation worker', () => {
  const db = { payment: { findMany: vi.fn() } };
  const pix = { reconcileOne: vi.fn() };
  let worker: AsaasReconciliationWorker;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('ASAAS_API_KEY', 'test-key');
    db.payment.findMany.mockResolvedValue([]);
    pix.reconcileOne.mockResolvedValue({ status: 'PENDING' });
    worker = new AsaasReconciliationWorker(
      db as unknown as PrismaService,
      { provider: 'asaas:sandbox' } as AsaasService,
      pix as unknown as AsaasPixService,
    );
  });
  afterEach(async () => {
    await worker.onModuleDestroy();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it('does not access the database or provider without configuration', async () => {
    vi.stubEnv('ASAAS_API_KEY', '');
    await worker.tick();
    expect(db.payment.findMany).not.toHaveBeenCalled();
  });
  it('isolates failures, advances through full batches, and wraps the cursor', async () => {
    const warning = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    db.payment.findMany.mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, i) => ({
        id: `payment-${String(i).padStart(2, '0')}`,
      })),
    );
    pix.reconcileOne.mockRejectedValueOnce(new Error('secret'));
    await worker.tick();
    expect(pix.reconcileOne).toHaveBeenCalledTimes(20);
    expect(warning.mock.calls[0][0]).not.toContain('secret');
    expect(db.payment.findMany.mock.calls[0][0].where).toMatchObject({
      provider: 'asaas:sandbox',
      status: 'PENDING',
    });
    await worker.tick();
    expect(db.payment.findMany.mock.calls[1][0].where.id).toEqual({
      gt: 'payment-19',
    });
    await worker.tick();
    expect(db.payment.findMany.mock.calls[2][0].where).not.toHaveProperty('id');
  });
  it('prevents overlap and stops its interval on shutdown', async () => {
    vi.useFakeTimers();
    let finish!: (value: []) => void;
    db.payment.findMany.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    worker.onModuleInit();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(db.payment.findMany).toHaveBeenCalledTimes(1);
    finish([]);
    await worker.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(db.payment.findMany).toHaveBeenCalledTimes(1);
  });
});

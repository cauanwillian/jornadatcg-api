import { Logger } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { OrderExpirationService } from './order-expiration.service.js';
import { OrderExpirationWorker } from './order-expiration.worker.js';
import { OrderReservationConfig } from './order-reservation.config.js';

describe('Order reservation expiry', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  const db = {
    order: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    inventory: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  let service: OrderExpirationService;
  beforeEach(() => {
    vi.resetAllMocks();
    db.order.findMany.mockResolvedValue([{ id: 'order-1' }]);
    db.order.findFirst.mockResolvedValue({
      id: 'order-1',
      items: [{ productId: 'product-1', quantity: 3 }],
    });
    db.order.updateMany.mockResolvedValue({ count: 1 });
    db.inventory.updateMany.mockResolvedValue({ count: 1 });
    db.$transaction.mockImplementation(
      (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        work(db as unknown as Prisma.TransactionClient),
    );
    service = new OrderExpirationService(db as unknown as PrismaService);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('expires only overdue pending orders without an active payment', async () => {
    expect(await service.expireBatch(now)).toEqual({
      examined: 1,
      expired: 1,
      failed: 0,
    });
    expect(db.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'PENDING_PAYMENT',
          expiresAt: { lte: now },
          payments: {
            none: { status: { in: ['PENDING', 'PAID', 'REFUNDED'] } },
          },
        },
      }),
    );
    expect(db.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'CANCELLED', cancelledAt: now },
      }),
    );
    expect(db.inventory.updateMany).toHaveBeenCalledWith({
      where: {
        productId: 'product-1',
        reservedQuantity: { gte: 3 },
        availableQuantity: { lte: 2147483644 },
      },
      data: {
        reservedQuantity: { decrement: 3 },
        availableQuantity: { increment: 3 },
      },
    });
  });
  it('rechecks eligibility inside the transaction and skips changed orders', async () => {
    db.order.findFirst.mockResolvedValue(null);
    expect(await service.expireBatch(now)).toEqual({
      examined: 1,
      expired: 0,
      failed: 0,
    });
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
    expect(db.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'order-1',
          expiresAt: { lte: now },
        }),
      }),
    );
  });
  it('does not release stock when another worker won the transition', async () => {
    db.order.updateMany.mockResolvedValue({ count: 0 });
    expect((await service.expireBatch(now)).expired).toBe(0);
    expect(db.inventory.updateMany).not.toHaveBeenCalled();
  });
  it('continues to later orders after an inconsistent reservation', async () => {
    db.order.findMany.mockResolvedValue([{ id: 'order-1' }, { id: 'order-2' }]);
    db.inventory.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await service.expireBatch(now)).toEqual({
      examined: 2,
      expired: 1,
      failed: 1,
    });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });
  it('advances past a full batch of failures so other orders are not starved', async () => {
    db.order.findMany.mockResolvedValueOnce(
      Array.from({ length: 100 }, (_, i) => ({
        id: String(i).padStart(3, '0'),
      })),
    );
    db.$transaction.mockRejectedValue(new Error('internal'));
    expect((await service.expireBatch(now)).failed).toBe(100);
    db.order.findMany.mockResolvedValue([]);
    await service.expireBatch(now);
    expect(db.order.findMany.mock.calls[1][0].where.id).toEqual({ gt: '099' });
    await service.expireBatch(now);
    expect(db.order.findMany.mock.calls[2][0].where).not.toHaveProperty('id');
  });
  it('defaults to 30 minutes and preserves an explicit configured deadline', () => {
    vi.stubEnv('ORDER_RESERVATION_MINUTES', undefined);
    expect(new OrderReservationConfig().deadline(now).toISOString()).toBe(
      '2026-09-26T12:30:00.000Z',
    );
    vi.stubEnv('ORDER_RESERVATION_MINUTES', '60');
    expect(new OrderReservationConfig().deadline(now).toISOString()).toBe(
      '2026-09-26T13:00:00.000Z',
    );
  });
  it.each(['0', '-1', '1.5', '1441', 'invalid', ''])(
    'rejects invalid expiry config %s',
    (value) => {
      vi.stubEnv('ORDER_RESERVATION_MINUTES', value);
      expect(() => new OrderReservationConfig()).toThrow(
        'ORDER_RESERVATION_MINUTES',
      );
    },
  );
});

describe('Order expiration worker', () => {
  it('runs every minute and stops on module shutdown', async () => {
    vi.useFakeTimers();
    const expireBatch = vi
      .fn()
      .mockResolvedValue({ examined: 0, expired: 0, failed: 0 });
    const worker = new OrderExpirationWorker({
      expireBatch,
    } as unknown as OrderExpirationService);
    try {
      worker.onModuleInit();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(expireBatch).toHaveBeenCalledTimes(1);
      await worker.onModuleDestroy();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(expireBatch).toHaveBeenCalledTimes(1);
    } finally {
      await worker.onModuleDestroy();
      vi.useRealTimers();
    }
  });
  it('prevents overlapping runs and waits for completion on shutdown', async () => {
    let finish!: (value: { failed: number }) => void;
    const expireBatch = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const worker = new OrderExpirationWorker({
      expireBatch,
    } as unknown as OrderExpirationService);
    const first = worker.tick();
    const second = worker.tick();
    expect(expireBatch).toHaveBeenCalledTimes(1);
    finish({ failed: 0 });
    await Promise.all([first, second, worker.onModuleDestroy()]);
  });
  it('sanitizes background failures and recovers on the next run', async () => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const expireBatch = vi
      .fn()
      .mockRejectedValueOnce(new Error('secret'))
      .mockResolvedValue({ failed: 0 });
    const worker = new OrderExpirationWorker({
      expireBatch,
    } as unknown as OrderExpirationService);
    try {
      await worker.tick();
      await worker.tick();
      expect(expireBatch).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalledWith(
        'Não foi possível consultar pedidos para expiração.',
      );
    } finally {
      log.mockRestore();
    }
  });
});

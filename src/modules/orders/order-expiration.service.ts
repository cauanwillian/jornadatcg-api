import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { moveReservedStock } from './order-stock.js';

@Injectable()
export class OrderExpirationService {
  private cursor: string | undefined;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async expireBatch(now = new Date()) {
    // An in-flight provider payment must be reconciled before releasing its stock.
    const where: Prisma.OrderWhereInput = {
      status: 'PENDING_PAYMENT',
      expiresAt: { lte: now },
      payments: {
        none: {
          status: {
            in: ['PENDING', 'PAID', 'REFUNDED'],
          },
        },
      },
    };
    const candidates = await this.prisma.order.findMany({
      where: { ...where, ...(this.cursor ? { id: { gt: this.cursor } } : {}) },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
    const result = { examined: candidates.length, expired: 0, failed: 0 };
    for (const { id } of candidates) {
      try {
        const expired = await this.prisma.$transaction(
          async (tx) => {
            const order = await tx.order.findFirst({
              where: { ...where, id },
              select: {
                id: true,
                items: { select: { productId: true, quantity: true } },
              },
            });
            if (!order) return false;
            const changed = await tx.order.updateMany({
              where: { ...where, id },
              data: { status: 'CANCELLED', cancelledAt: now },
            });
            if (changed.count !== 1) return false;
            await moveReservedStock(tx, order.items, 'availableQuantity');
            return true;
          },
          { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15000 },
        );
        if (expired) result.expired++;
      } catch {
        // Retry on a later sweep; a bad reservation must not stop other orders.
        result.failed++;
      }
    }
    this.cursor = candidates.length === 100 ? candidates.at(-1)?.id : undefined;
    return result;
  }
}

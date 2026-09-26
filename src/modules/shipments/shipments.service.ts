import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { AvailableItemsQuery } from './dto/available-items.dto.js';

interface AvailableRow {
  orderItemId: string;
  orderId: string;
  orderNumber: number;
  paidAt: Date;
  productId: string | null;
  cardName: string;
  cardNumber: string;
  setName: string;
  conditionName: string;
  languageName: string;
  categoryName: string | null;
  purchasedQuantity: number;
  allocatedQuantity: number;
  availableQuantity: number;
  unitPrice: Prisma.Decimal;
  availableSubtotal: Prisma.Decimal;
}

@Injectable()
export class ShipmentsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async availableItems(userId: string, query: AvailableItemsQuery) {
    // Aggregate before pagination so fully allocated purchases do not create empty pages.
    // Every input is a bound parameter; current product stock/price are irrelevant here.
    const eligible = Prisma.sql`
      WITH eligible AS (
        SELECT oi.*, o."orderNumber", o."paidAt",
          COALESCE((SELECT SUM(si.quantity) FROM shipment_items si
            JOIN shipments s ON s.id = si."shipmentId"
            WHERE si."orderItemId" = oi.id AND s.status <> 'CANCELLED'), 0) AS allocated
        FROM order_items oi JOIN orders o ON o.id = oi."orderId"
        WHERE o."userId" = ${userId}::uuid
          AND o.status IN ('PAID', 'PREPARING', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED')
          AND o."paidAt" IS NOT NULL
          AND EXISTS (SELECT 1 FROM payments p WHERE p."orderId" = o.id AND p.status = 'PAID')
          AND NOT EXISTS (SELECT 1 FROM payments p WHERE p."orderId" = o.id AND p.status = 'REFUNDED')
      ), available AS (SELECT * FROM eligible WHERE quantity > allocated AND allocated >= 0)
    `;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const [totals] = await tx.$queryRaw<
            {
              total: bigint;
              availableQuantity: bigint;
              availableValue: Prisma.Decimal;
            }[]
          >(Prisma.sql`
          ${eligible} SELECT COUNT(*) AS total, COALESCE(SUM(quantity - allocated), 0)::bigint AS "availableQuantity",
          COALESCE(SUM((quantity - allocated) * "unitPrice"), 0) AS "availableValue" FROM available
        `);
          const rows = await tx.$queryRaw<AvailableRow[]>(Prisma.sql`
          ${eligible} SELECT id AS "orderItemId", "orderId", "orderNumber", "paidAt", "productId", "cardName", "cardNumber", "setName",
          "conditionName", "languageName", "categoryName", quantity AS "purchasedQuantity", allocated::integer AS "allocatedQuantity",
          (quantity - allocated)::integer AS "availableQuantity", "unitPrice", (quantity - allocated) * "unitPrice" AS "availableSubtotal"
          FROM available ORDER BY "paidAt" ASC, "orderId" ASC, id ASC
          LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
        `);
          return {
            items: rows.map((row) => ({
              ...row,
              paidAt: row.paidAt.toISOString(),
              unitPrice: row.unitPrice.toFixed(2),
              availableSubtotal: row.availableSubtotal.toFixed(2),
            })),
            page: query.page,
            pageSize: query.pageSize,
            total: Number(totals.total),
            summary: {
              availableQuantity: Number(totals.availableQuantity),
              availableValue: totals.availableValue.toFixed(2),
            },
          };
        },
        { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 10000 },
      );
    } catch {
      throw new ServiceUnavailableException(
        'Compras acumuladas temporariamente indisponíveis.',
      );
    }
  }
}

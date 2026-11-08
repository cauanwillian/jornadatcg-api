import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  AdminInventoryQuery,
  InventoryStockFilter,
} from './dto/admin-inventory.dto.js';

const select = {
  id: true,
  active: true,
  card: {
    select: {
      id: true,
      name: true,
      number: true,
      set: { select: { id: true, name: true } },
    },
  },
  category: { select: { id: true, name: true } },
  condition: { select: { id: true, name: true } },
  language: { select: { id: true, name: true } },
  inventory: {
    select: {
      availableQuantity: true,
      reservedQuantity: true,
      soldQuantity: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.ProductSelect;

function stockWhere(
  stock: InventoryStockFilter,
  threshold: number,
): Prisma.ProductWhereInput {
  switch (stock) {
    case 'available':
      return { inventory: { is: { availableQuantity: { gt: 0 } } } };
    case 'out':
      return { inventory: { is: { availableQuantity: 0 } } };
    case 'low':
      return {
        inventory: { is: { availableQuantity: { gt: 0, lte: threshold } } },
      };
    case 'reserved':
      return { inventory: { is: { reservedQuantity: { gt: 0 } } } };
    case 'missing':
      return { inventory: null };
  }
}

@Injectable()
export class AdminInventoryService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async list(query: AdminInventoryQuery) {
    const where: Prisma.ProductWhereInput = {
      ...(query.name
        ? {
            card: {
              name: {
                contains: query.name.replace(/[\\%_]/g, '\\$&'),
                mode: 'insensitive',
              },
            },
          }
        : {}),
      ...(query.active === undefined ? {} : { active: query.active }),
      ...(query.stock ? stockWhere(query.stock, query.lowStockThreshold) : {}),
    };
    try {
      return await this.db.$transaction(
        async (tx) => {
          const count = (stock: InventoryStockFilter) =>
            tx.product.count({
              where: {
                AND: [where, stockWhere(stock, query.lowStockThreshold)],
              },
            });
          const [
            total,
            availableCount,
            outOfStockCount,
            lowStockCount,
            reservedCount,
            missingInventoryCount,
            items,
          ] = await Promise.all([
            tx.product.count({ where }),
            count('available'),
            count('out'),
            count('low'),
            count('reserved'),
            count('missing'),
            tx.product.findMany({
              where,
              select,
              orderBy: [{ card: { name: 'asc' } }, { id: 'asc' }],
              skip: (query.page - 1) * query.pageSize,
              take: query.pageSize,
            }),
          ]);
          return {
            items: items.map((item) => ({
              id: item.id,
              active: item.active,
              card: {
                id: item.card.id,
                name: item.card.name,
                number: item.card.number,
                set: { id: item.card.set.id, name: item.card.set.name },
              },
              category: { id: item.category.id, name: item.category.name },
              condition: { id: item.condition.id, name: item.condition.name },
              language: { id: item.language.id, name: item.language.name },
              inventory: item.inventory
                ? {
                    availableQuantity: item.inventory.availableQuantity,
                    reservedQuantity: item.inventory.reservedQuantity,
                    soldQuantity: item.inventory.soldQuantity,
                    updatedAt: item.inventory.updatedAt.toISOString(),
                  }
                : null,
            })),
            page: query.page,
            pageSize: query.pageSize,
            total,
            lowStockThreshold: query.lowStockThreshold,
            summary: {
              productCount: total,
              availableCount,
              outOfStockCount,
              lowStockCount,
              reservedCount,
              missingInventoryCount,
            },
          };
        },
        { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 15_000 },
      );
    } catch {
      throw new ServiceUnavailableException(
        'Consulta de estoque temporariamente indisponível.',
      );
    }
  }
}

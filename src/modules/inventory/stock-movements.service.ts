import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { StockMovementsQuery } from './dto/stock-movements.dto.js';
import {
  movementSelect,
  toStockMovementDto,
} from './dto/stock-movement-result.dto.js';

@Injectable()
export class StockMovementsService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async list(query: StockMovementsQuery) {
    const where: Prisma.InventoryMovementWhereInput = {
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lt: query.to } : {}),
            },
          }
        : {}),
    };
    try {
      return await this.db.$transaction(
        async (tx) => {
          const [total, movements] = await Promise.all([
            tx.inventoryMovement.count({ where }),
            tx.inventoryMovement.findMany({
              where,
              select: movementSelect,
              orderBy: { sequence: 'desc' },
              skip: (query.page - 1) * query.pageSize,
              take: query.pageSize,
            }),
          ]);
          return {
            items: movements.map(toStockMovementDto),
            page: query.page,
            pageSize: query.pageSize,
            total,
          };
        },
        { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 15_000 },
      );
    } catch {
      throw new ServiceUnavailableException(
        'Histórico de estoque temporariamente indisponível.',
      );
    }
  }
}

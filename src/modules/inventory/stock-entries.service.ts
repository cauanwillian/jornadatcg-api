import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { StockEntryDto } from './dto/stock-entry.dto.js';
import {
  movementSelect,
  toStockMovementDto,
} from './dto/stock-movement-result.dto.js';
import { recordStockMovement } from './record-stock-movement.js';

const entrySelect = {
  ...movementSelect,
  actorId: true,
} satisfies Prisma.InventoryMovementSelect;
const unavailable = () =>
  new ServiceUnavailableException(
    'Entradas de estoque temporariamente indisponíveis.',
  );
const conflict = () =>
  new ConflictException(
    'A entrada não pôde ser confirmada. Consulte o estoque e a tentativa antes de continuar.',
  );

@Injectable()
export class StockEntriesService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async create(
    productId: string,
    actorId: string,
    operationKey: string,
    input: StockEntryDto,
  ) {
    return this.transaction(async (tx) => {
      const where = { productId_operationKey: { productId, operationKey } };
      const existing = await tx.inventoryMovement.findUnique({
        where,
        select: entrySelect,
      });
      if (existing) {
        if (
          existing.type !== 'STOCK_RECEIPT' ||
          existing.actorId !== actorId ||
          existing.availableDelta !== input.quantity ||
          existing.reason !== input.reason
        )
          throw new ConflictException(
            'Esta chave já foi utilizada para outra entrada de estoque.',
          );
        return toStockMovementDto(existing);
      }
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true },
      });
      if (!product) throw new NotFoundException('Produto não encontrado.');
      const updated = await tx.inventory.updateMany({
        where: {
          productId,
          availableQuantity: { lte: 2_147_483_647 - input.quantity },
        },
        data: { availableQuantity: { increment: input.quantity } },
      });
      if (updated.count !== 1)
        throw new ConflictException(
          'Estoque não cadastrado ou quantidade acima do limite. Consulte o produto.',
        );
      await recordStockMovement(tx, {
        productId,
        actorId,
        operationKey,
        type: 'STOCK_RECEIPT',
        reason: input.reason,
        delta: {
          availableQuantity: input.quantity,
          reservedQuantity: 0,
          soldQuantity: 0,
        },
      });
      const receipt = await tx.inventoryMovement.findUnique({
        where,
        select: entrySelect,
      });
      if (!receipt) throw unavailable();
      return toStockMovementDto(receipt);
    });
  }

  async find(productId: string, actorId: string, operationKey: string) {
    try {
      const receipt = await this.db.inventoryMovement.findUnique({
        where: { productId_operationKey: { productId, operationKey } },
        select: entrySelect,
      });
      if (
        !receipt ||
        receipt.type !== 'STOCK_RECEIPT' ||
        receipt.actorId !== actorId
      )
        throw new NotFoundException('Entrada de estoque não encontrada.');
      return toStockMovementDto(receipt);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw unavailable();
    }
  }

  private async transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction(work, {
          isolationLevel: 'Serializable',
          maxWait: 5000,
          timeout: 15_000,
        });
      } catch (error) {
        if (error instanceof HttpException) throw error;
        const code =
          error && typeof error === 'object' && 'code' in error
            ? error.code
            : undefined;
        if (code === 'P2034' || code === 'P2002') {
          if (attempt < 2) continue;
          throw conflict();
        }
        throw unavailable();
      }
    }
    throw unavailable();
  }
}

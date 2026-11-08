import { ConflictException } from '@nestjs/common';
import type {
  InventoryMovementType,
  Prisma,
} from '../../generated/prisma/client.js';

interface StockChange {
  productId: string;
  type: InventoryMovementType;
  delta: {
    availableQuantity: number;
    reservedQuantity: number;
    soldQuantity: number;
  };
  orderId?: string;
  orderNumber?: number;
  actorId?: string;
  reason?: string | null;
  operationKey?: string;
}
const maximum = 2_147_483_647;
const invalid = () =>
  new ConflictException(
    'Movimentação de estoque inconsistente. Consulte os dados novamente.',
  );

/** Run after the stock write, using the SAME transaction while its row lock is held. */
export async function recordStockMovement(
  tx: Prisma.TransactionClient,
  input: StockChange,
): Promise<void> {
  const delta = input.delta;
  if (
    Object.values(delta).some(
      (value) => !Number.isInteger(value) || Math.abs(value) > maximum,
    )
  )
    throw invalid();
  if (
    input.type === 'MANUAL_ADJUSTMENT' &&
    Object.values(delta).every((value) => value === 0)
  )
    return;
  const stock = await tx.inventory.findUniqueOrThrow({
    where: { productId: input.productId },
    select: {
      availableQuantity: true,
      reservedQuantity: true,
      soldQuantity: true,
      product: {
        select: {
          card: {
            select: {
              name: true,
              number: true,
              set: { select: { name: true } },
            },
          },
          category: { select: { name: true } },
          condition: { select: { name: true } },
          language: { select: { name: true } },
        },
      },
    },
  });
  const before = {
    availableQuantity: stock.availableQuantity - delta.availableQuantity,
    reservedQuantity: stock.reservedQuantity - delta.reservedQuantity,
    soldQuantity: stock.soldQuantity - delta.soldQuantity,
  };
  if (
    [
      ...Object.values(before),
      stock.availableQuantity,
      stock.reservedQuantity,
      stock.soldQuantity,
    ].some((value) => !Number.isInteger(value) || value < 0 || value > maximum)
  )
    throw invalid();
  await tx.inventoryMovement.create({
    data: {
      productId: input.productId,
      type: input.type,
      actorId: input.actorId ?? null,
      orderId: input.orderId ?? null,
      orderNumber: input.orderNumber ?? null,
      reason: input.reason ?? null,
      ...(input.operationKey === undefined
        ? {}
        : { operationKey: input.operationKey }),
      cardName: stock.product.card.name,
      cardNumber: stock.product.card.number,
      setName: stock.product.card.set.name,
      categoryName: stock.product.category.name,
      conditionName: stock.product.condition.name,
      languageName: stock.product.language.name,
      availableBefore: before.availableQuantity,
      reservedBefore: before.reservedQuantity,
      soldBefore: before.soldQuantity,
      availableDelta: delta.availableQuantity,
      reservedDelta: delta.reservedQuantity,
      soldDelta: delta.soldQuantity,
      availableAfter: stock.availableQuantity,
      reservedAfter: stock.reservedQuantity,
      soldAfter: stock.soldQuantity,
    },
  });
}

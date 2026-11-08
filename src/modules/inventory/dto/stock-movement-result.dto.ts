import type { Prisma } from '../../../generated/prisma/client.js';

export const movementSelect = {
  id: true,
  sequence: true,
  productId: true,
  orderId: true,
  orderNumber: true,
  actor: { select: { id: true, name: true } },
  type: true,
  reason: true,
  cardName: true,
  cardNumber: true,
  setName: true,
  categoryName: true,
  conditionName: true,
  languageName: true,
  availableBefore: true,
  reservedBefore: true,
  soldBefore: true,
  availableDelta: true,
  reservedDelta: true,
  soldDelta: true,
  availableAfter: true,
  reservedAfter: true,
  soldAfter: true,
  createdAt: true,
} satisfies Prisma.InventoryMovementSelect;

export type StockMovementRecord = Prisma.InventoryMovementGetPayload<{
  select: typeof movementSelect;
}>;

export function toStockMovementDto(movement: StockMovementRecord) {
  return {
    id: movement.id,
    sequence: movement.sequence.toString(),
    type: movement.type,
    createdAt: movement.createdAt.toISOString(),
    product: {
      id: movement.productId,
      cardName: movement.cardName,
      cardNumber: movement.cardNumber,
      setName: movement.setName,
      categoryName: movement.categoryName,
      conditionName: movement.conditionName,
      languageName: movement.languageName,
    },
    order:
      movement.orderNumber === null
        ? null
        : {
            id: movement.orderId,
            orderNumber: movement.orderNumber,
          },
    actor: movement.actor
      ? { id: movement.actor.id, name: movement.actor.name }
      : null,
    reason: movement.reason,
    before: {
      availableQuantity: movement.availableBefore,
      reservedQuantity: movement.reservedBefore,
      soldQuantity: movement.soldBefore,
    },
    change: {
      availableQuantity: movement.availableDelta,
      reservedQuantity: movement.reservedDelta,
      soldQuantity: movement.soldDelta,
    },
    after: {
      availableQuantity: movement.availableAfter,
      reservedQuantity: movement.reservedAfter,
      soldQuantity: movement.soldAfter,
    },
  };
}

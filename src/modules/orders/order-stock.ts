import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';

const MAX_STOCK = 2147483647;

/** Called only inside the transaction that transitions the order status. */
export async function moveReservedStock(
  tx: Prisma.TransactionClient,
  items: ReadonlyArray<{ productId: string | null; quantity: number }>,
  destination: 'availableQuantity' | 'soldQuantity',
) {
  if (!items.length)
    throw new ConflictException('Pedido sem itens. Contate o suporte.');
  const quantities = new Map<string, number>();
  for (const item of items) {
    if (
      !item.productId ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1
    ) {
      throw new ConflictException('Reserva inconsistente. Contate o suporte.');
    }
    quantities.set(
      item.productId,
      (quantities.get(item.productId) ?? 0) + item.quantity,
    );
  }
  for (const [productId, quantity] of [...quantities].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (quantity > MAX_STOCK)
      throw new ConflictException('Reserva inconsistente. Contate o suporte.');
    const changed = await tx.inventory.updateMany({
      where: {
        productId,
        reservedQuantity: { gte: quantity },
        [destination]: { lte: MAX_STOCK - quantity },
      },
      data: {
        reservedQuantity: { decrement: quantity },
        [destination]: { increment: quantity },
      },
    });
    if (changed.count !== 1)
      throw new ConflictException(
        'Não foi possível movimentar a reserva deste pedido. Contate o suporte.',
      );
  }
}

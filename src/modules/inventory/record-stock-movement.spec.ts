import type { Prisma } from '../../generated/prisma/client.js';
import { recordStockMovement } from './record-stock-movement.js';

const productId = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';
const actorId = '11111111-1111-4111-8111-111111111111';
type Input = Parameters<typeof recordStockMovement>[1];
const manual = (delta: number): Input => ({
  productId,
  type: 'MANUAL_ADJUSTMENT',
  actorId,
  reason: 'Conferência das cartas recebidas',
  delta: { availableQuantity: delta, reservedQuantity: 0, soldQuantity: 0 },
});

function context(
  availableQuantity = 7,
  reservedQuantity = 3,
  soldQuantity = 4,
) {
  const stock = {
    availableQuantity,
    reservedQuantity,
    soldQuantity,
    product: {
      card: {
        name: 'Pikachu histórico',
        number: '025',
        set: { name: 'Coleção histórica' },
      },
      category: { name: 'Cartas avulsas' },
      condition: { name: 'Near Mint' },
      language: { name: 'Português' },
    },
  };
  const db = {
    inventory: { findUniqueOrThrow: vi.fn().mockResolvedValue(stock) },
    inventoryMovement: {
      create: vi.fn().mockResolvedValue({ id: 'recorded' }),
    },
  };
  return { stock, db, tx: db as unknown as Prisma.TransactionClient };
}

describe('Stock movement transaction helper', () => {
  it('records reservation equations and immutable labels through the caller transaction', async () => {
    const { tx, db, stock } = context();
    await recordStockMovement(tx, {
      productId,
      type: 'ORDER_RESERVED',
      orderId,
      orderNumber: 42,
      delta: { availableQuantity: -3, reservedQuantity: 3, soldQuantity: 0 },
    });
    expect(db.inventory.findUniqueOrThrow.mock.calls[0][0].where).toEqual({
      productId,
    });
    expect(db.inventoryMovement.create).toHaveBeenCalledExactlyOnceWith({
      data: {
        productId,
        type: 'ORDER_RESERVED',
        orderId,
        orderNumber: 42,
        actorId: null,
        reason: null,
        cardName: 'Pikachu histórico',
        cardNumber: '025',
        setName: 'Coleção histórica',
        categoryName: 'Cartas avulsas',
        conditionName: 'Near Mint',
        languageName: 'Português',
        availableBefore: 10,
        reservedBefore: 0,
        soldBefore: 4,
        availableDelta: -3,
        reservedDelta: 3,
        soldDelta: 0,
        availableAfter: 7,
        reservedAfter: 3,
        soldAfter: 4,
      },
    });
    stock.product.card.name = 'Nome modificado depois';
    expect(db.inventoryMovement.create.mock.calls[0][0].data.cardName).toBe(
      'Pikachu histórico',
    );
    expect(
      db.inventory.findUniqueOrThrow.mock.invocationCallOrder[0],
    ).toBeLessThan(db.inventoryMovement.create.mock.invocationCallOrder[0]);
  });

  it('keeps negative manual changes, administrator and reason without moving reserved or sold quantities', async () => {
    const { tx, db } = context(2, 9, 10);
    await recordStockMovement(tx, manual(-3));
    expect(db.inventoryMovement.create.mock.calls[0][0].data).toMatchObject({
      type: 'MANUAL_ADJUSTMENT',
      actorId,
      reason: 'Conferência das cartas recebidas',
      orderId: null,
      orderNumber: null,
      availableBefore: 5,
      availableDelta: -3,
      availableAfter: 2,
      reservedBefore: 9,
      reservedDelta: 0,
      reservedAfter: 9,
      soldBefore: 10,
      soldDelta: 0,
      soldAfter: 10,
    });
  });

  it('records a newly initialized product even when its initial quantity is zero', async () => {
    const { tx, db } = context(0, 0, 0);
    await recordStockMovement(tx, {
      productId,
      type: 'INITIAL_STOCK',
      delta: { availableQuantity: 0, reservedQuantity: 0, soldQuantity: 0 },
    });
    expect(db.inventoryMovement.create).toHaveBeenCalledTimes(1);
    expect(db.inventoryMovement.create.mock.calls[0][0].data).toMatchObject({
      type: 'INITIAL_STOCK',
      availableBefore: 0,
      availableDelta: 0,
      availableAfter: 0,
      reservedBefore: 0,
      reservedDelta: 0,
      reservedAfter: 0,
      soldBefore: 0,
      soldDelta: 0,
      soldAfter: 0,
    });
  });

  it('does not add audit noise or query stock for a manual no-op', async () => {
    const { tx, db } = context();
    await recordStockMovement(tx, manual(0));
    expect(db.inventory.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(db.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('rejects non-integer and overflowing changes before reading or recording', async () => {
    for (const delta of [Number.NaN, 0.5, 2_147_483_648, -2_147_483_648]) {
      const { tx, db } = context();
      await expect(recordStockMovement(tx, manual(delta))).rejects.toThrow(
        'Movimentação de estoque inconsistente.',
      );
      expect(db.inventory.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(db.inventoryMovement.create).not.toHaveBeenCalled();
    }
  });

  it('rejects inferred negative or overflowing previous balances instead of inventing valid history', async () => {
    const negative = context(0, 0, 0);
    await expect(recordStockMovement(negative.tx, manual(1))).rejects.toThrow(
      'Movimentação de estoque inconsistente.',
    );
    expect(negative.db.inventoryMovement.create).not.toHaveBeenCalled();
    const overflow = context(2_147_483_647, 0, 0);
    await expect(recordStockMovement(overflow.tx, manual(-1))).rejects.toThrow(
      'Movimentação de estoque inconsistente.',
    );
    expect(overflow.db.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('rejects a corrupt current balance even if the previous balance would be valid', async () => {
    const { tx, db } = context(-1, 0, 0);
    await expect(recordStockMovement(tx, manual(-1))).rejects.toThrow(
      'Movimentação de estoque inconsistente.',
    );
    expect(db.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('propagates ledger failures so the caller cannot commit stock without its history', async () => {
    const { tx, db } = context();
    const failure = new Error('ledger unavailable');
    db.inventoryMovement.create.mockRejectedValueOnce(failure);
    await expect(recordStockMovement(tx, manual(-1))).rejects.toBe(failure);
    expect(db.inventoryMovement.create).toHaveBeenCalledTimes(1);
    expect(db.inventory.findUniqueOrThrow).toHaveBeenCalledTimes(1);
  });

  it('propagates a missing-stock read failure before any ledger write', async () => {
    const { tx, db } = context();
    const failure = new Error('stock unavailable');
    db.inventory.findUniqueOrThrow.mockRejectedValueOnce(failure);
    await expect(recordStockMovement(tx, manual(-1))).rejects.toBe(failure);
    expect(db.inventoryMovement.create).not.toHaveBeenCalled();
  });
});

BEGIN;

ALTER TYPE "InventoryMovementType" ADD VALUE 'STOCK_RECEIPT';
ALTER TABLE "inventory_movements" ADD COLUMN "operationKey" UUID;
CREATE UNIQUE INDEX "inventory_movements_productId_operationKey_key"
  ON "inventory_movements"("productId", "operationKey");

ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_type_check";
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_type_check" CHECK (
  ("type" = 'OPENING_BALANCE' AND "availableBefore" = 0 AND "reservedBefore" = 0 AND "soldBefore" = 0) OR
  ("type" = 'INITIAL_STOCK' AND "availableBefore" = 0 AND "reservedBefore" = 0 AND "soldBefore" = 0 AND "reservedAfter" = 0 AND "soldAfter" = 0) OR
  ("type" = 'MANUAL_ADJUSTMENT' AND "availableDelta" <> 0 AND "reservedDelta" = 0 AND "soldDelta" = 0) OR
  ("type" = 'ORDER_RESERVED' AND "availableDelta" < 0 AND "reservedDelta"::bigint = -"availableDelta"::bigint AND "soldDelta" = 0) OR
  ("type" IN ('ORDER_CANCELLED', 'ORDER_EXPIRED', 'PAYMENT_RELEASED') AND "availableDelta" > 0 AND "reservedDelta"::bigint = -"availableDelta"::bigint AND "soldDelta" = 0) OR
  ("type" = 'PAYMENT_CONFIRMED' AND "availableDelta" = 0 AND "reservedDelta" < 0 AND "soldDelta"::bigint = -"reservedDelta"::bigint) OR
  ("type"::text = 'STOCK_RECEIPT' AND "availableDelta" > 0 AND "reservedDelta" = 0 AND "soldDelta" = 0)
);

ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_order_check";
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_order_check" CHECK (
  ("type" IN ('ORDER_RESERVED', 'ORDER_CANCELLED', 'ORDER_EXPIRED', 'PAYMENT_CONFIRMED', 'PAYMENT_RELEASED') AND "orderNumber" IS NOT NULL AND "orderNumber" > 0) OR
  ("type"::text IN ('OPENING_BALANCE', 'INITIAL_STOCK', 'MANUAL_ADJUSTMENT', 'STOCK_RECEIPT') AND "orderId" IS NULL AND "orderNumber" IS NULL)
);

-- Text comparisons avoid using a new enum value before this transaction commits.
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_operation_check" CHECK (
  ("type"::text = 'STOCK_RECEIPT' AND "operationKey" IS NOT NULL AND "reason" IS NOT NULL AND char_length(btrim("reason")) BETWEEN 3 AND 500) OR
  ("type"::text <> 'STOCK_RECEIPT' AND "operationKey" IS NULL)
);

COMMIT;

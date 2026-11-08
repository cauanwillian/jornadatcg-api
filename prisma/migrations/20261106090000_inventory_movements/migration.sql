BEGIN;

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('OPENING_BALANCE', 'INITIAL_STOCK', 'MANUAL_ADJUSTMENT', 'ORDER_RESERVED', 'ORDER_CANCELLED', 'ORDER_EXPIRED', 'PAYMENT_CONFIRMED', 'PAYMENT_RELEASED');

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "productId" UUID NOT NULL,
    "orderId" UUID,
    "orderNumber" INTEGER,
    "actorId" UUID,
    "type" "InventoryMovementType" NOT NULL,
    "reason" VARCHAR(500),
    "cardName" TEXT NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "setName" TEXT NOT NULL,
    "categoryName" TEXT NOT NULL,
    "conditionName" TEXT NOT NULL,
    "languageName" TEXT NOT NULL,
    "availableBefore" INTEGER NOT NULL,
    "reservedBefore" INTEGER NOT NULL,
    "soldBefore" INTEGER NOT NULL,
    "availableDelta" INTEGER NOT NULL,
    "reservedDelta" INTEGER NOT NULL,
    "soldDelta" INTEGER NOT NULL,
    "availableAfter" INTEGER NOT NULL,
    "reservedAfter" INTEGER NOT NULL,
    "soldAfter" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_sequence_key" ON "inventory_movements"("sequence");

-- CreateIndex
CREATE INDEX "inventory_movements_productId_sequence_idx" ON "inventory_movements"("productId", "sequence");

-- CreateIndex
CREATE INDEX "inventory_movements_type_sequence_idx" ON "inventory_movements"("type", "sequence");

-- CreateIndex
CREATE INDEX "inventory_movements_createdAt_idx" ON "inventory_movements"("createdAt");
CREATE INDEX "inventory_movements_orderId_idx" ON "inventory_movements"("orderId");
CREATE INDEX "inventory_movements_actorId_idx" ON "inventory_movements"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_productId_orderId_type_key" ON "inventory_movements"("productId", "orderId", "type");

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Keep audit arithmetic valid even if data is inserted outside the application.
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_balances_check" CHECK (
  "availableBefore" >= 0 AND "reservedBefore" >= 0 AND "soldBefore" >= 0 AND
  "availableAfter" >= 0 AND "reservedAfter" >= 0 AND "soldAfter" >= 0 AND
  "availableBefore"::bigint + "availableDelta" = "availableAfter"::bigint AND
  "reservedBefore"::bigint + "reservedDelta" = "reservedAfter"::bigint AND
  "soldBefore"::bigint + "soldDelta" = "soldAfter"::bigint
);
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_type_check" CHECK (
  ("type" = 'OPENING_BALANCE' AND "availableBefore" = 0 AND "reservedBefore" = 0 AND "soldBefore" = 0) OR
  ("type" = 'INITIAL_STOCK' AND "availableBefore" = 0 AND "reservedBefore" = 0 AND "soldBefore" = 0 AND "reservedAfter" = 0 AND "soldAfter" = 0) OR
  ("type" = 'MANUAL_ADJUSTMENT' AND "availableDelta" <> 0 AND "reservedDelta" = 0 AND "soldDelta" = 0) OR
  ("type" = 'ORDER_RESERVED' AND "availableDelta" < 0 AND "reservedDelta"::bigint = -"availableDelta"::bigint AND "soldDelta" = 0) OR
  ("type" IN ('ORDER_CANCELLED', 'ORDER_EXPIRED', 'PAYMENT_RELEASED') AND "availableDelta" > 0 AND "reservedDelta"::bigint = -"availableDelta"::bigint AND "soldDelta" = 0) OR
  ("type" = 'PAYMENT_CONFIRMED' AND "availableDelta" = 0 AND "reservedDelta" < 0 AND "soldDelta"::bigint = -"reservedDelta"::bigint)
);
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_order_check" CHECK (
  ("type" IN ('ORDER_RESERVED', 'ORDER_CANCELLED', 'ORDER_EXPIRED', 'PAYMENT_CONFIRMED', 'PAYMENT_RELEASED') AND "orderNumber" IS NOT NULL AND "orderNumber" > 0) OR
  ("type" IN ('OPENING_BALANCE', 'INITIAL_STOCK', 'MANUAL_ADJUSTMENT') AND "orderId" IS NULL AND "orderNumber" IS NULL)
);
CREATE UNIQUE INDEX "inventory_movements_opening_product_key" ON "inventory_movements"("productId")
  WHERE "type" IN ('OPENING_BALANCE', 'INITIAL_STOCK');

-- Lock stock writes while capturing the deployment baseline. Never reconstruct past events.
-- Prisma migrations must run with the API/workers stopped during deployment.
LOCK TABLE "inventories" IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO "inventory_movements" (
  "id", "productId", "type", "cardName", "cardNumber", "setName", "categoryName", "conditionName", "languageName",
  "availableBefore", "reservedBefore", "soldBefore", "availableDelta", "reservedDelta", "soldDelta",
  "availableAfter", "reservedAfter", "soldAfter"
)
SELECT gen_random_uuid(), i."productId", 'OPENING_BALANCE', c."name", c."number", s."name", cat."name", cond."name", lang."name",
  0, 0, 0, i."availableQuantity", i."reservedQuantity", i."soldQuantity", i."availableQuantity", i."reservedQuantity", i."soldQuantity"
FROM "inventories" i
JOIN "products" p ON p."id" = i."productId"
JOIN "cards" c ON c."id" = p."cardId"
JOIN "card_sets" s ON s."id" = c."setId"
JOIN "categories" cat ON cat."id" = p."categoryId"
JOIN "conditions" cond ON cond."id" = p."conditionId"
JOIN "languages" lang ON lang."id" = p."languageId"
ORDER BY i."productId";

-- Private to the backend database role; no public Data API policies are created.
ALTER TABLE "inventory_movements" ENABLE ROW LEVEL SECURITY;

COMMIT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "checkoutKey" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "orders_userId_checkoutKey_key" ON "orders"("userId", "checkoutKey");

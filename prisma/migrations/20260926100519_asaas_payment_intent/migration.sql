-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "providerCustomerId" TEXT,
ADD COLUMN     "providerRequestStartedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "payments_orderId_provider_key" ON "payments"("orderId", "provider");

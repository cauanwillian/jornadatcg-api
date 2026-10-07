-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "shipmentId" UUID,
ALTER COLUMN "orderId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "selectedQuoteId" UUID,
ADD COLUMN     "shippingPaidAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "shipping_quotes" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "deliveryDays" INTEGER NOT NULL,
    "packageSnapshot" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipping_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipping_quotes_shipmentId_expiresAt_idx" ON "shipping_quotes"("shipmentId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_shipmentId_provider_key" ON "payments"("shipmentId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_selectedQuoteId_key" ON "shipments"("selectedQuoteId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_selectedQuoteId_fkey" FOREIGN KEY ("selectedQuoteId") REFERENCES "shipping_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_quotes" ADD CONSTRAINT "shipping_quotes_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every charge belongs to exactly one purchase or shipment.
ALTER TABLE "payments" ADD CONSTRAINT "payments_subject_check"
CHECK (("orderId" IS NOT NULL) <> ("shipmentId" IS NOT NULL));
ALTER TABLE "shipping_quotes" ADD CONSTRAINT "shipping_quotes_values_check"
CHECK ("amount" > 0 AND "deliveryDays" >= 0);
-- Access is through the authenticated backend, not the public Supabase Data API.
ALTER TABLE "shipping_quotes" ENABLE ROW LEVEL SECURITY;

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "packedAt" TIMESTAMP(3),
ADD COLUMN     "packedById" UUID;

-- CreateTable
CREATE TABLE "shipment_labels" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "requestedById" UUID NOT NULL,
    "requestSnapshot" JSONB NOT NULL,
    "remoteId" UUID,
    "status" TEXT NOT NULL DEFAULT 'INTENT',
    "cost" DECIMAL(12,2),
    "createStartedAt" TIMESTAMP(3),
    "checkoutStartedAt" TIMESTAMP(3),
    "generateStartedAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipment_labels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipment_labels_shipmentId_key" ON "shipment_labels"("shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_labels_remoteId_key" ON "shipment_labels"("remoteId");

-- AddForeignKey
ALTER TABLE "shipment_labels" ADD CONSTRAINT "shipment_labels_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_labels" ENABLE ROW LEVEL SECURITY;

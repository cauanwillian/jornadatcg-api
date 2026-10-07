-- AlterTable
ALTER TABLE "products" ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "featuredOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "products_featured_featuredOrder_idx" ON "products"("featured", "featuredOrder");

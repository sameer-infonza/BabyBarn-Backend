-- AlterTable
ALTER TABLE "InventoryAdjustment" ADD COLUMN "productVariantId" INTEGER;

-- CreateIndex
CREATE INDEX "InventoryAdjustment_productVariantId_idx" ON "InventoryAdjustment"("productVariantId");

-- AddForeignKey
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

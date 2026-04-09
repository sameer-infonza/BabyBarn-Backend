-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('NEW', 'REFURBISHED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "productType" "ProductType" NOT NULL DEFAULT 'NEW';

-- CreateTable
CREATE TABLE "InventoryAdjustment" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "quantityChange" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryAdjustment_publicId_key" ON "InventoryAdjustment"("publicId");

CREATE INDEX "InventoryAdjustment_productId_idx" ON "InventoryAdjustment"("productId");

CREATE INDEX "InventoryAdjustment_userId_idx" ON "InventoryAdjustment"("userId");

CREATE INDEX "InventoryAdjustment_createdAt_idx" ON "InventoryAdjustment"("createdAt");

CREATE INDEX "Product_productType_idx" ON "Product"("productType");

ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

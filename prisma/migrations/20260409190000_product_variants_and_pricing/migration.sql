-- AlterTable
ALTER TABLE "Product" ADD COLUMN "memberPrice" DOUBLE PRECISION,
ADD COLUMN "compareAtPrice" DOUBLE PRECISION,
ADD COLUMN "unitPriceAmount" DOUBLE PRECISION,
ADD COLUMN "unitPriceReference" TEXT,
ADD COLUMN "fabric" TEXT,
ADD COLUMN "care" TEXT,
ADD COLUMN "sizeAgeGroup" TEXT,
ADD COLUMN "vendor" TEXT,
ADD COLUMN "tags" TEXT,
ADD COLUMN "isDraft" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "isActiveListing" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "inventoryModel" TEXT NOT NULL DEFAULT 'simple',
ADD COLUMN "gallery" JSONB;

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "combination" JSONB NOT NULL,
    "sku" TEXT NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "priceOverride" DOUBLE PRECISION,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductVariant_publicId_key" ON "ProductVariant"("publicId");

CREATE UNIQUE INDEX "ProductVariant_productId_sku_key" ON "ProductVariant"("productId", "sku");

CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Product_isDraft_idx" ON "Product"("isDraft");

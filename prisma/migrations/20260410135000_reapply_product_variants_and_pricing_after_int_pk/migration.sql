-- Re-apply pricing columns and ProductVariant after int PK migration reset.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "memberPrice" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "compareAtPrice" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "unitPriceAmount" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "unitPriceReference" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "fabric" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "care" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sizeAgeGroup" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "vendor" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "tags" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isDraft" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isActiveListing" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "inventoryModel" TEXT NOT NULL DEFAULT 'simple';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "gallery" JSONB;

CREATE TABLE IF NOT EXISTS "ProductVariant" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "ProductVariant_publicId_key" ON "ProductVariant"("publicId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductVariant_productId_sku_key" ON "ProductVariant"("productId", "sku");
CREATE INDEX IF NOT EXISTS "ProductVariant_productId_idx" ON "ProductVariant"("productId");
CREATE INDEX IF NOT EXISTS "Product_isDraft_idx" ON "Product"("isDraft");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductVariant_productId_fkey'
  ) THEN
    ALTER TABLE "ProductVariant"
      ADD CONSTRAINT "ProductVariant_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "warehouseLocation" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "warehouseLocation" TEXT;

CREATE TABLE IF NOT EXISTS "ProductBarcodeAlias" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "productBarcodeId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductBarcodeAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductBarcodeAlias_publicId_key" ON "ProductBarcodeAlias"("publicId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductBarcodeAlias_code_key" ON "ProductBarcodeAlias"("code");
CREATE INDEX IF NOT EXISTS "ProductBarcodeAlias_productBarcodeId_idx" ON "ProductBarcodeAlias"("productBarcodeId");

ALTER TABLE "ProductBarcodeAlias" DROP CONSTRAINT IF EXISTS "ProductBarcodeAlias_productBarcodeId_fkey";
ALTER TABLE "ProductBarcodeAlias" ADD CONSTRAINT "ProductBarcodeAlias_productBarcodeId_fkey" FOREIGN KEY ("productBarcodeId") REFERENCES "ProductBarcode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Permanent catalog barcode identity (not SKU).
CREATE TABLE "ProductBarcode" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "productVariantId" INTEGER,
    "sentToVendorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductBarcode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductBarcode_publicId_key" ON "ProductBarcode"("publicId");
CREATE UNIQUE INDEX "ProductBarcode_code_key" ON "ProductBarcode"("code");
CREATE UNIQUE INDEX "ProductBarcode_targetKey_key" ON "ProductBarcode"("targetKey");
CREATE INDEX "ProductBarcode_productId_idx" ON "ProductBarcode"("productId");
CREATE INDEX "ProductBarcode_productVariantId_idx" ON "ProductBarcode"("productVariantId");

ALTER TABLE "ProductBarcode" ADD CONSTRAINT "ProductBarcode_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductBarcode" ADD CONSTRAINT "ProductBarcode_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

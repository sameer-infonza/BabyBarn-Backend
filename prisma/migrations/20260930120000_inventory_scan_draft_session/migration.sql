-- Draft inventory scan sessions (stock-in identify → confirm)
CREATE TYPE "InventoryScanSessionStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'DISCARDED');
CREATE TYPE "InventoryScanLineAction" AS ENUM ('NO_CHANGE', 'ADD', 'REMOVE', 'SET');

CREATE TABLE "InventoryScanSession" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "status" "InventoryScanSessionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" INTEGER NOT NULL,
    "sessionNote" TEXT,
    "location" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "discardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryScanSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryScanSessionLine" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "targetKey" TEXT NOT NULL,
    "barcodeCode" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "productVariantId" INTEGER,
    "scannedCount" INTEGER NOT NULL DEFAULT 0,
    "action" "InventoryScanLineAction" NOT NULL DEFAULT 'NO_CHANGE',
    "pendingQty" INTEGER NOT NULL DEFAULT 0,
    "expectedOnHand" INTEGER NOT NULL,
    "expectedAvailable" INTEGER NOT NULL,
    "expectedStockVersion" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryScanSessionLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryScanSession_publicId_key" ON "InventoryScanSession"("publicId");
CREATE INDEX "InventoryScanSession_createdById_status_idx" ON "InventoryScanSession"("createdById", "status");
CREATE INDEX "InventoryScanSession_status_updatedAt_idx" ON "InventoryScanSession"("status", "updatedAt");

CREATE UNIQUE INDEX "InventoryScanSessionLine_publicId_key" ON "InventoryScanSessionLine"("publicId");
CREATE UNIQUE INDEX "InventoryScanSessionLine_sessionId_targetKey_key" ON "InventoryScanSessionLine"("sessionId", "targetKey");
CREATE INDEX "InventoryScanSessionLine_sessionId_idx" ON "InventoryScanSessionLine"("sessionId");
CREATE INDEX "InventoryScanSessionLine_productId_idx" ON "InventoryScanSessionLine"("productId");
CREATE INDEX "InventoryScanSessionLine_productVariantId_idx" ON "InventoryScanSessionLine"("productVariantId");

ALTER TABLE "InventoryScanSession" ADD CONSTRAINT "InventoryScanSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryScanSessionLine" ADD CONSTRAINT "InventoryScanSessionLine_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "InventoryScanSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryScanSessionLine" ADD CONSTRAINT "InventoryScanSessionLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryScanSessionLine" ADD CONSTRAINT "InventoryScanSessionLine_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

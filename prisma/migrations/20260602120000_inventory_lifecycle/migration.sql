-- Inventory ledger, unit lifecycle, refurbishment jobs, wishlist, stock alerts

CREATE TYPE "InventoryLedgerEventType" AS ENUM ('RESERVE', 'RELEASE', 'COMMIT', 'ADJUST', 'RESTOCK', 'REFUND_RESTORE');
CREATE TYPE "ProductUnitStatus" AS ENUM ('IN_STOCK', 'RESERVED', 'SOLD', 'WITH_CUSTOMER', 'RETURNED', 'INSPECTION', 'REFURBISHING', 'QA_HOLD', 'AVAILABLE_REFURB', 'RETIRED');
CREATE TYPE "RefurbishmentJobStatus" AS ENUM ('RECEIVED', 'INSPECTION', 'IN_PROGRESS', 'QA_APPROVED', 'LISTED', 'CANCELLED');

ALTER TABLE "Product" ADD COLUMN "sourceReturnId" INTEGER;

CREATE TABLE "InventoryLedgerEvent" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "productVariantId" INTEGER,
    "quantityDelta" INTEGER NOT NULL,
    "eventType" "InventoryLedgerEventType" NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "actorUserId" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryLedgerEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductUnit" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "unitSku" TEXT NOT NULL,
    "productId" INTEGER,
    "productVariantId" INTEGER,
    "status" "ProductUnitStatus" NOT NULL DEFAULT 'IN_STOCK',
    "cycleNumber" INTEGER NOT NULL DEFAULT 1,
    "sourceOrderItemId" INTEGER,
    "sourceReturnId" INTEGER,
    "purchasedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "inspectedAt" TIMESTAMP(3),
    "refurbishedAt" TIMESTAMP(3),
    "relistedAt" TIMESTAMP(3),
    "soldAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductUnit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductUnitEvent" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "unitId" INTEGER NOT NULL,
    "fromStatus" "ProductUnitStatus",
    "toStatus" "ProductUnitStatus" NOT NULL,
    "actorUserId" INTEGER,
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductUnitEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RefurbishmentJob" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "returnRequestId" INTEGER NOT NULL,
    "status" "RefurbishmentJobStatus" NOT NULL DEFAULT 'RECEIVED',
    "listedProductId" INTEGER,
    "notes" TEXT,
    "inspectedAt" TIMESTAMP(3),
    "refurbishedAt" TIMESTAMP(3),
    "listedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RefurbishmentJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WishlistItem" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "productVariantId" INTEGER,
    "priceAtAdd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockAlertSubscription" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "productVariantId" INTEGER,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockAlertSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryLedgerEvent_publicId_key" ON "InventoryLedgerEvent"("publicId");
CREATE INDEX "InventoryLedgerEvent_productId_createdAt_idx" ON "InventoryLedgerEvent"("productId", "createdAt");
CREATE INDEX "InventoryLedgerEvent_productVariantId_idx" ON "InventoryLedgerEvent"("productVariantId");
CREATE INDEX "InventoryLedgerEvent_referenceType_referenceId_idx" ON "InventoryLedgerEvent"("referenceType", "referenceId");
CREATE INDEX "InventoryLedgerEvent_eventType_idx" ON "InventoryLedgerEvent"("eventType");
CREATE INDEX "InventoryLedgerEvent_createdAt_idx" ON "InventoryLedgerEvent"("createdAt");

CREATE UNIQUE INDEX "ProductUnit_publicId_key" ON "ProductUnit"("publicId");
CREATE UNIQUE INDEX "ProductUnit_unitSku_key" ON "ProductUnit"("unitSku");
CREATE INDEX "ProductUnit_productId_idx" ON "ProductUnit"("productId");
CREATE INDEX "ProductUnit_status_idx" ON "ProductUnit"("status");
CREATE INDEX "ProductUnit_sourceReturnId_idx" ON "ProductUnit"("sourceReturnId");

CREATE UNIQUE INDEX "ProductUnitEvent_publicId_key" ON "ProductUnitEvent"("publicId");
CREATE INDEX "ProductUnitEvent_unitId_createdAt_idx" ON "ProductUnitEvent"("unitId", "createdAt");

CREATE UNIQUE INDEX "RefurbishmentJob_publicId_key" ON "RefurbishmentJob"("publicId");
CREATE UNIQUE INDEX "RefurbishmentJob_returnRequestId_key" ON "RefurbishmentJob"("returnRequestId");
CREATE INDEX "RefurbishmentJob_status_idx" ON "RefurbishmentJob"("status");

CREATE UNIQUE INDEX "WishlistItem_userId_productId_productVariantId_key" ON "WishlistItem"("userId", "productId", "productVariantId");
CREATE INDEX "WishlistItem_userId_idx" ON "WishlistItem"("userId");
CREATE INDEX "WishlistItem_productId_idx" ON "WishlistItem"("productId");

CREATE UNIQUE INDEX "StockAlertSubscription_userId_productId_productVariantId_key" ON "StockAlertSubscription"("userId", "productId", "productVariantId");
CREATE INDEX "StockAlertSubscription_productId_idx" ON "StockAlertSubscription"("productId");
CREATE INDEX "StockAlertSubscription_userId_idx" ON "StockAlertSubscription"("userId");

CREATE INDEX "Product_sourceReturnId_idx" ON "Product"("sourceReturnId");

ALTER TABLE "InventoryLedgerEvent" ADD CONSTRAINT "InventoryLedgerEvent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryLedgerEvent" ADD CONSTRAINT "InventoryLedgerEvent_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductUnit" ADD CONSTRAINT "ProductUnit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductUnit" ADD CONSTRAINT "ProductUnit_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductUnit" ADD CONSTRAINT "ProductUnit_sourceReturnId_fkey" FOREIGN KEY ("sourceReturnId") REFERENCES "ReturnRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductUnitEvent" ADD CONSTRAINT "ProductUnitEvent_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "ProductUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RefurbishmentJob" ADD CONSTRAINT "RefurbishmentJob_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefurbishmentJob" ADD CONSTRAINT "RefurbishmentJob_listedProductId_fkey" FOREIGN KEY ("listedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockAlertSubscription" ADD CONSTRAINT "StockAlertSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockAlertSubscription" ADD CONSTRAINT "StockAlertSubscription_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockAlertSubscription" ADD CONSTRAINT "StockAlertSubscription_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Product" ADD CONSTRAINT "Product_sourceReturnId_fkey" FOREIGN KEY ("sourceReturnId") REFERENCES "ReturnRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Fulfillment pipeline + UPS-only defaults + operational shipping settings

CREATE TYPE "OrderFulfillmentStatus" AS ENUM (
  'NEW_ORDER',
  'ACCEPTED',
  'PICKUP_READY',
  'LABEL_GENERATED',
  'SHIPPED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED'
);

ALTER TABLE "Order" ADD COLUMN "fulfillmentStatus" "OrderFulfillmentStatus",
ADD COLUMN "packageDetailsJson" JSONB,
ADD COLUMN "manualShippingNotes" TEXT,
ADD COLUMN "deliveredAt" TIMESTAMP(3),
ADD COLUMN "fulfillmentAcceptedAt" TIMESTAMP(3),
ADD COLUMN "pickupReadyAt" TIMESTAMP(3),
ADD COLUMN "labelGeneratedAt" TIMESTAMP(3),
ADD COLUMN "outboundShippedAt" TIMESTAMP(3);

CREATE INDEX "Order_fulfillmentStatus_idx" ON "Order"("fulfillmentStatus");

UPDATE "Order" SET "fulfillmentStatus" = 'DELIVERED' WHERE "status" = 'DELIVERED';
UPDATE "Order" SET "fulfillmentStatus" = 'SHIPPED' WHERE "status" = 'SHIPPED' AND "fulfillmentStatus" IS NULL;
UPDATE "Order" SET "fulfillmentStatus" = 'NEW_ORDER'
WHERE "paymentStatus" = 'PAID' AND "fulfillmentStatus" IS NULL
  AND "status" IN ('PENDING', 'PROCESSING', 'CONFIRMED');

CREATE TABLE "ShipmentTrackingEvent" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ups',
    "statusCode" TEXT,
    "description" TEXT,
    "location" TEXT,
    "raw" JSONB,
    "eventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentTrackingEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShipmentTrackingEvent_publicId_key" ON "ShipmentTrackingEvent"("publicId");
CREATE INDEX "ShipmentTrackingEvent_orderId_createdAt_idx" ON "ShipmentTrackingEvent"("orderId", "createdAt");

ALTER TABLE "ShipmentTrackingEvent" ADD CONSTRAINT "ShipmentTrackingEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PickupList" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PickupList_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PickupList_publicId_key" ON "PickupList"("publicId");

CREATE TABLE "PickupListLine" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "pickupListId" INTEGER NOT NULL,
    "orderId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PickupListLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PickupListLine_publicId_key" ON "PickupListLine"("publicId");
CREATE UNIQUE INDEX "PickupListLine_pickupListId_orderId_key" ON "PickupListLine"("pickupListId", "orderId");
CREATE INDEX "PickupListLine_orderId_idx" ON "PickupListLine"("orderId");

ALTER TABLE "PickupListLine" ADD CONSTRAINT "PickupListLine_pickupListId_fkey" FOREIGN KEY ("pickupListId") REFERENCES "PickupList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PickupListLine" ADD CONSTRAINT "PickupListLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ShippingSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "pickupAddressJson" JSONB,
    "defaultPackageJson" JSONB,
    "autoLabelGeneration" BOOLEAN NOT NULL DEFAULT false,
    "manualShippingAllowed" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ShippingSettings" ("id", "pickupAddressJson", "defaultPackageJson", "autoLabelGeneration", "manualShippingAllowed", "updatedAt")
VALUES (1, NULL, NULL, false, true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

UPDATE "ShippingProvider" SET "enabled" = false, "isDefault" = false WHERE "slug" = 'shippo';
UPDATE "ShippingProvider" SET "enabled" = true, "isDefault" = true WHERE "slug" = 'ups';

-- CreateEnum
CREATE TYPE "ShippingProviderLogLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "ShippingProvider" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "credentialsEncrypted" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingServiceMethod" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "providerId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "visibleAtCheckout" BOOLEAN NOT NULL DEFAULT true,
    "visibleInAdmin" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "rules" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingServiceMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingProviderLog" (
    "id" SERIAL NOT NULL,
    "providerSlug" TEXT NOT NULL,
    "level" "ShippingProviderLogLevel" NOT NULL DEFAULT 'INFO',
    "action" TEXT NOT NULL,
    "orderPublicId" TEXT,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShippingProviderLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShippingProvider_publicId_key" ON "ShippingProvider"("publicId");
CREATE UNIQUE INDEX "ShippingProvider_slug_key" ON "ShippingProvider"("slug");
CREATE INDEX "ShippingProvider_enabled_idx" ON "ShippingProvider"("enabled");
CREATE INDEX "ShippingProvider_sortOrder_idx" ON "ShippingProvider"("sortOrder");

CREATE UNIQUE INDEX "ShippingServiceMethod_publicId_key" ON "ShippingServiceMethod"("publicId");
CREATE UNIQUE INDEX "ShippingServiceMethod_providerId_code_key" ON "ShippingServiceMethod"("providerId", "code");
CREATE INDEX "ShippingServiceMethod_providerId_idx" ON "ShippingServiceMethod"("providerId");

CREATE INDEX "ShippingProviderLog_providerSlug_createdAt_idx" ON "ShippingProviderLog"("providerSlug", "createdAt");
CREATE INDEX "ShippingProviderLog_createdAt_idx" ON "ShippingProviderLog"("createdAt");

ALTER TABLE "ShippingServiceMethod" ADD CONSTRAINT "ShippingServiceMethod_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ShippingProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed defaults: Shippo default + UPS disabled + common UPS US domestic codes
INSERT INTO "ShippingProvider" ("publicId", "slug", "displayName", "enabled", "isDefault", "sortOrder", "credentialsEncrypted", "metadata", "createdAt", "updatedAt")
VALUES
  ('shipprov_shippo_seed', 'shippo', 'Shippo', true, true, 0, NULL, '{}'::jsonb, NOW(), NOW()),
  ('shipprov_ups_seed', 'ups', 'UPS', false, false, 10, NULL, '{"region":"US_DOMESTIC"}'::jsonb, NOW(), NOW());

INSERT INTO "ShippingServiceMethod" ("publicId", "providerId", "code", "displayName", "enabled", "visibleAtCheckout", "visibleInAdmin", "sortOrder", "rules", "createdAt", "updatedAt")
SELECT 'shipsvc_shippo_all', p."id", '*', 'Shippo carriers', true, true, true, 0, NULL, NOW(), NOW()
FROM "ShippingProvider" p WHERE p."slug" = 'shippo';

INSERT INTO "ShippingServiceMethod" ("publicId", "providerId", "code", "displayName", "enabled", "visibleAtCheckout", "visibleInAdmin", "sortOrder", "rules", "createdAt", "updatedAt")
SELECT 'shipsvc_ups_' || svc.code, p."id", svc.code, svc.name, true, true, true, svc.ord, '{"domesticOnly":true}'::jsonb, NOW(), NOW()
FROM "ShippingProvider" p
CROSS JOIN (VALUES
  ('03', 'UPS Ground', 10),
  ('12', 'UPS 3 Day Select', 20),
  ('02', 'UPS 2nd Day Air', 30),
  ('01', 'UPS Next Day Air', 40),
  ('13', 'UPS Next Day Air Saver', 50),
  ('14', 'UPS Next Day Air Early', 60)
) AS svc(code, name, ord)
WHERE p."slug" = 'ups';

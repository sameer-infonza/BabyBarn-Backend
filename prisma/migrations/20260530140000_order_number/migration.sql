-- Human-readable order reference for customer/admin UI (BB-000001)

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "orderNumber" TEXT;

UPDATE "Order"
SET "orderNumber" = 'BB-' || LPAD(CAST(id AS TEXT), 6, '0')
WHERE "orderNumber" IS NULL;

ALTER TABLE "Order" ALTER COLUMN "orderNumber" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Order_orderNumber_key" ON "Order"("orderNumber");
CREATE INDEX IF NOT EXISTS "Order_orderNumber_idx" ON "Order"("orderNumber");

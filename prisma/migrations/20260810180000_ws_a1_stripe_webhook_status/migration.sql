-- WS-A1: webhook events are PROCESSED only after handler success.
ALTER TABLE "StripeWebhookEvent" ADD COLUMN IF NOT EXISTS "status" TEXT;
UPDATE "StripeWebhookEvent"
SET "status" = 'PROCESSED'
WHERE "status" IS NULL OR "status" = '';
ALTER TABLE "StripeWebhookEvent" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "StripeWebhookEvent" ALTER COLUMN "status" SET NOT NULL;

-- Allow null processedAt for in-flight / failed events.
ALTER TABLE "StripeWebhookEvent" ALTER COLUMN "processedAt" DROP DEFAULT;
ALTER TABLE "StripeWebhookEvent" ALTER COLUMN "processedAt" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "StripeWebhookEvent_status_idx" ON "StripeWebhookEvent"("status");

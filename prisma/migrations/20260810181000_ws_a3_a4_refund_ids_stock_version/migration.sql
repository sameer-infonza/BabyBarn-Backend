-- WS-A3: track applied Stripe refund IDs for local side-effect idempotency
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "appliedStripeRefundIds" JSONB;

-- WS-A4: simple SKU optimistic concurrency
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "stockVersion" INTEGER NOT NULL DEFAULT 0;

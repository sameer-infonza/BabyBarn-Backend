-- Per-variant ACCESS member price override (falls back to Product.memberPrice when null)
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "memberPriceOverride" DOUBLE PRECISION;

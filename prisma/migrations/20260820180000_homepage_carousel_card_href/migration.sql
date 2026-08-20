-- Optional per-card link override for PRODUCT_GRID slides
ALTER TABLE "HomepageCarouselProductCard" ADD COLUMN IF NOT EXISTS "customHref" TEXT;

-- Short description for refurbished PDP (shown near variant filters).
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "shortDescription" TEXT;

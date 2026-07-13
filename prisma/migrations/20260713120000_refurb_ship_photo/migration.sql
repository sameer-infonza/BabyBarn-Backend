-- Refurb return: optional customer-uploaded shipping photo
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "customerShippingPhotoUrl" TEXT;

-- Add Fabric & Fit detail fields (feel, fit) separate from fabric and care.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "feel" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "fit" TEXT;

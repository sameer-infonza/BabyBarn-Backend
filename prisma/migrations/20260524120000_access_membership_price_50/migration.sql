-- Flat ACCESS membership price: $50/year
ALTER TABLE "BusinessSettings" ALTER COLUMN "accessMembershipPriceUsd" SET DEFAULT 50;
UPDATE "BusinessSettings" SET "accessMembershipPriceUsd" = 50 WHERE "id" = 1;

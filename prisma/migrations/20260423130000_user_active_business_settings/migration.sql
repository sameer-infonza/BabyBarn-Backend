-- User account enable/disable (admin)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS "User_isActive_idx" ON "User"("isActive");

-- Editable ACCESS membership list price (singleton id = 1)
CREATE TABLE IF NOT EXISTS "BusinessSettings" (
    "id" INTEGER NOT NULL,
    "accessMembershipPriceUsd" DOUBLE PRECISION NOT NULL DEFAULT 49,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "BusinessSettings" ("id", "accessMembershipPriceUsd", "updatedAt")
VALUES (1, 49, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

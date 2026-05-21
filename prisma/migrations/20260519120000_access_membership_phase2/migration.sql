-- Phase 2: ACCESS registration fields, payment ledger, renewal reminders

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "accessNumber" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "babyName" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "membershipShippingAddressJson" JSONB;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "accessRenewalReminderSentAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "User_accessNumber_key" ON "User"("accessNumber");
CREATE INDEX IF NOT EXISTS "User_accessNumber_idx" ON "User"("accessNumber");

DO $$ BEGIN
  CREATE TYPE "MembershipPaymentType" AS ENUM ('PURCHASE', 'RENEWAL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "MembershipPayment" (
  "id" SERIAL NOT NULL,
  "publicId" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "type" "MembershipPaymentType" NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "stripeSessionId" TEXT,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "accessValidUntil" TIMESTAMP(3),
  CONSTRAINT "MembershipPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MembershipPayment_publicId_key" ON "MembershipPayment"("publicId");
CREATE INDEX IF NOT EXISTS "MembershipPayment_userId_idx" ON "MembershipPayment"("userId");
CREATE INDEX IF NOT EXISTS "MembershipPayment_paidAt_idx" ON "MembershipPayment"("paidAt");
CREATE INDEX IF NOT EXISTS "MembershipPayment_stripeSessionId_idx" ON "MembershipPayment"("stripeSessionId");

DO $$ BEGIN
  ALTER TABLE "MembershipPayment" ADD CONSTRAINT "MembershipPayment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

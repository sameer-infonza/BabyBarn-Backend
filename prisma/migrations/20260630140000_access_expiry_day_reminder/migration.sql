-- Expiry-day ACCESS reminder (separate from pre-expiry reminder).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "accessExpiryDayReminderSentAt" TIMESTAMP(3);

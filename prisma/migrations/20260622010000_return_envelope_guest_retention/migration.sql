-- AlterTable
ALTER TABLE "Order" ADD COLUMN "returnEnvelopeUsed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "guestPurgedAt" TIMESTAMP(3);

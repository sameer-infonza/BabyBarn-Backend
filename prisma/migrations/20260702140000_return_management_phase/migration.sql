-- Return management: refunds, audit events, package requests, manual tracking, configurable window

ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "photoUrlsJson" JSONB;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "refundAmount" DOUBLE PRECISION;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "stripeRefundId" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "refundedAt" TIMESTAMP(3);
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "manualCarrier" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "manualTrackingNumber" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "manualShippedAt" TIMESTAMP(3);
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "inspectionChecklistJson" JSONB;

ALTER TABLE "BusinessSettings" ADD COLUMN IF NOT EXISTS "accessUsedReturnWindowDays" INTEGER NOT NULL DEFAULT 365;

CREATE TYPE "ReturnPackageRequestStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'SENT');

CREATE TABLE IF NOT EXISTS "ReturnStatusEvent" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "returnRequestId" INTEGER NOT NULL,
    "fromStatus" "ReturnStatus",
    "toStatus" "ReturnStatus" NOT NULL,
    "actorUserId" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReturnStatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ReturnPackageRequest" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "orderId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "comments" TEXT,
    "status" "ReturnPackageRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "dispatchDate" TIMESTAMP(3),
    "uspsTrackingNumber" TEXT,
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReturnPackageRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReturnStatusEvent_publicId_key" ON "ReturnStatusEvent"("publicId");
CREATE INDEX IF NOT EXISTS "ReturnStatusEvent_returnRequestId_createdAt_idx" ON "ReturnStatusEvent"("returnRequestId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "ReturnPackageRequest_publicId_key" ON "ReturnPackageRequest"("publicId");
CREATE INDEX IF NOT EXISTS "ReturnPackageRequest_userId_idx" ON "ReturnPackageRequest"("userId");
CREATE INDEX IF NOT EXISTS "ReturnPackageRequest_orderId_idx" ON "ReturnPackageRequest"("orderId");
CREATE INDEX IF NOT EXISTS "ReturnPackageRequest_status_idx" ON "ReturnPackageRequest"("status");

ALTER TABLE "ReturnStatusEvent" DROP CONSTRAINT IF EXISTS "ReturnStatusEvent_returnRequestId_fkey";
ALTER TABLE "ReturnStatusEvent" ADD CONSTRAINT "ReturnStatusEvent_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReturnPackageRequest" DROP CONSTRAINT IF EXISTS "ReturnPackageRequest_userId_fkey";
ALTER TABLE "ReturnPackageRequest" ADD CONSTRAINT "ReturnPackageRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReturnPackageRequest" DROP CONSTRAINT IF EXISTS "ReturnPackageRequest_orderId_fkey";
ALTER TABLE "ReturnPackageRequest" ADD CONSTRAINT "ReturnPackageRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

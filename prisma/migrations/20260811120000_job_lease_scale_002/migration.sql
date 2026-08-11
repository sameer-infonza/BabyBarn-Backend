-- SCALE-002: distributed job leases for multi-instance-safe schedulers.
CREATE TABLE IF NOT EXISTS "JobLease" (
    "jobKey" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "lastStartedAt" TIMESTAMP(3),
    "lastFinishedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobLease_pkey" PRIMARY KEY ("jobKey")
);

CREATE INDEX IF NOT EXISTS "JobLease_leaseExpiresAt_idx" ON "JobLease"("leaseExpiresAt");

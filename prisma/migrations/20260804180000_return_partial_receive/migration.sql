-- Partial package receiving for standard returns
ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "receivedQuantity" INTEGER NOT NULL DEFAULT 0;

-- Backfill: already RECEIVED (or past) lines count as fully received
UPDATE "ReturnRequest"
SET "receivedQuantity" = "quantity"
WHERE "receivedQuantity" = 0
  AND "status" IN (
    'RECEIVED',
    'UNDER_INSPECTION',
    'APPROVED',
    'REJECTED',
    'INSPECTION_APPROVED',
    'INSPECTION_REJECTED'
  );

CREATE TABLE IF NOT EXISTS "ReturnReceivePackage" (
  "id" SERIAL PRIMARY KEY,
  "publicId" TEXT NOT NULL,
  "submissionPublicId" TEXT NOT NULL,
  "packageNumber" INTEGER NOT NULL,
  "receivedByUserId" INTEGER,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReturnReceivePackage_publicId_key" UNIQUE ("publicId"),
  CONSTRAINT "ReturnReceivePackage_submission_package_key" UNIQUE ("submissionPublicId", "packageNumber"),
  CONSTRAINT "ReturnReceivePackage_receivedByUserId_fkey"
    FOREIGN KEY ("receivedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ReturnReceivePackage_submissionPublicId_idx"
  ON "ReturnReceivePackage"("submissionPublicId");

CREATE TABLE IF NOT EXISTS "ReturnReceivePackageLine" (
  "id" SERIAL PRIMARY KEY,
  "publicId" TEXT NOT NULL,
  "packageId" INTEGER NOT NULL,
  "returnRequestId" INTEGER NOT NULL,
  "quantityReceived" INTEGER NOT NULL,
  CONSTRAINT "ReturnReceivePackageLine_publicId_key" UNIQUE ("publicId"),
  CONSTRAINT "ReturnReceivePackageLine_packageId_fkey"
    FOREIGN KEY ("packageId") REFERENCES "ReturnReceivePackage"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReturnReceivePackageLine_returnRequestId_fkey"
    FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ReturnReceivePackageLine_packageId_idx"
  ON "ReturnReceivePackageLine"("packageId");
CREATE INDEX IF NOT EXISTS "ReturnReceivePackageLine_returnRequestId_idx"
  ON "ReturnReceivePackageLine"("returnRequestId");

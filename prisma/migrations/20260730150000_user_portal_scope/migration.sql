-- Portal-scoped dual accounts: same email may exist as CUSTOMER and STAFF.

CREATE TYPE "PortalScope" AS ENUM ('CUSTOMER', 'STAFF');

ALTER TABLE "User" ADD COLUMN "portalScope" "PortalScope";

-- Backfill from role: console roles → STAFF; everyone else → CUSTOMER
UPDATE "User" u
SET "portalScope" = CASE
  WHEN r."name" IN ('ADMIN', 'ADMIN_TEAM', 'VENDOR', 'SUPPORT', 'MANAGER') THEN 'STAFF'::"PortalScope"
  ELSE 'CUSTOMER'::"PortalScope"
END
FROM "Role" r
WHERE r.id = u."roleId";

UPDATE "User" SET "portalScope" = 'CUSTOMER'::"PortalScope" WHERE "portalScope" IS NULL;

ALTER TABLE "User" ALTER COLUMN "portalScope" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "portalScope" SET DEFAULT 'CUSTOMER'::"PortalScope";

DROP INDEX IF EXISTS "User_email_key";

CREATE UNIQUE INDEX "User_email_portalScope_key" ON "User"("email", "portalScope");
CREATE INDEX "User_portalScope_idx" ON "User"("portalScope");

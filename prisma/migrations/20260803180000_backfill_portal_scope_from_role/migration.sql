-- Idempotent backfill: align portalScope with role when safe.
-- Skips emails that already have a twin in the target scope (true dual accounts).

-- Staff roles stuck on CUSTOMER → STAFF (only if no STAFF twin for that email)
UPDATE "User" u
SET "portalScope" = 'STAFF'::"PortalScope"
FROM "Role" r
WHERE r.id = u."roleId"
  AND r."name" IN ('ADMIN', 'ADMIN_TEAM', 'VENDOR', 'SUPPORT', 'MANAGER')
  AND u."portalScope" = 'CUSTOMER'::"PortalScope"
  AND NOT EXISTS (
    SELECT 1
    FROM "User" twin
    WHERE twin.email = u.email
      AND twin."portalScope" = 'STAFF'::"PortalScope"
      AND twin.id <> u.id
  );

-- Customer role stuck on STAFF → CUSTOMER (only if no CUSTOMER twin for that email)
UPDATE "User" u
SET "portalScope" = 'CUSTOMER'::"PortalScope"
FROM "Role" r
WHERE r.id = u."roleId"
  AND r."name" = 'CUSTOMER'
  AND u."portalScope" = 'STAFF'::"PortalScope"
  AND NOT EXISTS (
    SELECT 1
    FROM "User" twin
    WHERE twin.email = u.email
      AND twin."portalScope" = 'CUSTOMER'::"PortalScope"
      AND twin.id <> u.id
  );

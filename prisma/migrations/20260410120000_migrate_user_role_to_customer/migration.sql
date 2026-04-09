-- Ensure CUSTOMER role exists (stable id for environments that never ran seed)
INSERT INTO "Role" ("id", "name", "createdAt", "updatedAt")
SELECT 'role_seed_customer', 'CUSTOMER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Role" WHERE "name" = 'CUSTOMER');

-- Move all users off legacy USER role onto CUSTOMER
UPDATE "User" u
SET "roleId" = (SELECT r."id" FROM "Role" r WHERE r."name" = 'CUSTOMER' LIMIT 1)
WHERE u."roleId" IN (SELECT r2."id" FROM "Role" r2 WHERE r2."name" = 'USER');

-- Remove legacy USER role (no remaining references after update)
DELETE FROM "Role" WHERE "name" = 'USER';

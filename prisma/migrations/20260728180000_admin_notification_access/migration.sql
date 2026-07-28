-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adminNotificationAccess" BOOLEAN NOT NULL DEFAULT false;

-- Existing team members keep alert access; new invites default to false (opt-in).
UPDATE "User" AS u
SET "adminNotificationAccess" = true
FROM "Role" AS r
WHERE u."roleId" = r.id
  AND r.name = 'ADMIN_TEAM';

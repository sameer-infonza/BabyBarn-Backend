-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_token_idx" ON "PasswordResetToken"("token");

-- Seed roles (stable ids for reference)
INSERT INTO "Role" ("id", "name", "createdAt", "updatedAt") VALUES
('role_seed_user', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('role_seed_admin', 'ADMIN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('role_seed_vendor', 'VENDOR', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- AlterTable: add roleId
ALTER TABLE "User" ADD COLUMN "roleId" TEXT;

-- Backfill from enum column
UPDATE "User" u
SET "roleId" = r."id"
FROM "Role" r
WHERE r."name" = u."role"::text;

-- Default any stray rows to USER (should not happen)
UPDATE "User" SET "roleId" = 'role_seed_user' WHERE "roleId" IS NULL;

ALTER TABLE "User" ALTER COLUMN "roleId" SET NOT NULL;

-- Drop old role enum column and type
ALTER TABLE "User" DROP COLUMN "role";

DROP TYPE "UserRole";

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AddressType" AS ENUM ('HOME', 'BUSINESS');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "Address" ADD COLUMN IF NOT EXISTS "company" TEXT;
ALTER TABLE "Address" ADD COLUMN IF NOT EXISTS "addressType" "AddressType" NOT NULL DEFAULT 'HOME';

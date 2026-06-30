-- AlterTable: support partial returns by tracking how many units a return covers.
ALTER TABLE "ReturnRequest" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;

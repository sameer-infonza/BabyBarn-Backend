-- DropIndex
DROP INDEX "Product_ageGroups_idx";

-- AlterTable
ALTER TABLE "BusinessSettings" ALTER COLUMN "id" SET DEFAULT 1,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "Product_ageGroups_idx" ON "Product"("ageGroups");

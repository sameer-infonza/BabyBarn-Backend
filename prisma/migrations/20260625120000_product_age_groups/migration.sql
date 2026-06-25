-- AlterTable
ALTER TABLE "Product" ADD COLUMN "ageGroups" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "Product_ageGroups_idx" ON "Product" USING GIN ("ageGroups");

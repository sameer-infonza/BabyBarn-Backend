-- Category hierarchy (up to 4 levels) + active flag; uniqueness scoped per parent.

ALTER TABLE "Category" ADD COLUMN "parentId" INTEGER;
ALTER TABLE "Category" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Category" DROP CONSTRAINT IF EXISTS "Category_name_key";
ALTER TABLE "Category" DROP CONSTRAINT IF EXISTS "Category_slug_key";

ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Category_parentId_name_key" ON "Category"("parentId", "name");
CREATE UNIQUE INDEX "Category_parentId_slug_key" ON "Category"("parentId", "slug");
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");

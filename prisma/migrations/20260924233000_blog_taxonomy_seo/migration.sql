ALTER TABLE "BlogCategory" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
ALTER TABLE "BlogCategory" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "BlogCategory" ADD COLUMN "imageAlt" TEXT;
ALTER TABLE "BlogCategory" ADD COLUMN "seoTitle" TEXT;
ALTER TABLE "BlogCategory" ADD COLUMN "metaDescription" TEXT;

ALTER TABLE "BlogTag" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
ALTER TABLE "BlogTag" ADD COLUMN "seoTitle" TEXT;
ALTER TABLE "BlogTag" ADD COLUMN "metaDescription" TEXT;

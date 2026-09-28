-- CreateEnum
CREATE TYPE "BlogPostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED');

-- CreateTable
CREATE TABLE "BlogCategory" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogTag" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogPost" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL DEFAULT '',
    "contentHtml" TEXT NOT NULL DEFAULT '',
    "featuredImageUrl" TEXT,
    "featuredImageAlt" TEXT,
    "authorName" TEXT NOT NULL DEFAULT 'Baby Barn',
    "status" "BlogPostStatus" NOT NULL DEFAULT 'DRAFT',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "seoTitle" TEXT,
    "metaDescription" TEXT,
    "ogTitle" TEXT,
    "ogDescription" TEXT,
    "ogImageUrl" TEXT,
    "canonicalUrl" TEXT,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogPostCategory" (
    "postId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,

    CONSTRAINT "BlogPostCategory_pkey" PRIMARY KEY ("postId","categoryId")
);

-- CreateTable
CREATE TABLE "BlogPostTag" (
    "postId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,

    CONSTRAINT "BlogPostTag_pkey" PRIMARY KEY ("postId","tagId")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlogCategory_publicId_key" ON "BlogCategory"("publicId");
CREATE UNIQUE INDEX "BlogCategory_slug_key" ON "BlogCategory"("slug");
CREATE INDEX "BlogCategory_name_idx" ON "BlogCategory"("name");

CREATE UNIQUE INDEX "BlogTag_publicId_key" ON "BlogTag"("publicId");
CREATE UNIQUE INDEX "BlogTag_slug_key" ON "BlogTag"("slug");
CREATE INDEX "BlogTag_name_idx" ON "BlogTag"("name");

CREATE UNIQUE INDEX "BlogPost_publicId_key" ON "BlogPost"("publicId");
CREATE INDEX "BlogPost_status_publishedAt_idx" ON "BlogPost"("status", "publishedAt");
CREATE INDEX "BlogPost_featured_status_idx" ON "BlogPost"("featured", "status");
CREATE INDEX "BlogPost_deletedAt_idx" ON "BlogPost"("deletedAt");
CREATE INDEX "BlogPost_slug_idx" ON "BlogPost"("slug");
CREATE UNIQUE INDEX "BlogPost_slug_live_key" ON "BlogPost"("slug") WHERE "deletedAt" IS NULL;

CREATE INDEX "BlogPostCategory_categoryId_idx" ON "BlogPostCategory"("categoryId");
CREATE INDEX "BlogPostTag_tagId_idx" ON "BlogPostTag"("tagId");

-- AddForeignKey
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BlogPostCategory" ADD CONSTRAINT "BlogPostCategory_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BlogPostCategory" ADD CONSTRAINT "BlogPostCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BlogCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BlogPostTag" ADD CONSTRAINT "BlogPostTag_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BlogPostTag" ADD CONSTRAINT "BlogPostTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "BlogTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

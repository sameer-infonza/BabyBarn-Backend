-- Homepage Section 1 carousel CMS
CREATE TYPE "HomepageCarouselSlideType" AS ENUM ('HERO', 'PRODUCT_GRID', 'LETTER');

CREATE TABLE "HomepageCarouselSlide" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "slideType" "HomepageCarouselSlideType" NOT NULL,
    "eyebrow" TEXT,
    "title" TEXT,
    "subtitle" TEXT,
    "bodyText" TEXT,
    "backgroundTone" TEXT,
    "primaryCtaLabel" TEXT,
    "primaryCtaHref" TEXT,
    "secondaryCtaLabel" TEXT,
    "secondaryCtaHref" TEXT,
    "chipLabel" TEXT,
    "rewardPercent" TEXT,
    "rewardLabel" TEXT,
    "imageUrl1" TEXT,
    "imageLabel1" TEXT,
    "imageUrl2" TEXT,
    "imageLabel2" TEXT,
    "backgroundImageUrl" TEXT,
    "signatureName" TEXT,
    "signatureFrom" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomepageCarouselSlide_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HomepageCarouselSlide_publicId_key" ON "HomepageCarouselSlide"("publicId");
CREATE INDEX "HomepageCarouselSlide_isActive_sortOrder_idx" ON "HomepageCarouselSlide"("isActive", "sortOrder");
CREATE INDEX "HomepageCarouselSlide_sortOrder_idx" ON "HomepageCarouselSlide"("sortOrder");

CREATE TABLE "HomepageCarouselProductCard" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "slideId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "productId" INTEGER,
    "customName" TEXT,
    "customCategory" TEXT,
    "customImageUrl" TEXT,
    "customMemberPrice" DOUBLE PRECISION,
    "customFullPrice" DOUBLE PRECISION,
    "isRefurbished" BOOLEAN NOT NULL DEFAULT false,
    "placeholderBg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomepageCarouselProductCard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HomepageCarouselProductCard_publicId_key" ON "HomepageCarouselProductCard"("publicId");
CREATE INDEX "HomepageCarouselProductCard_slideId_sortOrder_idx" ON "HomepageCarouselProductCard"("slideId", "sortOrder");
CREATE INDEX "HomepageCarouselProductCard_productId_idx" ON "HomepageCarouselProductCard"("productId");

ALTER TABLE "HomepageCarouselProductCard" ADD CONSTRAINT "HomepageCarouselProductCard_slideId_fkey" FOREIGN KEY ("slideId") REFERENCES "HomepageCarouselSlide"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomepageCarouselProductCard" ADD CONSTRAINT "HomepageCarouselProductCard_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

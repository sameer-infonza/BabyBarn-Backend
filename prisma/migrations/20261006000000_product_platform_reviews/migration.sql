-- Product & platform reviews
CREATE TYPE "ProductReviewStatus" AS ENUM ('APPROVED', 'REJECTED');
CREATE TYPE "PlatformReviewStatus" AS ENUM ('SUBMITTED');

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "averageRating" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "reviewCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "ratingBreakdown" JSONB;

CREATE TABLE "ProductReview" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "orderId" INTEGER NOT NULL,
    "orderItemId" INTEGER,
    "rating" INTEGER NOT NULL,
    "body" TEXT,
    "imageUrls" JSONB,
    "status" "ProductReviewStatus" NOT NULL DEFAULT 'APPROVED',
    "reviewerDisplayName" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformReview" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "returnRequestId" INTEGER NOT NULL,
    "returnExperienceRating" INTEGER NOT NULL,
    "storeCreditExperienceRating" INTEGER NOT NULL,
    "overallPlatformRating" INTEGER NOT NULL,
    "feedback" TEXT,
    "status" "PlatformReviewStatus" NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductReview_publicId_key" ON "ProductReview"("publicId");
CREATE UNIQUE INDEX "ProductReview_userId_productId_key" ON "ProductReview"("userId", "productId");
CREATE INDEX "ProductReview_productId_status_deletedAt_idx" ON "ProductReview"("productId", "status", "deletedAt");
CREATE INDEX "ProductReview_userId_idx" ON "ProductReview"("userId");
CREATE INDEX "ProductReview_orderId_idx" ON "ProductReview"("orderId");
CREATE INDEX "ProductReview_createdAt_idx" ON "ProductReview"("createdAt");

CREATE UNIQUE INDEX "PlatformReview_publicId_key" ON "PlatformReview"("publicId");
CREATE UNIQUE INDEX "PlatformReview_returnRequestId_key" ON "PlatformReview"("returnRequestId");
CREATE INDEX "PlatformReview_userId_idx" ON "PlatformReview"("userId");
CREATE INDEX "PlatformReview_createdAt_idx" ON "PlatformReview"("createdAt");
CREATE INDEX "PlatformReview_overallPlatformRating_idx" ON "PlatformReview"("overallPlatformRating");

ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlatformReview" ADD CONSTRAINT "PlatformReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlatformReview" ADD CONSTRAINT "PlatformReview_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

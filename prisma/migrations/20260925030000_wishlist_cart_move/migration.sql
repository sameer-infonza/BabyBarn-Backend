CREATE TABLE "WishlistCartMove" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WishlistCartMove_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WishlistCartMove_userId_productId_key" ON "WishlistCartMove"("userId", "productId");
CREATE INDEX "WishlistCartMove_productId_idx" ON "WishlistCartMove"("productId");

ALTER TABLE "WishlistCartMove" ADD CONSTRAINT "WishlistCartMove_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WishlistCartMove" ADD CONSTRAINT "WishlistCartMove_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

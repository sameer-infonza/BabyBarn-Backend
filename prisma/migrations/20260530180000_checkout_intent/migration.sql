-- CreateEnum
CREATE TYPE "CheckoutIntentStatus" AS ENUM ('PENDING', 'CONSUMED', 'EXPIRED', 'FAILED');

-- CreateTable
CREATE TABLE "CheckoutIntent" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" "CheckoutIntentStatus" NOT NULL DEFAULT 'PENDING',
    "checkoutSignature" TEXT NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "shippingCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "storeCreditApplied" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "shippingAddressJson" JSONB,
    "billingAddressJson" JSONB,
    "shippingCarrier" TEXT,
    "shippingShipmentId" TEXT,
    "selectedRateId" TEXT,
    "selectedRateProvider" TEXT,
    "selectedRateServiceLevel" TEXT,
    "selectedRateServiceToken" TEXT,
    "selectedRateAmount" DOUBLE PRECISION,
    "selectedRateCurrency" TEXT,
    "selectedRateEstimatedDays" INTEGER,
    "stripePaymentIntentId" TEXT,
    "orderPublicId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutIntentLine" (
    "id" SERIAL NOT NULL,
    "checkoutIntentId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "productVariantId" INTEGER,
    "quantity" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "CheckoutIntentLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutIntent_publicId_key" ON "CheckoutIntent"("publicId");
CREATE UNIQUE INDEX "CheckoutIntent_stripePaymentIntentId_key" ON "CheckoutIntent"("stripePaymentIntentId");
CREATE UNIQUE INDEX "CheckoutIntent_orderPublicId_key" ON "CheckoutIntent"("orderPublicId");
CREATE INDEX "CheckoutIntent_userId_status_idx" ON "CheckoutIntent"("userId", "status");
CREATE INDEX "CheckoutIntent_checkoutSignature_idx" ON "CheckoutIntent"("checkoutSignature");
CREATE INDEX "CheckoutIntent_createdAt_idx" ON "CheckoutIntent"("createdAt");
CREATE INDEX "CheckoutIntentLine_checkoutIntentId_idx" ON "CheckoutIntentLine"("checkoutIntentId");
CREATE INDEX "CheckoutIntentLine_productId_idx" ON "CheckoutIntentLine"("productId");

-- AddForeignKey
ALTER TABLE "CheckoutIntent" ADD CONSTRAINT "CheckoutIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CheckoutIntentLine" ADD CONSTRAINT "CheckoutIntentLine_checkoutIntentId_fkey" FOREIGN KEY ("checkoutIntentId") REFERENCES "CheckoutIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CheckoutIntentLine" ADD CONSTRAINT "CheckoutIntentLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CheckoutIntentLine" ADD CONSTRAINT "CheckoutIntentLine_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

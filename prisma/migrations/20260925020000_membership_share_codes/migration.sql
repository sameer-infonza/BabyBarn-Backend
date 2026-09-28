CREATE TYPE "MembershipShareUseMode" AS ENUM ('ONE_TIME', 'MULTIPLE');

CREATE TABLE "MembershipShareCode" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "noteEmail" TEXT,
    "expiresAt" TIMESTAMP(3),
    "useMode" "MembershipShareUseMode" NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipShareCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MembershipShareCode_publicId_key" ON "MembershipShareCode"("publicId");
CREATE UNIQUE INDEX "MembershipShareCode_code_key" ON "MembershipShareCode"("code");
CREATE INDEX "MembershipShareCode_ownerId_idx" ON "MembershipShareCode"("ownerId");

ALTER TABLE "MembershipShareCode" ADD CONSTRAINT "MembershipShareCode_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CheckoutIntent" ADD COLUMN "sharedAccessCodeId" INTEGER;
ALTER TABLE "Order" ADD COLUMN "sharedAccessCodeId" INTEGER;

ALTER TABLE "Order" ADD CONSTRAINT "Order_sharedAccessCodeId_fkey" FOREIGN KEY ("sharedAccessCodeId") REFERENCES "MembershipShareCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Order_sharedAccessCodeId_idx" ON "Order"("sharedAccessCodeId");

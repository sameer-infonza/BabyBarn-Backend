-- =============================================================================
-- MyBABY BARN — PostgreSQL schema (full DDL)
-- Generated from Prisma: backend/prisma/schema.prisma
-- Regenerated with:
--   npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script -o docs/database/schema-full.sql
--
-- How to use in PostgreSQL (read-only review DB recommended):
--   1. Create empty database:  CREATE DATABASE babybarn_schema_review;
--   2. Apply this file:       psql -d babybarn_schema_review -f schema-full.sql
--   3. Inspect tables/indexes in pgAdmin, DBeaver, or \dt / \d+ tablename
--
-- Do NOT run against production unless you intend to create an empty schema.
-- Live environments use Prisma migrations under prisma/migrations/.
-- =============================================================================
-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PROCESSING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('UNPAID', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "OrderFulfillmentStatus" AS ENUM ('NEW_ORDER', 'ACCEPTED', 'PICKUP_READY', 'LABEL_GENERATED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED');

-- CreateEnum
CREATE TYPE "ReturnType" AS ENUM ('STANDARD', 'REFURBISHMENT');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'ELIGIBILITY_REVIEW', 'ELIGIBILITY_REJECTED', 'APPROVED', 'LABEL_GENERATED', 'IN_TRANSIT', 'RECEIVED', 'UNDER_INSPECTION', 'INSPECTION_APPROVED', 'INSPECTION_REJECTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RefurbEligibilityDecision" AS ENUM ('PASS', 'FAIL', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "RefurbConditionGrade" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "ReturnPackageRequestStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'SENT');

-- CreateEnum
CREATE TYPE "OrderItemPricingTier" AS ENUM ('STANDARD', 'ACCESS');

-- CreateEnum
CREATE TYPE "StoreCreditTxnType" AS ENUM ('EARNED', 'REDEEMED', 'ADJUSTED', 'HOLD', 'RELEASE');

-- CreateEnum
CREATE TYPE "MembershipPaymentType" AS ENUM ('PURCHASE', 'RENEWAL');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('NEW', 'REFURBISHED');

-- CreateEnum
CREATE TYPE "InventoryLedgerEventType" AS ENUM ('RESERVE', 'RELEASE', 'COMMIT', 'ADJUST', 'RESTOCK', 'REFUND_RESTORE');

-- CreateEnum
CREATE TYPE "ProductUnitStatus" AS ENUM ('IN_STOCK', 'RESERVED', 'SOLD', 'WITH_CUSTOMER', 'RETURNED', 'INSPECTION', 'REFURBISHING', 'QA_HOLD', 'AVAILABLE_REFURB', 'RETIRED');

-- CreateEnum
CREATE TYPE "RefurbishmentJobStatus" AS ENUM ('RECEIVED', 'INSPECTION', 'CLEANING', 'IRONING', 'REPAIR', 'IN_PROGRESS', 'QA_APPROVED', 'LISTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CancellationReviewStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AdminNotificationType" AS ENUM ('NEW_ORDER', 'RETURN_REQUEST', 'LOW_STOCK', 'CANCELLATION_REVIEW', 'INSPECTION_QUEUED', 'ACCESS_EXPIRING');

-- CreateEnum
CREATE TYPE "HomepageCarouselSlideType" AS ENUM ('HERO', 'PRODUCT_GRID', 'LETTER');

-- CreateEnum
CREATE TYPE "ShippingProviderLogLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateEnum
CREATE TYPE "PortalScope" AS ENUM ('CUSTOMER', 'STAFF');

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('HOME', 'BUSINESS');

-- CreateEnum
CREATE TYPE "CheckoutIntentStatus" AS ENUM ('PENDING', 'CONSUMED', 'EXPIRED', 'FAILED');

-- CreateTable
CREATE TABLE "Role" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "portalScope" "PortalScope" NOT NULL DEFAULT 'CUSTOMER',
    "password" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "phone" TEXT,
    "roleId" INTEGER NOT NULL,
    "stripeCustomerId" TEXT,
    "accessNumber" TEXT,
    "babyName" TEXT,
    "avatarUrl" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "children" JSONB,
    "notificationPrefs" JSONB,
    "membershipShippingAddressJson" JSONB,
    "accessRenewalReminderSentAt" TIMESTAMP(3),
    "accessExpiryDayReminderSentAt" TIMESTAMP(3),
    "accessExpiredNoticeSentAt" TIMESTAMP(3),
    "accessMemberUntil" TIMESTAMP(3),
    "emailVerifiedAt" TIMESTAMP(3),
    "isGuest" BOOLEAN NOT NULL DEFAULT false,
    "guestCreatedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "guestPurgedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "adminModules" JSONB,
    "adminNotificationAccess" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipPayment" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" "MembershipPaymentType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "stripeSessionId" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accessValidUntil" TIMESTAMP(3),

    CONSTRAINT "MembershipPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "fullName" TEXT,
    "company" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "street" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zipCode" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "addressType" "AddressType" NOT NULL DEFAULT 'HOME',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "parentId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "shortDescription" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "reservedStock" INTEGER NOT NULL DEFAULT 0,
    "stockVersion" INTEGER NOT NULL DEFAULT 0,
    "categoryId" INTEGER NOT NULL,
    "imageUrl" TEXT,
    "sku" TEXT NOT NULL,
    "memberPrice" DOUBLE PRECISION,
    "compareAtPrice" DOUBLE PRECISION,
    "unitPriceAmount" DOUBLE PRECISION,
    "unitPriceReference" TEXT,
    "fabric" TEXT,
    "feel" TEXT,
    "fit" TEXT,
    "care" TEXT,
    "reorderPoint" INTEGER,
    "sizeAgeGroup" TEXT,
    "ageGroups" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "vendor" TEXT,
    "tags" TEXT,
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "isActiveListing" BOOLEAN NOT NULL DEFAULT true,
    "inventoryModel" TEXT NOT NULL DEFAULT 'simple',
    "gallery" JSONB,
    "productType" "ProductType" NOT NULL DEFAULT 'NEW',
    "sourceReturnId" INTEGER,
    "sourceProductId" INTEGER,
    "conditionGrade" "RefurbConditionGrade",
    "refurbishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "combination" JSONB NOT NULL,
    "sku" TEXT NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "reservedStock" INTEGER NOT NULL DEFAULT 0,
    "stockVersion" INTEGER NOT NULL DEFAULT 0,
    "priceOverride" DOUBLE PRECISION,
    "memberPriceOverride" DOUBLE PRECISION,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutIntent" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" "CheckoutIntentStatus" NOT NULL DEFAULT 'PENDING',
    "checkoutSignature" TEXT NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "shippingCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
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
    "includeAccessMembership" BOOLEAN NOT NULL DEFAULT false,
    "accessMembershipAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "membershipBabyName" TEXT,
    "contactEmail" TEXT,
    "placedAsGuest" BOOLEAN NOT NULL DEFAULT false,
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
    "retailUnitPrice" DOUBLE PRECISION,
    "memberPriceSnapshot" DOUBLE PRECISION,
    "pricingTier" "OrderItemPricingTier" NOT NULL DEFAULT 'STANDARD',

    CONSTRAINT "CheckoutIntentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "fulfillmentStatus" "OrderFulfillmentStatus",
    "packageDetailsJson" JSONB,
    "manualShippingNotes" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "fulfillmentAcceptedAt" TIMESTAMP(3),
    "pickupReadyAt" TIMESTAMP(3),
    "labelGeneratedAt" TIMESTAMP(3),
    "outboundShippedAt" TIMESTAMP(3),
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "shippingCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shippingAddressJson" JSONB,
    "billingAddressJson" JSONB,
    "shippingCarrier" TEXT,
    "trackingNumber" TEXT,
    "shippingLabelUrl" TEXT,
    "selectedRateId" TEXT,
    "selectedRateProvider" TEXT,
    "selectedRateServiceLevel" TEXT,
    "selectedRateServiceToken" TEXT,
    "selectedRateAmount" DOUBLE PRECISION,
    "selectedRateCurrency" TEXT,
    "selectedRateEstimatedDays" INTEGER,
    "shippingShipmentId" TEXT,
    "shippingTransactionId" TEXT,
    "returnShipmentId" TEXT,
    "returnLabelUrl" TEXT,
    "returnTrackingNumber" TEXT,
    "returnShippingCarrier" TEXT,
    "returnTransactionId" TEXT,
    "trackingStatus" TEXT,
    "trackingStatusDetails" TEXT,
    "trackingStatusDate" TIMESTAMP(3),
    "trackingEta" TIMESTAMP(3),
    "trackingHistoryJson" JSONB,
    "paymentStatus" "OrderPaymentStatus" NOT NULL DEFAULT 'PAID',
    "stripeCheckoutSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "appliedStripeRefundIds" JSONB,
    "storeCreditApplied" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "accessMembershipIncluded" BOOLEAN NOT NULL DEFAULT false,
    "membershipPaymentId" INTEGER,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "placedAsGuest" BOOLEAN NOT NULL DEFAULT false,
    "includeReturnEnvelope" BOOLEAN NOT NULL DEFAULT false,
    "returnEnvelopeUsed" BOOLEAN NOT NULL DEFAULT false,
    "cancellationReviewStatus" "CancellationReviewStatus" NOT NULL DEFAULT 'NONE',
    "cancellationRequestedAt" TIMESTAMP(3),
    "cancellationRequestReason" TEXT,
    "cancellationReviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentTrackingEvent" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ups',
    "statusCode" TEXT,
    "description" TEXT,
    "location" TEXT,
    "raw" JSONB,
    "eventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentTrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupList" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PickupList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupListLine" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "pickupListId" INTEGER NOT NULL,
    "orderId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PickupListLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "pickupAddressJson" JSONB,
    "defaultPackageJson" JSONB,
    "autoLabelGeneration" BOOLEAN NOT NULL DEFAULT false,
    "manualShippingAllowed" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "productVariantId" INTEGER,
    "quantity" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "pricingTier" "OrderItemPricingTier" NOT NULL DEFAULT 'STANDARD',
    "retailUnitPrice" DOUBLE PRECISION,
    "memberPriceSnapshot" DOUBLE PRECISION,
    "pickedQuantity" INTEGER NOT NULL DEFAULT 0,
    "pickedAt" TIMESTAMP(3),
    "pickedByUserId" INTEGER,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "submissionPublicId" TEXT NOT NULL,
    "returnNumber" TEXT,
    "userId" INTEGER NOT NULL,
    "orderId" INTEGER NOT NULL,
    "orderItemId" INTEGER,
    "type" "ReturnType" NOT NULL DEFAULT 'STANDARD',
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
    "acceptedQuantity" INTEGER,
    "rejectedQuantity" INTEGER,
    "reason" TEXT,
    "notes" TEXT,
    "customerNotes" TEXT,
    "adminNotes" TEXT,
    "rejectionReason" TEXT,
    "photoUrlsJson" JSONB,
    "inspectorPhotoUrlsJson" JSONB,
    "disposition" TEXT,
    "dispositionQuantity" INTEGER,
    "rejectedDisposition" TEXT,
    "creditAwarded" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "refundAmount" DOUBLE PRECISION,
    "stripeRefundId" TEXT,
    "refundedAt" TIMESTAMP(3),
    "refundPaymentMethodLabel" TEXT,
    "restockedAt" TIMESTAMP(3),
    "restockedQuantity" INTEGER,
    "manualCarrier" TEXT,
    "manualTrackingNumber" TEXT,
    "manualShippedAt" TIMESTAMP(3),
    "customerShippingNote" TEXT,
    "customerShippingPhotoUrl" TEXT,
    "customerShippingSubmittedAt" TIMESTAMP(3),
    "shipByDeadline" TIMESTAMP(3),
    "keepWaitingUntil" TIMESTAMP(3),
    "inspectionChecklistJson" JSONB,
    "returnLabelUrl" TEXT,
    "returnTrackingNumber" TEXT,
    "returnShippingCarrier" TEXT,
    "returnShipmentId" TEXT,
    "returnTransactionId" TEXT,
    "labelGeneratedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "inspectionApprovedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnReceivePackage" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "submissionPublicId" TEXT NOT NULL,
    "packageNumber" INTEGER NOT NULL,
    "receivedByUserId" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnReceivePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnReceivePackageLine" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "packageId" INTEGER NOT NULL,
    "returnRequestId" INTEGER NOT NULL,
    "quantityReceived" INTEGER NOT NULL,

    CONSTRAINT "ReturnReceivePackageLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnStatusEvent" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "returnRequestId" INTEGER NOT NULL,
    "fromStatus" "ReturnStatus",
    "toStatus" "ReturnStatus" NOT NULL,
    "actorUserId" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnPackageRequest" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "orderId" INTEGER NOT NULL,
    "returnRequestId" INTEGER,
    "reason" TEXT NOT NULL,
    "comments" TEXT,
    "status" "ReturnPackageRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "dispatchDate" TIMESTAMP(3),
    "uspsTrackingNumber" TEXT,
    "expectedDeliveryDate" TIMESTAMP(3),
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnPackageRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLedgerEvent" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "productVariantId" INTEGER,
    "quantityDelta" INTEGER NOT NULL,
    "eventType" "InventoryLedgerEventType" NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "actorUserId" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLedgerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductUnit" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "unitSku" TEXT NOT NULL,
    "productId" INTEGER,
    "productVariantId" INTEGER,
    "status" "ProductUnitStatus" NOT NULL DEFAULT 'IN_STOCK',
    "cycleNumber" INTEGER NOT NULL DEFAULT 1,
    "sourceOrderItemId" INTEGER,
    "sourceReturnId" INTEGER,
    "purchasedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "inspectedAt" TIMESTAMP(3),
    "refurbishedAt" TIMESTAMP(3),
    "relistedAt" TIMESTAMP(3),
    "soldAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductUnitEvent" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "unitId" INTEGER NOT NULL,
    "fromStatus" "ProductUnitStatus",
    "toStatus" "ProductUnitStatus" NOT NULL,
    "actorUserId" INTEGER,
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductUnitEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefurbishmentJob" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "returnRequestId" INTEGER NOT NULL,
    "status" "RefurbishmentJobStatus" NOT NULL DEFAULT 'RECEIVED',
    "listedProductId" INTEGER,
    "notes" TEXT,
    "inspectedAt" TIMESTAMP(3),
    "refurbishedAt" TIMESTAMP(3),
    "listedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefurbishmentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnEligibilityQuestionnaire" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "returnRequestId" INTEGER NOT NULL,
    "answersJson" JSONB NOT NULL,
    "photoUrlsJson" JSONB,
    "autoDecision" "RefurbEligibilityDecision" NOT NULL,
    "autoDecisionReasons" JSONB,
    "reviewedByUserId" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnEligibilityQuestionnaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefurbInspectionRecord" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "returnRequestId" INTEGER,
    "refurbishmentJobId" INTEGER,
    "inspectorUserId" INTEGER,
    "grade" "RefurbConditionGrade",
    "notes" TEXT,
    "photoUrlsJson" JSONB,
    "tasksCompletedJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefurbInspectionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WishlistItem" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "productVariantId" INTEGER,
    "priceAtAdd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAlertSubscription" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "productVariantId" INTEGER,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAlertSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminNotification" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "type" "AdminNotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminNotificationRead" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "notificationId" INTEGER NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminNotificationRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "accessMembershipPriceUsd" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "accessUsedReturnWindowDays" INTEGER NOT NULL DEFAULT 365,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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
    "customHref" TEXT,
    "isRefurbished" BOOLEAN NOT NULL DEFAULT false,
    "placeholderBg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomepageCarouselProductCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingProvider" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "credentialsEncrypted" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingServiceMethod" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "providerId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "visibleAtCheckout" BOOLEAN NOT NULL DEFAULT true,
    "visibleInAdmin" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "rules" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingServiceMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingProviderLog" (
    "id" SERIAL NOT NULL,
    "providerSlug" TEXT NOT NULL,
    "level" "ShippingProviderLogLevel" NOT NULL DEFAULT 'INFO',
    "action" TEXT NOT NULL,
    "orderPublicId" TEXT,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShippingProviderLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreCreditWallet" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "heldBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCreditWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreCreditTransaction" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "walletId" INTEGER NOT NULL,
    "type" "StoreCreditTxnType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "orderPublicId" TEXT,
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreCreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" SERIAL NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobLease" (
    "jobKey" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "lastStartedAt" TIMESTAMP(3),
    "lastFinishedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobLease_pkey" PRIMARY KEY ("jobKey")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryAdjustment" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "productVariantId" INTEGER,
    "userId" INTEGER NOT NULL,
    "quantityChange" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_publicId_key" ON "Role"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_publicId_key" ON "User"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "User_accessNumber_key" ON "User"("accessNumber");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_portalScope_idx" ON "User"("portalScope");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- CreateIndex
CREATE INDEX "User_publicId_idx" ON "User"("publicId");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE INDEX "User_accessNumber_idx" ON "User"("accessNumber");

-- CreateIndex
CREATE INDEX "User_isGuest_idx" ON "User"("isGuest");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_portalScope_key" ON "User"("email", "portalScope");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipPayment_publicId_key" ON "MembershipPayment"("publicId");

-- CreateIndex
CREATE INDEX "MembershipPayment_userId_idx" ON "MembershipPayment"("userId");

-- CreateIndex
CREATE INDEX "MembershipPayment_paidAt_idx" ON "MembershipPayment"("paidAt");

-- CreateIndex
CREATE INDEX "MembershipPayment_stripeSessionId_idx" ON "MembershipPayment"("stripeSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_publicId_key" ON "EmailVerificationToken"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_token_key" ON "EmailVerificationToken"("token");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_token_idx" ON "EmailVerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_publicId_key" ON "PasswordResetToken"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_token_idx" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Address_publicId_key" ON "Address"("publicId");

-- CreateIndex
CREATE INDEX "Address_userId_idx" ON "Address"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_publicId_key" ON "Category"("publicId");

-- CreateIndex
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_parentId_name_key" ON "Category"("parentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_parentId_slug_key" ON "Category"("parentId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Product_publicId_key" ON "Product"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "Product_slug_idx" ON "Product"("slug");

-- CreateIndex
CREATE INDEX "Product_publicId_idx" ON "Product"("publicId");

-- CreateIndex
CREATE INDEX "Product_isDraft_idx" ON "Product"("isDraft");

-- CreateIndex
CREATE INDEX "Product_productType_idx" ON "Product"("productType");

-- CreateIndex
CREATE INDEX "Product_sourceReturnId_idx" ON "Product"("sourceReturnId");

-- CreateIndex
CREATE INDEX "Product_sourceProductId_idx" ON "Product"("sourceProductId");

-- CreateIndex
CREATE INDEX "Product_ageGroups_idx" ON "Product"("ageGroups");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_publicId_key" ON "ProductVariant"("publicId");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_sku_key" ON "ProductVariant"("productId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutIntent_publicId_key" ON "CheckoutIntent"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutIntent_stripePaymentIntentId_key" ON "CheckoutIntent"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutIntent_orderPublicId_key" ON "CheckoutIntent"("orderPublicId");

-- CreateIndex
CREATE INDEX "CheckoutIntent_userId_status_idx" ON "CheckoutIntent"("userId", "status");

-- CreateIndex
CREATE INDEX "CheckoutIntent_checkoutSignature_idx" ON "CheckoutIntent"("checkoutSignature");

-- CreateIndex
CREATE INDEX "CheckoutIntent_createdAt_idx" ON "CheckoutIntent"("createdAt");

-- CreateIndex
CREATE INDEX "CheckoutIntentLine_checkoutIntentId_idx" ON "CheckoutIntentLine"("checkoutIntentId");

-- CreateIndex
CREATE INDEX "CheckoutIntentLine_productId_idx" ON "CheckoutIntentLine"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_publicId_key" ON "Order"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_stripeCheckoutSessionId_key" ON "Order"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_stripePaymentIntentId_key" ON "Order"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_fulfillmentStatus_idx" ON "Order"("fulfillmentStatus");

-- CreateIndex
CREATE INDEX "Order_publicId_idx" ON "Order"("publicId");

-- CreateIndex
CREATE INDEX "Order_orderNumber_idx" ON "Order"("orderNumber");

-- CreateIndex
CREATE INDEX "Order_paymentStatus_idx" ON "Order"("paymentStatus");

-- CreateIndex
CREATE INDEX "Order_cancellationReviewStatus_idx" ON "Order"("cancellationReviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentTrackingEvent_publicId_key" ON "ShipmentTrackingEvent"("publicId");

-- CreateIndex
CREATE INDEX "ShipmentTrackingEvent_orderId_createdAt_idx" ON "ShipmentTrackingEvent"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PickupList_publicId_key" ON "PickupList"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "PickupListLine_publicId_key" ON "PickupListLine"("publicId");

-- CreateIndex
CREATE INDEX "PickupListLine_orderId_idx" ON "PickupListLine"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PickupListLine_pickupListId_orderId_key" ON "PickupListLine"("pickupListId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_publicId_key" ON "OrderItem"("publicId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "OrderItem_productVariantId_idx" ON "OrderItem"("productVariantId");

-- CreateIndex
CREATE INDEX "OrderItem_pickedByUserId_idx" ON "OrderItem"("pickedByUserId");

-- CreateIndex
CREATE INDEX "OrderItem_cancelledAt_idx" ON "OrderItem"("cancelledAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRequest_publicId_key" ON "ReturnRequest"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRequest_returnNumber_key" ON "ReturnRequest"("returnNumber");

-- CreateIndex
CREATE INDEX "ReturnRequest_userId_idx" ON "ReturnRequest"("userId");

-- CreateIndex
CREATE INDEX "ReturnRequest_orderId_idx" ON "ReturnRequest"("orderId");

-- CreateIndex
CREATE INDEX "ReturnRequest_status_idx" ON "ReturnRequest"("status");

-- CreateIndex
CREATE INDEX "ReturnRequest_submissionPublicId_idx" ON "ReturnRequest"("submissionPublicId");

-- CreateIndex
CREATE INDEX "ReturnRequest_returnNumber_idx" ON "ReturnRequest"("returnNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnReceivePackage_publicId_key" ON "ReturnReceivePackage"("publicId");

-- CreateIndex
CREATE INDEX "ReturnReceivePackage_submissionPublicId_idx" ON "ReturnReceivePackage"("submissionPublicId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnReceivePackage_submissionPublicId_packageNumber_key" ON "ReturnReceivePackage"("submissionPublicId", "packageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnReceivePackageLine_publicId_key" ON "ReturnReceivePackageLine"("publicId");

-- CreateIndex
CREATE INDEX "ReturnReceivePackageLine_packageId_idx" ON "ReturnReceivePackageLine"("packageId");

-- CreateIndex
CREATE INDEX "ReturnReceivePackageLine_returnRequestId_idx" ON "ReturnReceivePackageLine"("returnRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnStatusEvent_publicId_key" ON "ReturnStatusEvent"("publicId");

-- CreateIndex
CREATE INDEX "ReturnStatusEvent_returnRequestId_createdAt_idx" ON "ReturnStatusEvent"("returnRequestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnPackageRequest_publicId_key" ON "ReturnPackageRequest"("publicId");

-- CreateIndex
CREATE INDEX "ReturnPackageRequest_userId_idx" ON "ReturnPackageRequest"("userId");

-- CreateIndex
CREATE INDEX "ReturnPackageRequest_orderId_idx" ON "ReturnPackageRequest"("orderId");

-- CreateIndex
CREATE INDEX "ReturnPackageRequest_returnRequestId_idx" ON "ReturnPackageRequest"("returnRequestId");

-- CreateIndex
CREATE INDEX "ReturnPackageRequest_status_idx" ON "ReturnPackageRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLedgerEvent_publicId_key" ON "InventoryLedgerEvent"("publicId");

-- CreateIndex
CREATE INDEX "InventoryLedgerEvent_productId_createdAt_idx" ON "InventoryLedgerEvent"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryLedgerEvent_productVariantId_idx" ON "InventoryLedgerEvent"("productVariantId");

-- CreateIndex
CREATE INDEX "InventoryLedgerEvent_referenceType_referenceId_idx" ON "InventoryLedgerEvent"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "InventoryLedgerEvent_eventType_idx" ON "InventoryLedgerEvent"("eventType");

-- CreateIndex
CREATE INDEX "InventoryLedgerEvent_createdAt_idx" ON "InventoryLedgerEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductUnit_publicId_key" ON "ProductUnit"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductUnit_unitSku_key" ON "ProductUnit"("unitSku");

-- CreateIndex
CREATE INDEX "ProductUnit_productId_idx" ON "ProductUnit"("productId");

-- CreateIndex
CREATE INDEX "ProductUnit_status_idx" ON "ProductUnit"("status");

-- CreateIndex
CREATE INDEX "ProductUnit_sourceReturnId_idx" ON "ProductUnit"("sourceReturnId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductUnitEvent_publicId_key" ON "ProductUnitEvent"("publicId");

-- CreateIndex
CREATE INDEX "ProductUnitEvent_unitId_createdAt_idx" ON "ProductUnitEvent"("unitId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefurbishmentJob_publicId_key" ON "RefurbishmentJob"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "RefurbishmentJob_returnRequestId_key" ON "RefurbishmentJob"("returnRequestId");

-- CreateIndex
CREATE INDEX "RefurbishmentJob_status_idx" ON "RefurbishmentJob"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnEligibilityQuestionnaire_publicId_key" ON "ReturnEligibilityQuestionnaire"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnEligibilityQuestionnaire_returnRequestId_key" ON "ReturnEligibilityQuestionnaire"("returnRequestId");

-- CreateIndex
CREATE INDEX "ReturnEligibilityQuestionnaire_autoDecision_idx" ON "ReturnEligibilityQuestionnaire"("autoDecision");

-- CreateIndex
CREATE UNIQUE INDEX "RefurbInspectionRecord_publicId_key" ON "RefurbInspectionRecord"("publicId");

-- CreateIndex
CREATE INDEX "RefurbInspectionRecord_returnRequestId_idx" ON "RefurbInspectionRecord"("returnRequestId");

-- CreateIndex
CREATE INDEX "RefurbInspectionRecord_refurbishmentJobId_idx" ON "RefurbInspectionRecord"("refurbishmentJobId");

-- CreateIndex
CREATE INDEX "WishlistItem_userId_idx" ON "WishlistItem"("userId");

-- CreateIndex
CREATE INDEX "WishlistItem_productId_idx" ON "WishlistItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "WishlistItem_userId_productId_productVariantId_key" ON "WishlistItem"("userId", "productId", "productVariantId");

-- CreateIndex
CREATE INDEX "StockAlertSubscription_productId_idx" ON "StockAlertSubscription"("productId");

-- CreateIndex
CREATE INDEX "StockAlertSubscription_userId_idx" ON "StockAlertSubscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StockAlertSubscription_userId_productId_productVariantId_key" ON "StockAlertSubscription"("userId", "productId", "productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminAuditLog_publicId_key" ON "AdminAuditLog"("publicId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_entityType_entityId_idx" ON "AdminAuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminNotification_publicId_key" ON "AdminNotification"("publicId");

-- CreateIndex
CREATE INDEX "AdminNotification_type_entityId_idx" ON "AdminNotification"("type", "entityId");

-- CreateIndex
CREATE INDEX "AdminNotification_module_idx" ON "AdminNotification"("module");

-- CreateIndex
CREATE INDEX "AdminNotification_createdAt_idx" ON "AdminNotification"("createdAt");

-- CreateIndex
CREATE INDEX "AdminNotificationRead_userId_idx" ON "AdminNotificationRead"("userId");

-- CreateIndex
CREATE INDEX "AdminNotificationRead_notificationId_idx" ON "AdminNotificationRead"("notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminNotificationRead_userId_notificationId_key" ON "AdminNotificationRead"("userId", "notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "HomepageCarouselSlide_publicId_key" ON "HomepageCarouselSlide"("publicId");

-- CreateIndex
CREATE INDEX "HomepageCarouselSlide_isActive_sortOrder_idx" ON "HomepageCarouselSlide"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "HomepageCarouselSlide_sortOrder_idx" ON "HomepageCarouselSlide"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "HomepageCarouselProductCard_publicId_key" ON "HomepageCarouselProductCard"("publicId");

-- CreateIndex
CREATE INDEX "HomepageCarouselProductCard_slideId_sortOrder_idx" ON "HomepageCarouselProductCard"("slideId", "sortOrder");

-- CreateIndex
CREATE INDEX "HomepageCarouselProductCard_productId_idx" ON "HomepageCarouselProductCard"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingProvider_publicId_key" ON "ShippingProvider"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingProvider_slug_key" ON "ShippingProvider"("slug");

-- CreateIndex
CREATE INDEX "ShippingProvider_enabled_idx" ON "ShippingProvider"("enabled");

-- CreateIndex
CREATE INDEX "ShippingProvider_sortOrder_idx" ON "ShippingProvider"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingServiceMethod_publicId_key" ON "ShippingServiceMethod"("publicId");

-- CreateIndex
CREATE INDEX "ShippingServiceMethod_providerId_idx" ON "ShippingServiceMethod"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingServiceMethod_providerId_code_key" ON "ShippingServiceMethod"("providerId", "code");

-- CreateIndex
CREATE INDEX "ShippingProviderLog_providerSlug_createdAt_idx" ON "ShippingProviderLog"("providerSlug", "createdAt");

-- CreateIndex
CREATE INDEX "ShippingProviderLog_createdAt_idx" ON "ShippingProviderLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoreCreditWallet_publicId_key" ON "StoreCreditWallet"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreCreditWallet_userId_key" ON "StoreCreditWallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreCreditTransaction_publicId_key" ON "StoreCreditTransaction"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreCreditTransaction_sourceKey_key" ON "StoreCreditTransaction"("sourceKey");

-- CreateIndex
CREATE INDEX "StoreCreditTransaction_walletId_idx" ON "StoreCreditTransaction"("walletId");

-- CreateIndex
CREATE INDEX "StoreCreditTransaction_type_idx" ON "StoreCreditTransaction"("type");

-- CreateIndex
CREATE INDEX "StoreCreditTransaction_orderPublicId_idx" ON "StoreCreditTransaction"("orderPublicId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeWebhookEvent_eventId_key" ON "StripeWebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_processedAt_idx" ON "StripeWebhookEvent"("processedAt");

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_status_idx" ON "StripeWebhookEvent"("status");

-- CreateIndex
CREATE INDEX "JobLease_leaseExpiresAt_idx" ON "JobLease"("leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_publicId_key" ON "RefreshToken"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryAdjustment_publicId_key" ON "InventoryAdjustment"("publicId");

-- CreateIndex
CREATE INDEX "InventoryAdjustment_productId_idx" ON "InventoryAdjustment"("productId");

-- CreateIndex
CREATE INDEX "InventoryAdjustment_productVariantId_idx" ON "InventoryAdjustment"("productVariantId");

-- CreateIndex
CREATE INDEX "InventoryAdjustment_userId_idx" ON "InventoryAdjustment"("userId");

-- CreateIndex
CREATE INDEX "InventoryAdjustment_createdAt_idx" ON "InventoryAdjustment"("createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipPayment" ADD CONSTRAINT "MembershipPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_sourceReturnId_fkey" FOREIGN KEY ("sourceReturnId") REFERENCES "ReturnRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_sourceProductId_fkey" FOREIGN KEY ("sourceProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutIntent" ADD CONSTRAINT "CheckoutIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutIntentLine" ADD CONSTRAINT "CheckoutIntentLine_checkoutIntentId_fkey" FOREIGN KEY ("checkoutIntentId") REFERENCES "CheckoutIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutIntentLine" ADD CONSTRAINT "CheckoutIntentLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutIntentLine" ADD CONSTRAINT "CheckoutIntentLine_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_membershipPaymentId_fkey" FOREIGN KEY ("membershipPaymentId") REFERENCES "MembershipPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentTrackingEvent" ADD CONSTRAINT "ShipmentTrackingEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupListLine" ADD CONSTRAINT "PickupListLine_pickupListId_fkey" FOREIGN KEY ("pickupListId") REFERENCES "PickupList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupListLine" ADD CONSTRAINT "PickupListLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_pickedByUserId_fkey" FOREIGN KEY ("pickedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnReceivePackage" ADD CONSTRAINT "ReturnReceivePackage_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnReceivePackageLine" ADD CONSTRAINT "ReturnReceivePackageLine_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ReturnReceivePackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnReceivePackageLine" ADD CONSTRAINT "ReturnReceivePackageLine_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnStatusEvent" ADD CONSTRAINT "ReturnStatusEvent_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnPackageRequest" ADD CONSTRAINT "ReturnPackageRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnPackageRequest" ADD CONSTRAINT "ReturnPackageRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnPackageRequest" ADD CONSTRAINT "ReturnPackageRequest_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedgerEvent" ADD CONSTRAINT "InventoryLedgerEvent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedgerEvent" ADD CONSTRAINT "InventoryLedgerEvent_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductUnit" ADD CONSTRAINT "ProductUnit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductUnit" ADD CONSTRAINT "ProductUnit_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductUnit" ADD CONSTRAINT "ProductUnit_sourceReturnId_fkey" FOREIGN KEY ("sourceReturnId") REFERENCES "ReturnRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductUnitEvent" ADD CONSTRAINT "ProductUnitEvent_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "ProductUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefurbishmentJob" ADD CONSTRAINT "RefurbishmentJob_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefurbishmentJob" ADD CONSTRAINT "RefurbishmentJob_listedProductId_fkey" FOREIGN KEY ("listedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnEligibilityQuestionnaire" ADD CONSTRAINT "ReturnEligibilityQuestionnaire_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnEligibilityQuestionnaire" ADD CONSTRAINT "ReturnEligibilityQuestionnaire_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefurbInspectionRecord" ADD CONSTRAINT "RefurbInspectionRecord_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefurbInspectionRecord" ADD CONSTRAINT "RefurbInspectionRecord_refurbishmentJobId_fkey" FOREIGN KEY ("refurbishmentJobId") REFERENCES "RefurbishmentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefurbInspectionRecord" ADD CONSTRAINT "RefurbInspectionRecord_inspectorUserId_fkey" FOREIGN KEY ("inspectorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAlertSubscription" ADD CONSTRAINT "StockAlertSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAlertSubscription" ADD CONSTRAINT "StockAlertSubscription_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAlertSubscription" ADD CONSTRAINT "StockAlertSubscription_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNotificationRead" ADD CONSTRAINT "AdminNotificationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNotificationRead" ADD CONSTRAINT "AdminNotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "AdminNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomepageCarouselProductCard" ADD CONSTRAINT "HomepageCarouselProductCard_slideId_fkey" FOREIGN KEY ("slideId") REFERENCES "HomepageCarouselSlide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomepageCarouselProductCard" ADD CONSTRAINT "HomepageCarouselProductCard_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingServiceMethod" ADD CONSTRAINT "ShippingServiceMethod_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ShippingProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreCreditWallet" ADD CONSTRAINT "StoreCreditWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreCreditTransaction" ADD CONSTRAINT "StoreCreditTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "StoreCreditWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

# Index inventory (from Prisma)

Declared secondary / unique indexes in `prisma/schema.prisma`. Primary keys (`id`) are additional.

Regenerate awareness: after schema changes, re-diff with Prisma and update this list if needed.

## User & auth

| Table | Indexes |
|-------|---------|
| User | unique `(email, portalScope)`; `email`, `portalScope`, `roleId`, `publicId`, `isActive`, `accessNumber`, `isGuest` |
| MembershipPayment | `userId`, `paidAt`, `stripeSessionId` |
| EmailVerificationToken | `userId`, `token` |
| PasswordResetToken | `userId`, `token` |
| Address | `userId` |
| RefreshToken | `userId` |

## Catalog

| Table | Indexes |
|-------|---------|
| Category | unique `(parentId, name)`, `(parentId, slug)`; `parentId` |
| Product | `categoryId`, `slug`, `publicId`, `isDraft`, `productType`, `sourceReturnId`, `sourceProductId`, `ageGroups` |
| ProductVariant | unique `(productId, sku)`; `productId` |
| InventoryAdjustment | `productId`, `productVariantId`, `userId`, `createdAt` |
| InventoryLedgerEvent | `(productId, createdAt)`, `productVariantId`, `(referenceType, referenceId)`, `eventType`, `createdAt` |
| ProductUnit | `productId`, `status`, `sourceReturnId` |
| ProductUnitEvent | `(unitId, createdAt)` |
| WishlistItem | unique `(userId, productId, productVariantId)`; `userId`, `productId` |
| StockAlertSubscription | unique `(userId, productId, productVariantId)`; `productId`, `userId` |

## Checkout & orders

| Table | Indexes |
|-------|---------|
| CheckoutIntent | `(userId, status)`, `checkoutSignature`, `createdAt` |
| CheckoutIntentLine | `checkoutIntentId`, `productId` |
| Order | `userId`, `status`, `fulfillmentStatus`, `publicId`, `orderNumber`, `paymentStatus`, `cancellationReviewStatus` |
| OrderItem | `orderId`, `productId`, `productVariantId`, `pickedByUserId`, `cancelledAt` |
| ShipmentTrackingEvent | `(orderId, createdAt)` |
| PickupListLine | unique `(pickupListId, orderId)`; `orderId` |

## Returns & credit

| Table | Indexes |
|-------|---------|
| ReturnRequest | `userId`, `orderId`, `status`, `submissionPublicId`, `returnNumber` |
| ReturnReceivePackage | unique `(submissionPublicId, packageNumber)`; `submissionPublicId` |
| ReturnReceivePackageLine | `packageId`, `returnRequestId` |
| ReturnStatusEvent | `(returnRequestId, createdAt)` |
| ReturnPackageRequest | `userId`, `orderId`, `returnRequestId`, `status` |
| ReturnEligibilityQuestionnaire | `autoDecision` |
| RefurbishmentJob | `status` |
| RefurbInspectionRecord | `returnRequestId`, `refurbishmentJobId` |
| StoreCreditTransaction | `walletId`, `type`, `orderPublicId` |

## Admin / CMS / infra

| Table | Indexes |
|-------|---------|
| AdminAuditLog | `(entityType, entityId)`, `createdAt` |
| AdminNotification | `(type, entityId)`, `module`, `createdAt` |
| AdminNotificationRead | unique `(userId, notificationId)`; `userId`, `notificationId` |
| HomepageCarouselSlide | `(isActive, sortOrder)`, `sortOrder` |
| HomepageCarouselProductCard | `(slideId, sortOrder)`, `productId` |
| ShippingProvider | `enabled`, `sortOrder` |
| ShippingServiceMethod | unique `(providerId, code)`; `providerId` |
| ShippingProviderLog | `(providerSlug, createdAt)`, `createdAt` |
| StripeWebhookEvent | `processedAt`, `status` |
| JobLease | `leaseExpiresAt` |

## Optimization notes for DBA

1. **Growers:** `InventoryLedgerEvent`, `AdminAuditLog`, `ShippingProviderLog`, `ShipmentTrackingEvent`, `StripeWebhookEvent`, `StoreCreditTransaction` — watch size + retention.
2. **Composite candidates (if EXPLAIN shows seq scans):** e.g. `Order(userId, createdAt)`, `ReturnRequest(userId, status)`, `Product(isDraft, productType)`.
3. **Array index:** `Product.ageGroups` is indexed in Prisma; confirm GIN vs btree matches query patterns in live Postgres.
4. Use `optimize-checklist.sql` section 4–7 against staging traffic before dropping/adding indexes.

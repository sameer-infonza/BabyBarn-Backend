# MyBABY BARN — schema overview (client)

PostgreSQL schema for the circular e-commerce platform (membership, catalog, orders, returns/refurb, store credit, admin).

**Counts (current):** 45 tables · 22 enums · ~167 indexes (incl. PK/unique)

Internal joins use numeric `id`. External/API identifiers use `publicId` (cuid) where applicable.

---

## 1. Identity & access

| Table | Role |
|-------|------|
| `Role` | RBAC role definitions |
| `User` | Customers, admin, team; portal scope; ACCESS membership fields |
| `Address` | Shipping/billing addresses (ACCESS ties a fixed ship address) |
| `EmailVerificationToken` | Email verify tokens |
| `PasswordResetToken` | Password reset tokens |
| `RefreshToken` | JWT refresh sessions |
| `MembershipPayment` | ACCESS purchase/renewal payment records (Stripe refs) |

**Key enums:** `PortalScope`, `AddressType`, `MembershipPaymentType`

---

## 2. Catalog & inventory

| Table | Role |
|-------|------|
| `Category` | Up to 4-level tree (`parentId`); name/slug unique per parent |
| `Product` | Catalog item; `productType` NEW / REFURBISHED; pricing tiers |
| `ProductVariant` | SKU/size/stock matrix per product |
| `InventoryAdjustment` | Manual stock adjustments (audit) |
| `InventoryLedgerEvent` | Reserve/release/commit/restock ledger |
| `ProductUnit` | Unit-level tracking for refurb pipeline |
| `ProductUnitEvent` | Unit lifecycle events |
| `WishlistItem` | Customer wishlist |
| `StockAlertSubscription` | Back-in-stock alerts |

**Key enums:** `ProductType`, `InventoryLedgerEventType`, `ProductUnitStatus`

---

## 3. Checkout & orders

| Table | Role |
|-------|------|
| `CheckoutIntent` | Pre-payment checkout session (guest + member) |
| `CheckoutIntentLine` | Lines on a checkout intent |
| `Order` | Order header (status, payment, fulfillment, shipping) |
| `OrderItem` | Line items with price snapshots |
| `ShipmentTrackingEvent` | Carrier tracking timeline |
| `PickupList` / `PickupListLine` | Warehouse pick batches |
| `ShippingSettings` | Platform shipping config singleton-style |
| `ShippingProvider` / `ShippingServiceMethod` | UPS (etc.) methods |
| `ShippingProviderLog` | Provider API logs |

**Key enums:** `OrderStatus`, `OrderPaymentStatus`, `OrderFulfillmentStatus`, `OrderItemPricingTier`, `CheckoutIntentStatus`, `CancellationReviewStatus`

---

## 4. Returns, refurbishment & store credit

| Table | Role |
|-------|------|
| `ReturnRequest` | Standard or REFURBISHMENT return |
| `ReturnStatusEvent` | Status history |
| `ReturnPackageRequest` | Return package / label requests |
| `ReturnReceivePackage` / `ReturnReceivePackageLine` | Inbound receive packages |
| `ReturnEligibilityQuestionnaire` | Eligibility Q&A / auto-decision |
| `RefurbishmentJob` | Refurb workflow job |
| `RefurbInspectionRecord` | Inspection outcomes / grades |
| `StoreCreditWallet` | Per-user store credit balance |
| `StoreCreditTransaction` | Earn / redeem / hold ledger |

**Key enums:** `ReturnType`, `ReturnStatus`, `RefurbishmentJobStatus`, `RefurbConditionGrade`, `StoreCreditTxnType`, …

---

## 5. Admin, CMS & platform

| Table | Role |
|-------|------|
| `AdminAuditLog` | Append-only admin/team actions |
| `AdminNotification` / `AdminNotificationRead` | In-app admin alerts |
| `BusinessSettings` | Platform business settings |
| `HomepageCarouselSlide` / `HomepageCarouselProductCard` | Marketing homepage carousel CMS |
| `StripeWebhookEvent` | Idempotent Stripe webhook processing |
| `JobLease` | Distributed job locks (reminders, etc.) |

---

## 6. Design conventions (for DBA review)

1. **Enums** for order/return/payment/product condition — not free-form status strings.
2. **Order line snapshots** preserve retail / ACCESS / applied prices at purchase time.
3. **Ledger-style tables** (`InventoryLedgerEvent`, `StoreCreditTransaction`, `AdminAuditLog`, status event tables) — prefer append; avoid hard-deleting history.
4. **Soft deactivation** preferred for users/categories when history exists.
5. **No PAN/CVV** stored — Stripe session/payment intent IDs only.
6. **New vs refurbished** are separate product/stock concepts (`ProductType`, separate SKUs/stock).

---

## 7. Related files

- Full DDL: [`schema-full.sql`](./schema-full.sql)
- Index list: [`indexes-inventory.md`](./indexes-inventory.md)
- Health SQL: [`optimize-checklist.sql`](./optimize-checklist.sql)
- Prisma source: `../../prisma/schema.prisma`

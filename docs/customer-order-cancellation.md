# Customer order cancellation

## Summary

Customers can cancel an order from **My Account → Order details** while the warehouse has **not** started processing it. Cancellation is immediate — no admin review queue for new requests.

## When cancellation is allowed

All of the following must be true:

| Check | Allowed | Blocked |
| --- | --- | --- |
| Order status | `PENDING`, `PROCESSING`, `CONFIRMED` | `CANCELLED`, `SHIPPED`, `DELIVERED`, `RETURNED`, `REFUNDED` |
| Delivery | Not delivered (`deliveredAt` is null) | Delivered |
| Fulfillment | `null` or `NEW_ORDER` | `ACCEPTED` and any later warehouse/carrier stage |
| Review state | No pending legacy review | `cancellationReviewStatus = PENDING` |

**Rule of thumb:** cancel is available until the warehouse **accepts** the order for picking/packing (`fulfillmentStatus` becomes `ACCEPTED`).

## When cancellation is blocked

Once any of these happen, the **Cancel Order** action is hidden and `PATCH /api/orders/:id/cancel` returns `400`:

- Warehouse accepts the order (`ACCEPTED`)
- Pick/pack or label generation begins (`PICKUP_READY`, `LABEL_GENERATED`)
- Shipment or delivery milestones (`SHIPPED` and later fulfillment stages, or order `status` is terminal)

## API

```
PATCH /api/orders/:id/cancel
Authorization: Bearer <customer JWT>
Body: { "reason": "optional string, max 500 chars" }
```

### Success responses

- **Unpaid order:** order `status` → `CANCELLED`; reserved inventory and store-credit holds are released.
- **Paid order (pre-warehouse):** Stripe refund for the order total; inventory restocked; redeemed store credit restored to the wallet; order `status` → `CANCELLED`, `paymentStatus` → `REFUNDED`.

### Error responses

| Code | When |
| --- | --- |
| `400` | Order is not eligible (warehouse started, delivered, already cancelled, etc.) |
| `403` | Order belongs to another customer |
| `404` | Order not found |
| `503` | Paid cancellation requested but Stripe is not configured |

## Customer UX

On the order detail page, if the order is **not delivered** and eligible, the returns column shows a **Cancel Order** card instead of return options.

Confirmation copy explains that cancellation is only available before warehouse processing begins.

## Legacy admin review

Older requests may still have `cancellationReviewStatus = PENDING` from a previous review-based flow. Admins can approve or reject those from the admin order console. Approval runs the same cancellation side effects (restock, refund when paid).

New customer cancellations do **not** create a pending review record.

## Implementation references

- Eligibility: `backend/lib/customer-order-cancellation.js`
- Cancel handler: `orderService.cancelOrderByUser()` in `backend/services/order.service.js`
- Customer UI: `customer-fe/lib/account/orders.ts` (`canCancelOrderOnline`), `OrderDetailView.tsx`

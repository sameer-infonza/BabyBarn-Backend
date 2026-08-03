# Customer order cancellation

## Summary

Customers can cancel an order from **My Account → Order details** for **60 minutes after payment**. Paid orders are **auto-accepted** into fulfillment (`fulfillmentStatus = ACCEPTED`) — there is no admin Accept step. Cancellation is immediate — no admin review queue for new requests.

## When cancellation is allowed

All of the following must be true:

| Check | Allowed | Blocked |
| --- | --- | --- |
| Order status | `PENDING`, `PROCESSING`, `CONFIRMED` | `CANCELLED`, `SHIPPED`, `DELIVERED`, `RETURNED`, `REFUNDED` |
| Delivery | Not delivered (`deliveredAt` is null) | Delivered |
| Time window | Within 60 minutes of `fulfillmentAcceptedAt` (set on payment) | Window expired |
| Fulfillment | `ACCEPTED` or legacy `NEW_ORDER` | `PICKUP_READY` and any later warehouse/carrier stage |
| Review state | No pending legacy review | `cancellationReviewStatus = PENDING` |

**Rule of thumb:** cancel is available for one hour after payment. The admin order list highlights rows still in that window so the warehouse does not pick/pack early.

## When cancellation is blocked

Once any of these happen, the **Cancel Order** action is hidden and `PATCH /api/orders/:id/cancel` returns `400`:

- 60-minute window expires
- Warehouse marks picked (`PICKUP_READY`) or later
- Shipment or delivery milestones

## API

```
PATCH /api/orders/:id/cancel
Authorization: Bearer <customer JWT>
Body: {
  "reason": "optional string, max 500 chars",
  "itemIds": ["optional order line publicIds — omit to cancel the whole order"]
}
```

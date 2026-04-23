# Shipping QA Scenarios

## Core flow
- Request checkout quote with valid US shipping address and verify multiple carrier/service rates are returned.
- Select non-cheapest rate, complete checkout, and verify order persists selected rate fields (`selectedRateId`, provider/service, amount/currency).
- Change address and retry with old `selectedRateId`; verify API returns `SHIPPING_RATE_STALE`.

## Admin outbound labels
- Open admin order detail and load outbound shipping options.
- Generate outbound label and verify order persists `shippingShipmentId`, `shippingTransactionId`, `shippingLabelUrl`, tracking number/carrier.
- Confirm outbound label link is shown on admin and customer order detail pages.

## Admin return labels
- Load return options and generate return label.
- Verify order persists `returnShipmentId`, `returnTransactionId`, `returnLabelUrl`, `returnTrackingNumber`, `returnShippingCarrier`.
- Confirm return label visibility on admin detail and customer detail/success pages.

## Tracking and webhooks
- Trigger tracking update via admin tracking patch and verify tracking snapshot fields are saved.
- Send Shippo `track_updated` webhook payload and verify status/timeline fields update; delivered status transitions order to `DELIVERED`.

## Country and carrier diagnostics
- Run `POST /shipping/debug-rate-check` in current mode; confirm both US and CA comparisons include rate count/cheapest/provider diagnostics.
- Validate warnings are present when one country fails or when no common carriers are available across US/CA.

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

## Admin shipping configuration (multi-provider)
- Sign in as an admin team member with **order-management** (includes **shipping** module) and open `/admin/shipping`.
- Toggle **default provider** between Shippo and UPS; save and confirm checkout quote uses only the default provider’s rates (not a merged list).
- Disable a Shippo service row (non-`*` code) and confirm that service disappears from checkout/admin rate lists after refresh.
- For UPS: set `SHIPPING_UPS_ENABLED=true`, store credentials via admin (or env bootstrap), run **Test UPS**; expect success or a clear credential/UPS API error without secrets in the response.
- Set `SHIPPING_UPS_ENABLED=false` and confirm UPS rates are not returned when UPS is the default (fallback or error per `preferProviderOnly`).

## Rate identity and labels
- New quotes emit prefixed `rateId` values (`bb:shippo:…`, `bb:ups:…`). Complete checkout with a new rate and confirm order `selectedRateId` matches.
- Legacy Shippo `rateId` values without a prefix still purchase labels when Shippo is enabled.
- UPS label purchase: until direct label APIs are wired, purchasing a UPS-selected rate should return a clear `UPS_LABEL_NOT_AVAILABLE` (or equivalent) error rather than a silent Shippo call.

## Regression (order detail + checkout)
- Customer `/orders/quote` JSON shape unchanged aside from optional rate fields (`providerSlug`, `externalRateId`, `serviceCode` where applicable).
- Pending order creation + Stripe checkout still resolves `selectedRateId` via `resolveSelectedRate`.
- Admin order outbound/return label flows still work for Shippo-backed rates.
- Shippo `track_updated` webhook still updates tracking for existing orders.

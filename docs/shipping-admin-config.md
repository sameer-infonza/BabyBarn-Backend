# Admin shipping configuration

This document describes how operators configure **multi-provider shipping** (Shippo and UPS in v1), where settings live, and how to roll back safely.

## Where configuration is stored

- **Database:** `ShippingProvider`, `ShippingServiceMethod`, and append-only `ShippingProviderLog` (see Prisma schema).
- **Secrets:** UPS client credentials entered in the admin UI are encrypted with **AES-256-GCM** using `SHIPPING_CREDENTIALS_MASTER_KEY` (base64-encoded 32-byte key). Environment variables remain a bootstrap/CI fallback when DB credentials are absent.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `SHIPPING_UPS_ENABLED` | When set to `false`, UPS rating is disabled at runtime even if the provider is enabled in the DB. |
| `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET` | Optional bootstrap credentials if not stored in the DB. |
| `UPS_ACCOUNT_NUMBER` | Optional shipper number used in rating/label calls when not stored in the DB. |
| `UPS_API_BASE_URL` | Optional override for UPS API host (see `ups.client.js`; defaults to UPS CIE). |
| `UPS_RATING_VERSION`, `UPS_TIMEOUT_MS` | Optional rating API version and HTTP timeout. |
| `SHIPPING_CREDENTIALS_MASTER_KEY` | Required to **store** UPS credentials from admin; generate with e.g. `openssl rand -base64 32`. |

Shippo continues to use `SHIPPO_API_KEY` and related `SHIPPO_*` variables as before.

## Admin UI

Path: **`/admin/shipping`** (requires console module **shipping**, granted to **order-management** team role alongside **orders**).

You can:

- Enable/disable each provider and set **exactly one** default provider (checkout uses the **default provider only** for rate quotes).
- Adjust provider display name and sort order.
- Enter or rotate UPS credentials (stored encrypted when `SHIPPING_CREDENTIALS_MASTER_KEY` is set).
- Toggle **service methods**: enabled/disabled, visible at checkout, visible in admin, sort order.
- View recent **provider logs** and run **Test UPS** (OAuth + rating smoke test; responses never include raw secrets).

## HTTP API (mounted under `/api/admin` and `/api/v1/admin`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/shipping/config` | Sanitized providers + services + `encryptionAvailable`. |
| `PUT` | `/shipping/config` | Update providers (enable, default, display, sort, optional UPS credentials). |
| `POST` | `/shipping/services` | Create a service method row. |
| `PATCH` | `/shipping/services/:publicId` | Update a service method. |
| `DELETE` | `/shipping/services/:publicId` | Delete a service method (avoid removing the last Shippo `*` pass-through row unless you intend to filter all Shippo services explicitly). |
| `GET` | `/shipping/logs` | Tail of `ShippingProviderLog`. |
| `POST` | `/shipping/test-ups` | UPS connection test. |

## Default provider and surfaces

| Surface | Provider selection | Service filtering |
|---------|-------------------|-------------------|
| Customer checkout quote | **Default provider only** | Methods with `enabled && visibleAtCheckout` |
| Admin shipping options | Request body `providerSlug` optional; else default | `enabled && visibleInAdmin` |
| Label purchase | Derived from `rateId` (see below) | Must align with enabled services where modeled |

## Rate IDs and backward compatibility

- **Prefixed:** `bb:shippo:<id>` and `bb:ups:<payload>` — used for new quotes so the orchestrator can route label purchase.
- **Legacy:** Bare Shippo object IDs are still treated as Shippo when that provider is enabled.

If a legacy rate is stale or the provider was disabled, refresh rates on the order and pick a new option.

## Rollback

1. Set **default provider** back to **Shippo** in `/admin/shipping` and save.
2. Optionally disable **UPS** in the same UI.
3. Set `SHIPPING_UPS_ENABLED=false` in the deployment environment to hard-stop UPS at the edge.
4. No destructive migration is required; existing `Order` shipping fields remain the source of truth.

## UPS labels (v1 scope)

US domestic **rating** and admin **test connection** are implemented against UPS APIs. **Label purchase** via direct UPS is still stubbed (`UPS_LABEL_NOT_AVAILABLE`); use Shippo-backed rates for production labels until that path is completed.

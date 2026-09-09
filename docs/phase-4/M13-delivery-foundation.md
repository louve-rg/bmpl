# Phase 4 · M13 — Delivery & Shipping Foundation

> **📅 Dated milestone design note (banner added 2026-09-09).** The "no delivery
> execution" scope statement below describes what M13 itself built, not the
> product today: dispatch and delivery execution (M15), driver earnings and
> settlement (M18), multimodal shipping, and passenger transportation have all
> shipped since. Current state: [`PROJECT_STATUS.md`](../PROJECT_STATUS.md);
> how a parcel moves today: [`DELIVERY-LIFECYCLE.md`](../DELIVERY-LIFECYCLE.md).

Establishes the **data model, pricing engine, checkout integration, and vendor
delivery settings** for logistics. It stores delivery information only — there is
**no delivery execution**: no driver applications/dashboard/assignment, no
dispatch, live tracking, GPS, map-based ETA, route optimization, driver
earnings/wallets, passenger transport, payouts, or settlement.

Related: [architecture](../ARCHITECTURE.md) · [DB schema](../phase-2/DATABASE-SCHEMA.md) ·
[OpenAPI](../openapi/marketplace.yaml) · builds on M10 checkout/orders.

## 1. Architecture decisions
- **Reuse, don't duplicate.** Fulfilment method already lived on `VendorOrder.deliveryMethod`
  (`PICKUP`/`DELIVERY`); the customer address snapshot already lived on `OrderAddress`
  (type `SHIPPING`); pickup/delivery toggles + minimum-order + radius already lived on
  `VendorSettings`. M13 adds only what was missing: delivery **pricing** config and a
  per-delivery-order **snapshot**.
- **Delivery is per vendor-order.** Each storefront in a multi-vendor order is fulfilled
  independently (its own method + fee + estimate + status). The delivery **address** is
  order-level (one `OrderAddress`, shared by all delivery vendor-orders).
- **Pricing engine is pure fee resolution.** Zone match → base flat fee → free-delivery
  threshold. No routing/geocoding/ETA-from-maps. Extensible behind one interface.
- **Total now includes delivery.** `Order.totalMinor = subtotalMinor + deliveryFeeMinor`.
  The M11/M12 payment/hold foundation authorizes this total (customer↔escrow only — no
  change to payment behavior, no payouts).

## 2. Data model (new)
| Model | Purpose |
|-------|---------|
| `DeliveryZone` | A vendor's named area = a set of `District`s (enum array). |
| `DeliveryRate` | 1:1 with a zone — the zone's flat delivery fee (`feeMinor`). |
| `DeliveryEstimate` | 1:1 with a vendor — estimated delivery window (`minHours`/`maxHours`/`label`). |
| `OrderDelivery` | 1:1 with a **delivery** `VendorOrder` — snapshot: `status` (`PENDING_ASSIGNMENT`), `feeMinor`, `freeApplied`, estimate, `instructions`, `appliedZoneId`. |
| enum `DeliveryStatus` | `PENDING_ASSIGNMENT` only (initial status; no later states in M13). |

Extended: `VendorSettings.baseDeliveryFeeMinor`, `VendorSettings.freeDeliveryThresholdMinor`;
`Order.deliveryFeeMinor`. Migration: `20260731130000_delivery_shipping_foundation` (additive).

## 3. Vendor settings
`pickupEnabled`, `deliveryEnabled` (existing); `baseDeliveryFeeMinor` (flat fallback fee),
`freeDeliveryThresholdMinor`, `minimumOrderMinor` (existing), `deliveryRadiusKm` (existing,
informational); **zones** (name + districts + fee via `DeliveryRate`); **estimate**
(`DeliveryEstimate`). A district maps to at most one active zone per vendor (enforced).

## 4. Delivery pricing engine (`DeliveryPricingService.quote`)
Inputs: `vendorProfileId`, destination `District`, vendor `subtotalMinor`. Steps:
1. `deliveryEnabled` false → **not deliverable** (`PICKUP_ONLY`).
2. `minimumOrderMinor` set and subtotal below it → **not deliverable** (`BELOW_MINIMUM`).
3. active zone covering the district → its `DeliveryRate.feeMinor` (else base flat fee;
   else **not deliverable** `DISTRICT_NOT_SERVED`).
4. `freeDeliveryThresholdMinor` met → fee `0`, `freeApplied = true`.
Returns `{ deliverable, reason?, feeMinor, freeApplied, appliedZoneId, estimate }`.

## 5. Checkout integration
Per delivery vendor-order at checkout: validate the method is offered (pickup/delivery),
`quote()` the fee, reject if not deliverable, create `OrderDelivery` (fee/estimate/
instructions/`PENDING_ASSIGNMENT`), and accumulate `Order.deliveryFeeMinor`. Pickup stores
the method only. A delivery address is required when any vendor uses delivery; the address
is snapshotted to `OrderAddress`. `deliveryInstructions` (per delivery vendor) are captured.

## 6. Order data
Delivery orders store: **address snapshot** (`OrderAddress`), **delivery fee**
(`OrderDelivery.feeMinor` + `Order.deliveryFeeMinor`), **estimate**, **instructions**,
**fulfilment method** (`VendorOrder.deliveryMethod`), **delivery status**
(`OrderDelivery.status = PENDING_ASSIGNMENT`). Serializers expose these to customer, vendor,
and admin order views.

## 7. API (reuses existing cookie auth + role guards)
| Method & path | Role | Purpose |
|---|---|---|
| `GET /api/vendor/delivery` | VENDOR | settings + zones (+fees) + estimate |
| `PATCH /api/vendor/settings` | VENDOR | pickup/delivery + base fee + free threshold + min + radius |
| `POST /api/vendor/delivery/zones` | VENDOR | create zone (`name, districts[], feeMinor, isActive`) |
| `PATCH /api/vendor/delivery/zones/:id` | VENDOR | update zone |
| `DELETE /api/vendor/delivery/zones/:id` | VENDOR | remove zone |
| `PUT /api/vendor/delivery/estimate` | VENDOR | upsert estimate (`minHours, maxHours, label?`) |
| `POST /api/checkout/delivery-quote` | CUSTOMER | pre-checkout per-vendor fee + estimate + totals for the cart |
| `POST /api/checkout` | CUSTOMER | (extended) prices + snapshots delivery |
| order reads (customer/vendor/admin) | — | (extended) delivery fee/estimate/status/address |

## 8. Web
- **Checkout**: per-vendor fulfilment + live quote (Subtotal / Delivery / Total), delivery
  instructions, undeliverable warnings.
- **Vendor**: `/dashboard/delivery` — settings, zones (+fees), estimate. Vendor dashboard
  orders show method / delivery fee / delivery status (read-only).
- **Customer**: order detail shows method, address, fee, estimate, status.
- **Admin**: order detail shows delivery orders, fees, addresses, status (read-only).

## 9. Not in scope (M14+)
Driver management, dispatch/assignment, tracking/GPS/ETA, route optimization, driver
earnings/wallets, passenger transport, payouts, settlement, refunds. `OrderDelivery.status`
intentionally has no states beyond `PENDING_ASSIGNMENT`.

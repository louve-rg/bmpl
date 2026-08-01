# Phase 4 · M22 — Analytics & Reporting

Read-only business intelligence over the data the platform already produces: a
platform-wide **admin analytics** dashboard and a vendor's **own-storefront**
analytics, plus CSV **report exports**. Pure aggregation — **no schema change, no
migration**, no money movement, no mutation of any order/payment/settlement state.

**Out of scope (deferred):** AI/ML forecasting, custom report builders, scheduled/
emailed reports, data-warehouse export, driver-facing analytics beyond the existing
M18 earnings views, and any cross-vendor data exposure.

Related: [M18 settlement](../phase-3/M18-settlement-earnings.md) (revenue source of
truth) · [M11/M12 payments](../phase-3/M11-payments-wallet.md) (GMV source) ·
[permission matrix](../phase-2/PERMISSION-MATRIX.md) · [OpenAPI](../openapi/marketplace.yaml).

## 1. Money semantics (what counts, and from where)
- **GMV** = sum of `Payment.amountMinor` for payments in `AUTHORIZED / SETTLING /
  SETTLED` (collected money only — `PENDING/CREATED/FAILED/CANCELLED/EXPIRED`
  excluded). `Payment.amountMinor == Order.totalMinor`.
- **Realized platform revenue** = `Σ (commissionMinor + platformFeeMinor)` over
  **POSTED** `VendorSettlement` rows (never estimated from open orders).
- **Vendor net revenue** = `Σ VendorSettlement.netMinor` (POSTED), scoped to the
  vendor. **Commission paid** = `Σ commissionMinor` (POSTED).
- **Units sold** = `Σ OrderItem.quantity` for items whose order has a paid payment.

Because prod has never processed a real settled order, every figure is honestly `0`
in production until real, funded transactions occur — no synthetic data.

## 2. Admin analytics (`analytics.read`)
New permission **`analytics.read`** — granted to `ADMIN` + `SUPER_ADMIN` only (NOT
`SUPPORT_AGENT`; revenue is sensitive). Endpoints under `/admin/analytics`:

| Endpoint | Returns |
|---|---|
| `GET /overview` | GMV, paid/total/cancelled orders, AOV, units sold, platform revenue, vendor net, settled gross, approved vendors/drivers, total customers, published products, review count + avg rating |
| `GET /sales?days=` | daily time-series `{ date, orders, grossMinor }`, gap-filled to a continuous window (clamped 1–365 days) |
| `GET /top-products?limit=` | best sellers `{ productId, title, unitsSold, revenueMinor }` |
| `GET /top-vendors?limit=` | top stores `{ vendorProfileId, businessName, orders, revenueMinor }` |
| `GET /reports/orders.csv` | orders CSV export (RFC-4180 quoted; `text/csv` attachment) |

## 3. Vendor analytics (own store, ownership-scoped)
Endpoints under `/vendor/analytics` (`@Roles('VENDOR')`), resolved through
`OwnershipService.vendorProfileId` — a vendor can only ever see **their own** numbers;
another vendor's data is never returned:

| Endpoint | Returns |
|---|---|
| `GET /overview` | paid orders, gross sales, units sold, net revenue, commission paid, settled gross, pending settlements, published products, rating |
| `GET /sales?days=` | own daily sales time-series |
| `GET /top-products?limit=` | own best sellers |
| `GET /reports/orders.csv` | own vendor-orders CSV export |

## 4. Frontend
- **Admin** — `/dashboard/analytics`: KPI cards, a dependency-free inline bar chart
  (range 7/30/90 days), top-products + top-vendors tables, and a "Download orders CSV"
  export. Gated UI: a read-only admin without `analytics.read` sees a clear message.
- **Vendor** — `/dashboard/analytics`: own KPI cards, sales chart, top products, and a
  "Download my orders CSV" export.

## 5. Guarantees & invariants
- **Read-only** — no schema/migration; analytics never mutates orders, payments,
  settlements, inventory, or wallet balances.
- **Honest money** — GMV from collected payments only; realized revenue from POSTED
  settlements only; zeros until real transactions exist (no synthetic figures).
- **Least privilege** — admin analytics behind `analytics.read` (excludes support);
  vendor analytics strictly own-store via ownership resolution.
- **Safe CSV** — RFC-4180 field quoting prevents CSV injection/formula breakout.

## 6. Tests
`apps/api/test/analytics.integration.spec.ts` (8 tests): admin overview aggregation
(GMV, platform revenue, units, AOV) from seeded paid+POSTED-settled orders; sales
time-series shape + today's totals; top-products/top-vendors ranking; CSV content-type
+ header + header row; `analytics.read` gating (customer 403, guest 401, limited admin
without the permission 403); vendor own-overview (gross/net/commission) with
cross-vendor isolation (other vendor sees zeros); vendor top-products + CSV; non-vendor
rejection. Full suite: **327 API integration tests green**.

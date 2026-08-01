# Phase 3 · M18 — Driver Earnings, Escrow Release & Vendor Settlement

Completes the INTERNAL financial lifecycle after a delivered order: escrow is
distributed to the vendor, the driver, and the platform. **No external withdrawal,
bank payout, refund, or chargeback** — funds move only between internal wallet
accounts on the double-entry ledger.

## 1. Architecture
- **One money path.** All ledger transactions go through the existing
  `WalletService.postTransaction` (the sole poster), which enforces
  `assertBalanced` (net-zero) and the per-call money-movement gate. Settlement
  controllers never write ledger entries directly.
- **Trigger.** `SettlementService.settleVendorOrder(vendorOrderId)` runs after a
  delivery reaches `DELIVERED` (best-effort call from dispatch `confirmDelivery`,
  after its transaction). It is a separate atomic transaction; a failure never
  reverts the delivery — it records a FAILED settlement exception and alerts admins,
  leaving escrow untouched.
- **Fee engine.** `@bmpl/shared` `computeSettlement` is the single, pure, tested
  source of truth for the split. The rates live in one server-side `PlatformFeeConfig`
  row (admin-configurable) — never scattered across controllers/UI.

## 2. Financial accounts (all internal, derived balances)
`SYSTEM_ESCROW` (holds authorized customer funds), `SYSTEM_PLATFORM_FEES` (platform
revenue), `SYSTEM_TOPUP_CLEARING`, and each user's `USER` wallet (vendor & driver
pending/earned balances). Balances are always derived from ledger entries;
`cachedBalanceMinor` is only a verified cache.

## 3. Models
`PlatformFeeConfig` (commissionBps, driverEarningMethod, driverFlatMinor,
driverDeliveryFeeBps — one active row). `VendorSettlement` (per vendor-order, unique:
merchandise subtotal, delivery fee, commission, driver allocation, platform fee,
gross, net, status PENDING→POSTED/FAILED, immutable `snapshot`, walletTransactionId,
calculated/postedAt). `DriverEarning` (per delivery, unique: method, gross,
adjustments [future-ready, 0 in M18], net, status, immutable `snapshot`). Historical
records are never modified when the fee config later changes (each snapshots the
config + inputs used).

## 4. Fee engine & earnings calculation
`gross = merchandise subtotal + delivery fee`.
`commission = subtotal × commissionBps` (default **10%**, capped ≤ subtotal).
`driverAllocation` (delivery only) by method — FLAT (`driverFlatMinor`),
PERCENT_DELIVERY_FEE (`fee × driverDeliveryFeeBps`, default **80%**), HYBRID (flat +
percent) — **capped at the delivery fee** so the platform share is ≥ 0.
`platformRevenue = commission + (deliveryFee − driverAllocation)`.
`vendorNet = subtotal − commission`. **Invariant (exact, no rounding drift):**
`vendorNet + driverAllocation + platformRevenue ≡ gross` (commission and driver
allocation cancel algebraically) — so the ledger always balances.

> **Default rates are engineering defaults for the configurable engine and should be
> confirmed by the platform operator** (commission 10%, driver 80% of delivery fee).

## 5. Ledger postings (per settled vendor-order)
One balanced `ESCROW_RELEASE` transaction, reference `settlement:<vendorOrderId>:v1`:
DEBIT `SYSTEM_ESCROW` (gross); CREDIT vendor USER wallet (net), driver USER wallet
(earning), `SYSTEM_PLATFORM_FEES` (platform revenue). Zero-amount credits are skipped
(the non-zero lines still sum to gross). In-transaction escrow-balance check rejects
if escrow underfunded.

## 6. State transitions
Payment: `AUTHORIZED → SETTLING` (some vendor-orders settled) `→ SETTLED` (all
delivery vendor-orders settled). VendorSettlement: `PENDING → POSTED` (atomic with
the ledger) / `→ FAILED` (exception). DriverEarning: `PENDING → POSTED`. No
capture/refund/withdrawal states. Only DELIVERY vendor-orders settle (a delivered
`OrderDelivery`); **PICKUP has no fulfilment-completion signal today — see §11.**

## 7. Idempotency & atomicity
The whole settlement is one `$transaction`. Idempotency is guaranteed by (a) the
unique `WalletTransaction.reference` (`settlement:<vo>:v1` → P2002 on replay, caught
and treated as idempotent) and (b) the unique `VendorSettlement.vendorOrderId`.
Repeated triggers/retries never double-release escrow or double-credit anyone. On any
error the transaction rolls back — **no partial entries**, escrow preserved — and a
FAILED settlement + `SETTLEMENT_FAILED` audit + admin alert are written.

## 8. Multi-vendor orders
Each vendor-order settles independently (its own `subtotal + deliveryFee` slice of
escrow). A completed vendor-order never releases another incomplete one's funds; the
parent payment aggregates to `SETTLING`/`SETTLED` safely.

## 9. API
Customer: `GET /orders/:id/settlement`. Vendor (`/vendor/settlements`): list + detail
(gross/fees/net + snapshot). Driver (`/driver/earnings`): list + detail (pending/posted
totals). Admin (`/admin/settlements`, `settlements.read`): list, detail, driver-earnings,
exceptions, `/reconciliation`, `/accounts`, `/fee-config`; `settlements.manage` — PATCH
`/fee-config`, `POST /vendor-order/:id/retry`. **No manual balance/ledger edit, no
withdrawal, no external payout, no refund** anywhere.

## 10. Reconciliation, notifications, audit
Reconciliation exposes escrow balance, platform revenue, pending vendor/driver
liabilities, and the **global ledger net** with a `balanced` flag — a mismatch is
surfaced, never hidden. Notifications (M16): vendor settled, driver earning credited,
admin settlement-failure alert. Audit: settlement calculated/posted/failed, escrow
released, vendor/driver/platform postings, payment settling/settled, wallet transaction
posted, fee-config updated.

## 11. Permissions & remaining limitations
Permissions `settlements.read` (SUPPORT_AGENT+ADMIN+SUPER_ADMIN) and `settlements.manage`
(ADMIN+SUPER_ADMIN), synced on boot. **Limitations:** PICKUP vendor-orders cannot be
settled (no pickup-completion state exists — a future "mark fulfilled" workflow is
needed); driver tips/bonuses/penalties are future-ready fields (always 0); no external
payout/withdrawal by design.

## 12. Migrations
`20260805120000_settlement_enums` (PaymentStatus SETTLING/SETTLED; 10 AuditAction
values — isolated) and `20260805121000_settlement` (`DriverEarningMethod`,
`SettlementStatus` enums; `platform_fee_configs`, `vendor_settlements`,
`driver_earnings` tables). Additive; applied via Railway preDeploy.

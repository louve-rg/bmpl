# Phase 4 · M15 — Dispatch & Delivery Execution

Connects **eligible approved drivers** to delivery orders and runs the operational
delivery lifecycle from assignment through completion. Builds directly on
[M13 delivery pricing](./M13-delivery-foundation.md) (which created `OrderDelivery`
in `PENDING_ASSIGNMENT`) and [M14 driver management](./M14-driver-management.md)
(approved drivers, vehicles, service areas, availability).

**Out of scope (deferred):** live GPS tracking, background location, route
optimization, map-based ETA, passenger transport, driver earnings, driver wallet
credits, vendor payouts, settlement, refunds, messaging, reviews, disputes, jobs,
real estate, marketing.

Related: [permission matrix](../phase-2/PERMISSION-MATRIX.md) ·
[route inventory](../phase-2/ROUTE-INVENTORY.md) · [architecture](../ARCHITECTURE.md).

## 1. Architecture decisions
- **One strict state machine, single source of truth.** `@bmpl/shared`
  `DELIVERY_ACTIONS` defines every legal `(from → to)` edge and the actor allowed
  to perform it. The API enforces it (validate state → validate actor/ownership →
  apply); the web/admin/driver UIs read the same map. No status is ever set ad hoc.
- **Reuse, don't duplicate.** Driver *assignment eligibility* lives in
  `DriverService` (extending the M14 vehicle/licence checks with availability +
  service-district), reused by both the single-assign check and the eligible-driver
  pool. Inventory, notifications, audit, private R2 storage, and permission-sync are
  all the existing services.
- **Denormalized current state + append-only history.** The *current* assignment is
  denormalized onto `OrderDelivery` for fast reads; every assignment attempt is an
  immutable `DeliveryAssignment` row and every transition an immutable
  `DeliveryTimelineEvent`. History is never overwritten or deleted.
- **No money moves.** Nothing in the dispatch lifecycle writes a `WalletLedgerEntry`
  / `WalletTransaction`, changes a balance, or settles a vendor. Payment stays in
  its existing state. The only "counter" touched is the driver's
  `completedDeliveries` placeholder metric.

## 2. Delivery state machine
Statuses: `PENDING_ASSIGNMENT → ASSIGNED → DRIVER_ACCEPTED → PICKUP_CONFIRMED →
IN_TRANSIT → ARRIVING → DELIVERED`, plus `DRIVER_DECLINED`, `CANCELLED`.

| Action | Actor | From | To |
|---|---|---|---|
| ASSIGN | admin | PENDING_ASSIGNMENT | ASSIGNED |
| REASSIGN | admin | ASSIGNED, DRIVER_ACCEPTED, DRIVER_DECLINED | ASSIGNED |
| ACCEPT | driver | ASSIGNED | DRIVER_ACCEPTED |
| DECLINE | driver | ASSIGNED | DRIVER_DECLINED |
| CONFIRM_PICKUP | driver | DRIVER_ACCEPTED | PICKUP_CONFIRMED |
| IN_TRANSIT | driver | PICKUP_CONFIRMED | IN_TRANSIT |
| ARRIVING | driver | IN_TRANSIT | ARRIVING |
| DELIVER | driver | ARRIVING | DELIVERED |
| CANCEL | admin | PENDING_ASSIGNMENT, ASSIGNED, DRIVER_ACCEPTED, DRIVER_DECLINED | CANCELLED |

**Cancellation is allowed only before pickup.** Once `PICKUP_CONFIRMED` the goods
are with the driver and inventory is finalized; reversing that requires refunds /
settlement, which are out of M15 scope. `DELIVERED` and `CANCELLED` are terminal.
Every transition validates current state + acting role + ownership/assignment,
is idempotent where safe (repeating the current state is a no-op — see §10), writes
an append-only timeline event, an audit row, and an in-app notification, and leaves
order/payment records intact. Illegal transitions return a clear `400`.

## 3. Assignment model
`OrderDelivery` (extended) holds the current assignment (driver, vehicle, assigning
admin, all lifecycle timestamps, decline/reassignment/cancellation reasons, delivery
notes, pickup/delivery verification state, proof-of-delivery keys, and an
`inventoryFinalizedAt` guard). `DeliveryAssignment` is the **append-only history**:
one row per attempt with `status` (ACTIVE/ACCEPTED/DECLINED/REASSIGNED/CANCELLED/
COMPLETED), timestamps, and reasons. Reassignment ends the current row
(`REASSIGNED`) and creates a fresh `ACTIVE` row — prior rows are preserved.

## 4. Driver eligibility (re-checked at assignment time)
A driver may be assigned only if: the `DELIVERY_DRIVER` role is **APPROVED**, the
profile is **active**, availability is **ONLINE**, the licence is valid, they serve
the delivery's **district**, and the chosen vehicle is **APPROVED + active** with
valid registration **and** insurance. Eligibility is re-evaluated at assignment (and
reassignment) time, not just when the pool was listed. If the assigned driver
becomes ineligible before acceptance, the admin detail surfaces
`currentDriverEligibility.reasons`, and the driver's own guard (APPROVED role) blocks
acting if suspended/revoked — the resolution is reassignment.

## 5. Admin dispatch workflow
`deliveries.read` — list/filter deliveries, view detail, timeline, assignment
history. `deliveries.assign` — view eligible drivers + assign/reassign (reassign
requires a reason). `deliveries.manage` — cancel (reason required). `deliveries.verify`
— reveal PINs / override. `proof_of_delivery.read` — view POD. **No automatic
matching:** an `auto-assign-preview` endpoint exists but only counts candidates and
never assigns. Vendors cannot assign.

## 6. Driver job workflow
Requires an APPROVED `DELIVERY_DRIVER` role (guard). A driver sees only jobs assigned
to their own profile (others → `404`). Flow: view assigned job → accept / decline
(reason) → confirm pickup (PIN) → in-transit → arriving → confirm delivery (PIN +
recipient name + optional notes/POD). Completed jobs are listed separately.

## 7. Pickup verification
A numeric pickup PIN is generated per assignment and held by the **vendor** (revealed
via `GET /vendor/deliveries/:id/pickup-pin`, and to admins via the reveal endpoint).
The **driver submits** it at hand-off (`confirm-pickup`). Wrong attempts increment a
counter and are audited (`DELIVERY_PICKUP_PIN_FAILED`); after
`DELIVERY_PIN_MAX_ATTEMPTS` (5) the code locks (`FAILED`) and an admin must verify.
Submit endpoints are additionally `StrictThrottle`-rate-limited per IP. Repeating
after success is idempotent.

## 8. Delivery verification
A numeric delivery PIN is generated per assignment and held by the **customer**
(revealed via `GET /deliveries/:id/pin`). The driver submits it at the door with the
recipient name (required) to reach `DELIVERED`. Same attempt-cap + throttle +
idempotency + audit (`DELIVERY_DELIVERY_PIN_FAILED`) as pickup.

**PIN policy.** Each counterparty must be able to *view* their code, so PINs are
stored server-side and revealed **only** through dedicated, role/ownership-checked
endpoints — never in general delivery payloads, driver payloads, public APIs, or
logs. Submission is compared in constant time. (Envelope-encryption of the stored
codes is a noted future hardening step.)

## 9. Proof of delivery
Optional POD photos upload to the **private** R2 bucket via a presigned PUT
(`driver/jobs/:id/pod/presign` → direct PUT → keys passed to `confirm-delivery`, or
`pod/confirm` before completion). Keys are namespace- + MIME- + size-validated and
owner-scoped (`deliveries/proof/<driverUserId>`). POD is viewable only via
short-lived signed URLs by the authorized customer, vendor, driver, and admin
(`proof_of_delivery.read`) — never public. A `signatureKey` column is reserved
(no capture UI in M15).

## 10. Inventory finalization point
Inventory stays **reserved** (M10 reserved it at checkout) through assignment and
acceptance. At **`PICKUP_CONFIRMED`** the reservation is converted to a real
deduction: `InventoryService.finalizeReservation` decrements both on-hand
`quantity` and `reserved` and writes an append-only `FULFILLED` `InventoryChange`.
This is **exactly-once**, guarded by `OrderDelivery.inventoryFinalizedAt`, so a
repeated (idempotent) pickup confirmation never double-deducts. Untracked/unlimited
rows are skipped. Payment settlement is unchanged; vendor balances do not move.

## 11. Customer experience
Track own deliveries: status + timeline, assigned driver **display name** + vehicle
summary, pickup/in-transit/arriving/delivered milestones, proof of delivery, recipient
confirmation, and the delivery PIN reveal. Private driver documents and emergency
contact are never exposed. A "contact support" placeholder is present.

## 12. Vendor experience
For their own vendor-orders: assigned driver + vehicle, delivery status/progress, the
pickup-PIN reveal to hand the driver at pickup, and proof of delivery. Vendors have no
assignment controls.

## 13. Permissions
Added `deliveries.read`, `deliveries.assign`, `deliveries.manage`, `deliveries.verify`,
`proof_of_delivery.read`. ADMIN bundle gets all five; SUPPORT_AGENT gets
`deliveries.read` + `proof_of_delivery.read` (read-only); SUPER_ADMIN spreads all.
Synced on boot via the existing `syncSuperAdminPermissions`.

## 14. Notifications
In-app notifications (existing system, type `MARKETPLACE`) fire to the relevant
audiences: assigned/reassigned/cancelled → driver + customer + vendor; accepted →
customer + vendor; declined → the assigning admin + vendor; pickup confirmed →
customer + vendor; in-transit / arriving → customer; delivered → customer + vendor;
proof available → customer. No email/SMS/push orchestration is added.

## 15. API inventory
**Admin** (`/admin/deliveries`): `GET /` (filter), `GET /:id`, `GET /:id/timeline`,
`GET /:id/history`, `GET /:id/eligible-drivers`, `GET /:id/auto-assign-preview`,
`GET /:id/proof`, `GET /:id/pins`, `POST /:id/assign`, `POST /:id/reassign`,
`POST /:id/cancel`.
**Driver** (`/driver/jobs`): `GET /` (scope), `GET /:id`, `POST /:id/accept`,
`POST /:id/decline`, `POST /:id/confirm-pickup`, `POST /:id/in-transit`,
`POST /:id/arriving`, `POST /:id/confirm-delivery`, `POST /:id/pod/presign`,
`POST /:id/pod/confirm`.
**Customer** (`/deliveries`): `GET /:id`, `GET /:id/pin`, `GET /:id/proof`.
**Vendor** (`/vendor/deliveries`): `GET /`, `GET /:id`, `GET /:id/pickup-pin`,
`GET /:id/proof`.
All: Zod validation, role/permission guards, ownership checks, transactions, audit,
notifications, private signed URLs, and rate-limited PIN/upload endpoints.

## 16. Security rules (verified by tests)
Driver cannot access another driver's job (`404`); customer/vendor cannot access
another party's delivery (`404`); pending/suspended driver cannot act (guard);
ineligible driver cannot be assigned (district/vehicle/document/availability
re-check); PINs never leak into general payloads/logs and are attempt-capped +
throttled; POD files stay private; direct out-of-order transitions fail (`400`);
duplicate transitions never double-deduct inventory; no wallet/vendor-balance
movement and no payment settlement occur.

## 17. Phase 5 mobile handoff
All driver-job and transition APIs use shared `@bmpl/validation` schemas + shared
status enums (`@bmpl/shared` `DELIVERY_ACTIONS`/`DELIVERY_STATUSES`), are cookie-
authed with mobile-friendly JSON payloads, and are idempotent where safe. This is the
contract for the Phase 5 driver mobile app. No background location, navigation, or
push in M15.

## 18. Deferred GPS / tracking scope
No live GPS, background location, route optimization, or map ETA. Live tracking would
build on the timeline + (future) driver location pings; navigation/ETA would integrate
a maps provider — both explicitly out of M15.

## 19. Migrations
`20260801120000_dispatch_delivery_enums` (enum `ADD VALUE`: `DeliveryStatus` ×8,
`InventoryChangeReason` FULFILLED, `AuditAction` ×13 — isolated because Postgres
forbids using a new enum value in the same transaction that adds it) and
`20260801121000_dispatch_delivery` (new types `DeliveryAssignmentStatus` +
`VerificationStatus`, `OrderDelivery` columns, `DeliveryAssignment` +
`DeliveryTimelineEvent` tables, indexes, FKs). Additive; applied via Railway
preDeploy `prisma migrate deploy`.

## 20. Web / admin surfaces
Admin `/dashboard/dispatch` (+ `[id]`) — the dispatch console. Web
`/dashboard/driver/jobs` (+ `[id]`) — the driver job feed. Customer delivery tracking
on the order detail; vendor delivery panel on the vendor order view.

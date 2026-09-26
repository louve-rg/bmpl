# Automatic Dispatch & Delivery Workflow (M26.3)

How a delivery order gets from checkout to a customer's door without an
administrator touching it.

## The problem this replaced

Before M26.3 the delivery path dead-ended twice:

- **The vendor had no action.** `VendorOrderStatus` went straight from `PENDING`
  to a pickup-only `READY_FOR_PICKUP`, and `vendor-orders.controller` exposed two
  routes, both pickup-only. A vendor who received a DELIVERY order could do
  nothing with it.
- **Nothing dispatched.** `DispatchService.autoAssignPreview` was an explicit stub
  returning `implemented: false`. Every delivery waited in `PENDING_ASSIGNMENT`
  for a human to assign it.

These were one dead end, not two bugs.

## The flow

```
customer checkout
  └─ VendorOrder PENDING, OrderDelivery PENDING_ASSIGNMENT
vendor: "Start preparing"        → PREPARING          (preparingAt set)
vendor: "Mark ready for driver"  → READY_FOR_PICKUP   (readyForDispatchAt set)
  └─ DispatchEngineService.dispatch()
       ├─ rank eligible drivers        → offer to the best one
       ├─ no response before timeout   → sweeper rolls to the next driver
       ├─ declined                     → re-offered immediately
       └─ retry budget spent           → admin alerted (the only manual case)
driver: accept → pickup (PIN) → in transit → arriving → delivered (PIN)
  └─ settlement, earnings, analytics, notifications, audit — all unchanged
```

`READY_FOR_PICKUP` is reused unchanged for delivery orders, where it means ready
for the *driver* to collect. Same physical fact, so it needs no new state.

## Who owns what

The engine deliberately owns **no business rules**:

| Concern | Owner |
|---|---|
| Is this driver allowed to take this job? | `DriverService.assignmentEligibility` |
| Who is in the pool for a district? | `DriverService.eligibleDriversForDistrict` |
| Which candidate is best? | `@bmpl/shared/dispatch-ranking` (pure) |
| Writing the assignment | `DispatchService.systemAssign` → `assignInternal` |
| Deciding *who* and *when* | `DispatchEngineService` |

`systemAssign` is a thin entry into the **same** `assignInternal` an admin uses,
so automatic and manual assignment produce identical state — the same
assignment-time eligibility re-check, fresh PINs, append-only
`DeliveryAssignment` history, timeline event, audit row, notifications and
messaging. A null `assignedByUserId` is what marks a system decision.

## Ranking

Pure, no I/O, `now` passed in — testable without a database
(`packages/shared/src/dispatch-ranking.ts`).

| Component | Default weight | Why |
|---|---|---|
| Workload | 40 | Fewer active jobs first |
| Fairness | 30 | Longer since last offer first |
| Rating | 15 | Tie-breaker between equally free drivers |
| Locality | 10 | Home district matches destination |
| Experience | 5 | Lightly, and capped |

**Fairness and workload outweigh rating and experience combined, deliberately.**
Rank primarily on rating and the best-rated driver in a district takes every job
while everyone else starves — which drives them offline and makes the pool worse.

A never-assigned driver gets full fairness score, or they could never win a first
job. An unrated driver scores mid, not zero — no rating is not a bad rating. Ties
break on driver id, never randomly, so a pick is reproducible for an admin
preview and assertable in a test.

Drivers who already declined *this* delivery rank last rather than being dropped,
so a job everyone passed on can still find someone.

## Offers

One driver at a time, not a broadcast. A broadcast races several drivers to one
job and disappoints all but one; a rolling single offer keeps the outcome
deterministic and the assignment history honest.

`DispatchSchedulerService` sweeps every 20s for lapsed offers and readied-but-
unheld deliveries. It is a plain interval, not `@nestjs/schedule`: the dependency
buys a cron parser this does not need, and lockfile changes are a known source of
deploy trouble on this project.

Each tick takes a Redis `SET NX EX` lock. On one instance that is a no-op; the day
a second one starts, two schedulers would otherwise offer the same delivery
twice. **If Redis is unreachable the tick is skipped, not run unguarded** — a
missed sweep self-corrects on the next tick, a double assignment does not.

## Configuration

On the existing `platform_settings` singleton — not a new flag system. Tunable
without a deploy.

| Column | Default | Meaning |
|---|---|---|
| `dispatchAutomatic` | **false** | Master switch |
| `dispatchOfferTimeoutSeconds` | 90 | Before an offer lapses |
| `dispatchMaxOffers` | 5 | Distinct drivers before escalating to a human |
| `dispatchMaxConcurrentPerDriver` | 3 | Hard cap, not a scoring penalty |
| `dispatchWeight*` | see table above | Ranking weights |

**`dispatchAutomatic` ships `false`.** The engine landed before the UI that drives
it, and a half-wired workflow must not start moving real orders. The code default
is false too, including when no settings row exists: dispatch moves real orders,
so "not configured" must mean *do nothing*. Enabling is a one-row `UPDATE`; so is
reverting, which is what makes it safe to ship.

## When an administrator is still involved

By design, only:

- driver role approval, identity and vehicle verification
- a delivery whose retry budget is exhausted (`dispatchExhaustedAt` set, admins
  alerted via `deliveries.assign`)
- no eligible driver online (admins alerted; the sweeper keeps retrying, so a
  quiet hour resolves itself)
- manual assign/reassign/cancel, which remain available and unchanged

## Customer timeline

`buildDeliveryProgress` (`packages/shared/src/delivery-progress.ts`) stitches the
vendor-order stages onto the delivery ones. The stored `DeliveryTimelineEvent` log
only begins at assignment, so a customer waiting for the shop to pack their order
previously saw an empty timeline.

All steps are always returned, reached or not — a progress indicator that grows as
it goes gives no sense of how much is left. Acceptance, not assignment, marks the
driver as on the way: a driver who never answered is not on the way. A skipped
intermediate step reads `DONE` with a null timestamp — reaching a later step
implies the earlier one happened, and nothing is fabricated.

The same honesty governs the headline: delivery reads carry `stage`/`stageLabel`
(BMPL-128, `deliveryStage` in `packages/shared/src/dispatch.ts`) naming the true
pre-collection stage — being packed, waiting for assignment, or offered — and the
customer tracker shows that sentence instead of `statusLabel`, which says
"Awaiting driver" from the moment of checkout. `stage` is null once a driver
accepts. The full label text and serving endpoints are documented in
[`DELIVERY-LIFECYCLE.md`](./DELIVERY-LIFECYCLE.md) §2.

## Messaging

`ensureDeliveryThreads` opens the customer↔driver and vendor↔driver conversations
at assignment. Previously a thread only existed once somebody navigated to it, so
`onDeliveryEvent` had nothing to post into and a customer with a gate code had to
discover the conversation first. Idempotent, and reconciles participants on
reassignment so send rights follow the current driver.

## Security notes

- A driver only ever sees deliveries assigned to their own profile
  (`ownedDelivery` → 404, not 403, so others' jobs cannot be probed).
- Vendor fulfilment routes are `@Roles('VENDOR')` and scoped by
  `OwnershipService.vendorProfileId`; a cross-vendor id 404s.
- PINs are never in a general payload — only via dedicated permission-checked
  endpoints.
- Client-supplied storage keys are validated against the caller's namespace
  before being stored or signed (see `resolveProfilePhotoKey`, and
  `assertKeyInNamespace` across every upload surface).

## Assignment mode

`PlatformSetting.dispatchAutomatic` decides who picks the driver. It is read on
every dispatch tick, so an operator can change it from ADMIN → Dispatch without a
deploy.

- **AUTOMATIC** — `DispatchEngineService` offers each ready delivery to the
  highest-ranked eligible driver, one at a time, and the sweeper retries when an
  offer lapses.
- **MANUAL** — the engine leaves deliveries in `PENDING_ASSIGNMENT` and an
  operator chooses from the eligible list on the delivery page. So a manual
  backlog cannot hide, the admin list envelope (`{ automaticDispatch, items }`)
  flags each ready-but-unassigned row with `needsManualAssignment` while
  automatic dispatch is off (BMPL-128).

Both paths call the same `assignInternal`, so a delivery assigned by hand is
indistinguishable in state from one the engine placed: same eligibility re-check,
same fresh PINs, same assignment history, timeline, audit row and notifications.
The audit trail is what tells them apart — `assignedByUserId` is null for the
engine, and the action is `DELIVERY_AUTO_ASSIGNED` rather than
`DELIVERY_ASSIGNED`. There is deliberately no second assignment engine.

The eligible list is `DriverService.eligibleDriversForDistrict`, which already
filters to drivers who are online, active, role-approved, hold an unexpired
licence, serve the delivery's district, and have at least one approved active
vehicle whose registration and insurance are current — and which stays on the
matching side of the `isTest` boundary. The console shows each candidate's
current live-job count and sorts by it; without that, manual mode reliably piles
every job onto whoever happens to sort first.

## Driver job preferences — not built

Drivers can set service areas (districts), narrow a served district to
specific towns (BMPL-176), and go online or offline. Assignment itself still
matches on district alone: `DriverService.eligibleDriversForDistrict` and
`assignmentEligibility`'s own `servesDistrict` check both compare only
`district`, never a driver's narrower town-level rows, so a driver narrowed to
one town is still offered every job anywhere in that district today. Town-
level matching is unwired (BMPL-194). That district-level match is the only
driver-side input to assignment today.

A richer preference model — parcel size or weight limits, preferred vendors,
shift windows, maximum travel distance — is a plausible future option and is
recorded here only so it is not mistaken for something that already works.

Two constraints on any future version, from the platform owner:

- **No paid priority.** Preferences must never become a product a driver buys.
  No bidding on jobs, no job auctions, no paid queue position, no subscription
  tier that changes who gets offered work. Introducing money into assignment is
  a policy decision for the owner, not an implementation detail.
- **No silent starvation.** A preference that quietly removes a driver from
  consideration must say so to the driver, or it becomes an invisible reason
  their earnings dropped.

Nothing in the schema or the engine anticipates this yet; it would be new work.

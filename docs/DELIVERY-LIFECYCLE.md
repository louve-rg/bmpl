# How a parcel moves — the delivery and courier lifecycle

How a parcel actually moves through BML today, written for a new engineer or an
operator. Everything here was read from the code on 2026-09-04, and every claim
names the file it came from so it stays checkable. **When this document and the
code disagree, the code wins** — and this document is what gets fixed.

The honest part is at the end: [Known gaps as of 2026-09-04](#6-known-gaps-as-of-2026-09-04)
records what does **not** work today. Read it before promising anything to
anyone.

A note on money: every fee in this document is an **integer in BZD cents**
(minor units), never a float. In the delivery and shipping API payloads the
`*Minor` fields are serialized as JSON **numbers** (the `money` helper,
`apps/api/src/shipping/shipment.service.ts`, converts from the database's
`BigInt`; the BigInt JSON patch lives in `apps/api/src/main.ts`). Wallet and
ledger amounts stay `BigInt` end to end and serialize as **strings** — a client
must not assume the two look alike.

---

## 1. Two different journeys, deliberately

BML moves parcels in two ways, and they are **deliberately distinct**
(the reasoning is written out at the top of `packages/shared/src/shipping.ts`):

- **Marketplace delivery** — the customer bought goods. One `OrderDelivery` row
  per vendor-order, one courier, vendor's door to customer's door, **priced by
  the vendor's own delivery settings and zones** (snapshotted onto the row at
  checkout). It does **not** go through the multimodal planner.
- **Shipping** — the customer is sending a parcel. A `Shipment` with one or
  more `ShipmentLeg` rows, planned by the route planner, possibly involving
  terminals and a carrier, possibly ending with the recipient collecting at a
  terminal.

Do not force marketplace purchases through the shipment planner, and do not
model a shipment as an `OrderDelivery` — `OrderDelivery` requires a vendor
order and permits exactly one per order, so a shipment's first and last mile
could never both be one (`apps/api/src/shipping/shipment-dispatch.service.ts`,
class comment).

The **driver sees one queue** holding both kinds of work.
`DriverJobFeedService` (`apps/api/src/dispatch/driver-job-feed.service.ts`)
projects both tables into one list; transitions still go to whichever service
owns the record.

---

## 2. Marketplace delivery, end to end

### Created at checkout

`OrdersService.checkout` (the private `runCheckout` transaction it wraps)
creates the `OrderDelivery` with status `PENDING_ASSIGNMENT`
(`apps/api/src/orders/orders.service.ts`), snapshotting the fee, whether the
free-delivery threshold applied (`freeApplied`) and the estimate from the
vendor's delivery settings and the zone that matched (`appliedZoneId`). (An
earlier revision cited `createFromCart`, a symbol that never existed —
corrected 2026-09-09.) Vendors configure those at
`/vendor/delivery` (`apps/api/src/delivery/delivery.controller.ts`); customers
get a pre-checkout quote from `POST /checkout/delivery-quote`.

### The vendor makes it dispatchable

Nothing is offered to any driver until the vendor marks the order ready.
`VendorFulfilmentService.markReady`
(`apps/api/src/orders/vendor-fulfilment.service.ts`) sets the vendor order
`READY_FOR_PICKUP` and stamps `readyForDispatchAt` on the delivery, then calls
the dispatch engine best-effort. The engine independently requires **both**
`readyForDispatchAt` and the vendor-order status to agree
(`DispatchEngineService.dispatch`, `apps/api/src/dispatch/dispatch-engine.service.ts`,
at "TWO independent checks on the same fact") — an over-broad
backfill once made unprepared orders look dispatchable, so the two checks are
deliberate.

### Getting a driver: two paths

**Automatic dispatch** (`DispatchEngineService.dispatch`,
`apps/api/src/dispatch/dispatch-engine.service.ts`) offers the delivery to one
driver at a time, ranked by `rankDrivers` in `@bmpl/shared`, with an offer
timeout, a retry budget (`dispatchMaxOffers`) and a per-driver concurrency cap.
It reads its settings from the `platform_settings` row; `dispatchAutomatic`
**defaults to off, including when no row exists**
(`DispatchEngineService.settings`, `dispatch-engine.service.ts`), and it
shipped off by migration. Whether it is on in production today is a **live
value this repository cannot prove** — read it (Admin → Dispatch, or
`GET /api/admin/ops/settings`) rather than assuming it
(`PROJECT_STATUS.md` §12); off is the shipped default, and off is correct
configuration, not a bug. A sweeper
(`apps/api/src/dispatch/dispatch-scheduler.service.ts`, every ~20s under a
Redis lock) expires unanswered offers (back to `DRIVER_DECLINED`, then
re-offer) and picks up anything a trigger missed. When the retry budget is
spent, `dispatchExhaustedAt` is stamped and admins with `deliveries.assign`
are alerted that manual assignment is needed.

**Admin assignment** (`AdminDispatchController`,
`apps/api/src/dispatch/admin-dispatch.controller.ts`): list, timeline,
assignment history, eligible drivers, `POST /admin/deliveries/:id/assign` and
`/reassign` (permission `deliveries.assign`), `/cancel` (`deliveries.manage`).
Both automatic and admin assignment funnel into the same
`DispatchService.assignInternal` (`apps/api/src/dispatch/dispatch.service.ts`),
so they produce identical state: eligibility re-checked at assignment time,
**fresh pickup and delivery PINs generated per assignment**, an append-only
`DeliveryAssignment` history row, timeline event, audit row and notifications.
A system assignment is recorded with `assignedByUserId: null` — that null is
what distinguishes the engine from a person in the audit trail.

### The driver's transitions

All under `@Roles('DELIVERY_DRIVER')` at `/driver/jobs`
(`apps/api/src/dispatch/driver-jobs.controller.ts`), implemented in
`DriverJobService` (`apps/api/src/dispatch/driver-jobs.service.ts`). The legal
transitions are the strict state machine in
`packages/shared/src/dispatch.ts` (`DELIVERY_ACTIONS` / `canPerform`):

| Action | Who | From → To |
| --- | --- | --- |
| ASSIGN | Admin (or engine) | PENDING_ASSIGNMENT → ASSIGNED |
| REASSIGN | Admin (or engine) | ASSIGNED / DRIVER_ACCEPTED / DRIVER_DECLINED → ASSIGNED |
| ACCEPT | Driver | ASSIGNED → DRIVER_ACCEPTED |
| DECLINE | Driver | ASSIGNED → DRIVER_DECLINED |
| CONFIRM_PICKUP | Driver | DRIVER_ACCEPTED → PICKUP_CONFIRMED |
| IN_TRANSIT | Driver | PICKUP_CONFIRMED → IN_TRANSIT |
| ARRIVING | Driver | IN_TRANSIT → ARRIVING |
| DELIVER | Driver | ARRIVING → DELIVERED |
| CANCEL | Admin | any pre-pickup state → CANCELLED |

Worth knowing about each step:

- **Accept** is a conditional write (`updateMany` re-asserting status and
  ownership), because the sweeper may be expiring the offer at the same moment
  — the database is the arbiter (`DriverJobsService.accept`,
  `driver-jobs.service.ts`). Accepting
  is also when the customer↔driver and vendor↔driver message threads open, not
  at assignment — a driver who merely saw an offer never joins a customer's
  conversation.
- **The customer's identity is earned by accepting.** Before `acceptedAt`, the
  driver's view carries the area, fee, vendor and item count only; the street
  address, name, phone, map pin and instructions unlock on acceptance
  (the DRIVER-audience branch of `serialize()`, `delivery-core.service.ts`).
- **Pickup requires the vendor's PIN.** The vendor reads it at
  `GET /vendor/deliveries/:id/pickup-pin`
  (`pickupPin()`, `apps/api/src/dispatch/delivery-access.controller.ts`) and
  hands it to
  the driver. Verification is constant-time, capped at 5 attempts
  (`DELIVERY_PIN_MAX_ATTEMPTS`), locks with an admin alert on exhaustion, and
  an admin can reveal PINs at `GET /admin/deliveries/:id/pins` (permission
  `deliveries.verify`). Pickup confirmation also finalizes inventory
  exactly once, guarded by `inventoryFinalizedAt`.
- **Delivery requires the customer's PIN**, read by the customer at
  `GET /deliveries/:id/pin`, plus a recipient name; proof-of-delivery photos
  upload via `/driver/jobs/:id/pod/*`. Completion marks the assignment
  `COMPLETED` and triggers **settlement**
  (`SettlementService.settleVendorOrder`) — its own atomic, idempotent
  transaction that never blocks the delivery.
- **Cancellation is admin-only and pre-pickup only.** Once goods are picked up
  the state machine has no CANCEL edge — inventory is finalized and reversal
  is a product decision that was deliberately deferred.

The customer follows progress at `GET /deliveries/:id` (status, timeline,
driver display name and vehicle, POD); the vendor at `GET /vendor/deliveries`.
Neither general payload ever contains a PIN — per the audience contract at the
top of `delivery-core.service.ts` ("Audience determines which fields a
serialized delivery exposes"), PINs are revealed only via dedicated,
permission-checked endpoints.

---

## 3. Shipping, end to end

### Quote and booking

`POST /api/shipping/quote` prices the journey without creating anything;
`POST /api/shipping` books it (`apps/api/src/shipping/shipping.controller.ts`,
`@Roles('CUSTOMER')`). Booking (`ShipmentService.create`,
`apps/api/src/shipping/shipment.service.ts`):

- freezes the planner's output into `ShipmentLeg` rows — addresses are
  **snapshotted**, so editing a saved address later cannot change a journey in
  flight;
- writes the first custody event (`SENDER` holds it) so the chain has no gap
  at its start;
- takes payment **in the same transaction** when `payWithWallet` is set: a
  wallet payment is created and escrowed, and if the customer cannot afford it
  the whole booking rolls back. An **unpaid shipment is never dispatched** —
  its legs stay `PENDING`, and `ShipmentDispatchService.isPaidFor` re-checks
  regardless (`shipment-dispatch.service.ts`);
- generates a 4-digit **handoff PIN per leg** at booking
  (`genPin()`, stamped per leg by `legData()`, `shipment.service.ts`);
- marks leg 1 `READY` and, if it is a courier leg, offers it to a driver
  immediately rather than waiting for the sweeper;
- `isTest` is derived from the booking account, never from the request, and a
  test shipment is quoted and routed over the simulation network only.

### The planner never guesses

`planRoute` in `packages/shared/src/route-planner.ts` is pure and contains no
place names. In order: same town door-to-door → one `DIRECT` leg; a configured
`CourierLane` connecting the two towns → one `DIRECT` leg priced from the lane;
otherwise each door attaches to a hub in its own town (falling back to its
district) and the cheapest chain of configured `LogisticsRoute` rows is found;
no chain → **refusal with an explanation a customer can act on**. Fees are
read, never invented: an unset hub courier fee, lane price or local-courier
platform setting makes the quote say `pricingIncomplete` rather than shipping
free (`ShipmentService.quote`, `shipment.service.ts`). Production currently
has no configured
network, so production shipping can quote a same-town direct courier and
nothing else — that is business configuration, not a defect.

### Leg kinds, and who operates each

`DIRECT`, `FIRST_MILE` and `LAST_MILE` are **courier legs**: a BML delivery
driver works them through `/driver/shipping-jobs`
(`apps/api/src/shipping/driver-shipping.controller.ts`). `LINE_HAUL` is flown,
sailed or driven by a **carrier BML does not employ**, so there is no driver
app for it — an operator with `logistics.operate` confirms what the carrier
did through `/admin/logistics/legs/:id/start|depart|arrive|handoff|exception`
(`AdminLogisticsController`, `apps/api/src/shipping/shipping.controller.ts`).

### Sequence is authority; status is derived; custody is append-only

Three rules govern every leg transition
(the "SEQUENCE IS AUTHORITY" contract atop `ShipmentService`,
`shipment.service.ts`, enforced in `transition()`):

1. **A leg may only be worked once every earlier live leg has completed** —
   `isLegActionable` (`packages/shared/src/shipping.ts`), the same
   function dispatch uses, so no courier is ever sent to a terminal the parcel
   has not reached.
2. **Shipment status is never set by hand** — it is recomputed from the legs
   after every transition by `deriveShipmentStatus`
   (`packages/shared/src/shipping.ts`): AWAITING_PICKUP → FIRST_MILE →
   AT_ORIGIN_HUB → IN_TRANSIT → AT_DESTINATION_HUB → OUT_FOR_DELIVERY →
   DELIVERED, or AWAITING_COLLECTION when the journey ends at a hub.
3. **Custody is append-only** (`CustodyEvent`): SENDER → DRIVER/CARRIER → HUB
   → … → RECIPIENT, one row per handover, never rewritten.

### A driver working a courier leg

`ShipmentDriverService` (`apps/api/src/shipping/shipment-driver.service.ts`)
reuses the **same state machine** as marketplace deliveries — the leg's
`courierStatus` column holds a `DeliveryStatus`, and `canPerform` guards every
transition. Accept and decline are conditional writes racing the sweeper;
accepting opens the message thread and unlocks the door address; pickup sets
`courierStatus PICKUP_CONFIRMED` **and** starts the leg through the shipment
layer (custody event, leg `IN_PROGRESS`, status recompute); in-transit and
arriving are simple stamps; the handoff calls the shipment layer's
`completeLeg` — the same PIN check, lockout, custody write and next-leg
release the admin path uses, deliberately not a second implementation.

Dispatch of courier legs (`ShipmentDispatchService`,
`apps/api/src/shipping/shipment-dispatch.service.ts`) is **not a second
engine**: eligibility comes from `DriverService`, ranking from `@bmpl/shared`,
and the timeout/retry/concurrency settings from the same `platform_settings`
the delivery engine reads — including `dispatchAutomatic`, so **when automatic
dispatch is off, `dispatchLeg` always returns SKIPPED**
(`shipment-dispatch.service.ts`). Workload is counted across **both** job
tables so a driver holding three marketplace deliveries is not handed a fourth
job. Its own sweeper (`shipment-dispatch.scheduler.ts`, ~20s, separate Redis
lock so one engine cannot take the other down) expires offers and re-offers;
exhaustion stamps `dispatchExhaustedAt` and alerts admins. Beside the engine,
an operator can assign or reassign a courier leg **by hand** —
`GET /admin/logistics/legs/:id/eligible-drivers`, `POST legs/:id/assign`,
`POST legs/:id/reassign` (`logistics.operate`) — which is the production path
while automatic dispatch is off (closed gap 1).

### Handoff PINs: held by the receiver

The PIN proves the handoff: whoever **receives** the parcel holds the code,
and the person handing it over must produce it. Five failed attempts lock the
leg with an admin alert (`verifyHandoffPin()`, `shipment.service.ts`). Who can
see which
PIN:

- The **customer (sender)** sees the PIN for a `LAST_MILE` **or `DIRECT`** leg
  on a journey ending at their recipient's door — the code they pass to the
  recipient (`pinFor`, `shipment.service.ts`; a DIRECT leg is
  last-mile-equivalent because it ends at the recipient's door, not a counter).
  The sender is the channel because the recipient has no account — see gap 5.
- **Desk-held codes** (a first mile or line-haul ending at a terminal) are
  revealed to staff deliberately, never by listing:
  `GET /admin/logistics/legs/:id/handoff-pin` under `logistics.verify` — a
  **different** permission from `logistics.operate`, mirroring how deliveries
  separate operating from code-holding (`deliveries.verify`). Every reveal
  writes an audit row (never containing the code), and the endpoint refuses
  the leg's **own assigned driver** (`revealHandoffPin()`,
  `shipment.service.ts`) — the person
  producing the code must not be its source.
- **Staff serialization still returns null** — the reveal endpoint is the only
  staff path to a code.

This closed what was gap 2 (PR #12). Still absent in this area: an admin
**override** for a handoff locked by five failed attempts — the lockout
message promises one, the permission for it is chosen (`logistics.verify`'s
charter includes "override a handoff verification"), and whether to build a
PIN bypass at all is a human-gated decision.

### Ending at a terminal: AWAITING_COLLECTION

When the service ends at a hub (`DOOR_TO_HUB`, `HUB_TO_HUB`), the completed
journey reads `AWAITING_COLLECTION`. No leg moves when the recipient walks in,
so an operator records the collection at
`POST /admin/logistics/shipments/:id/collect`
(`ShipmentService.recordCollection`, `shipment.service.ts`) — custody
passes HUB → RECIPIENT and the shipment recomputes to `DELIVERED`. This flow
works today, including settlement.

### Settlement

When a shipment reaches `DELIVERED` or `AWAITING_COLLECTION`,
`SettlementService.settleShipment`
(`apps/api/src/settlement/settlement.service.ts`) releases the escrow in
one balanced ledger transaction keyed uniquely to the shipment: **one driver
earning per courier leg a driver actually completed** (share set by the same
`PlatformFeeConfig` the marketplace uses), remainder to platform revenue. A
line-haul or a cancelled leg earns nobody anything. `isTest` mirrors what went
into escrow, so test funds never become real earnings.

### Cancellation

`POST /shipping/:id/cancel` (customer) or
`POST /admin/logistics/shipments/:id/cancel` (staff, `logistics.manage`) —
`ShipmentService.cancel` (`shipment.service.ts`). A customer is refused
once any leg is `IN_PROGRESS` ("contact support"); staff can always cancel.
Completed legs stay completed — a parcel that genuinely flew to San Pedro did
fly, and rewriting that would put a lie in the custody chain. Non-terminal
legs go `CANCELLED` and the escrow hold is returned to the customer in full
(`PaymentsService.releaseForShipment`). Two consequences of this are known
gaps (items 3 and 6 below).

### Tracking

`GET /shipping/:reference` for the customer (owner only — a wrong-owner lookup
answers "not found", never "wrong customer", to prevent enumeration);
`GET /admin/logistics/shipments/:reference` for staff; `GET /shipping` lists
the customer's own. The ops board (`GET /admin/logistics/shipments`) sorts by
"needs a human first": exceptions, then legs whose dispatch is exhausted.
There is **no tracking for a recipient without an account** — gap 5.

---

## 4. Who may act — the authorization picture

The API's global guard chain authenticates every route by default; the
controller prefix tells you the audience (`apps/api/CLAUDE.md` §3):

| Surface | Guard |
| --- | --- |
| `/shipping/hubs`, `/shipping/modes` | `@Public()` — comparing options requires no account |
| `/shipping/*`, `/deliveries/*`, `/checkout/delivery-quote` | `@Roles('CUSTOMER')`, self-scoped |
| `/vendor/delivery`, `/vendor/deliveries` | `@Roles('VENDOR')`, own store only |
| `/driver/jobs/*`, `/driver/shipping-jobs/*` | `@Roles('DELIVERY_DRIVER')`, own assignments only, 404 on anything else |
| `/admin/deliveries/*` | `deliveries.read` / `.assign` / `.manage` / `.verify`, `proof_of_delivery.read` |
| `/admin/logistics/*` | `logistics.read` / `.manage` / `.operate` / `.verify` (PIN reveal only) |

**A requester never fulfils their own delivery, matched on the underlying user
id, not the active role.** The same person may legitimately be a customer and
a driver; switching roles must not turn their own order into a job they can
take and confirm on their own say-so. The invariant is enforced independently
at every layer, so no single upstream mistake can defeat it:

- candidate pools exclude the requester
  (`eligibleDriversForDistrict({ excludeUserId })`, both engines);
- admin/system assignment hard-refuses the customer's own profile
  (in `assignInternal()`, `dispatch.service.ts`);
- shipment dispatch re-checks the chosen driver
  (in `dispatchLeg()`, `shipment-dispatch.service.ts`, at "The pool query
  already excluded the sender");
- the driver feed filters both kinds in the query (`notOwnDelivery` and
  `notOwnLeg`, `driver-job-feed.service.ts`; the marketplace job lists apply
  `notOwnOrder`, defined in `driver-jobs.service.ts`);
- every per-job action passes an ownership check that 404s a driver's own
  order (`ownedDelivery()`, `driver-jobs.service.ts`; `ownedLeg()`,
  `shipment-driver.service.ts`).

Covered by `apps/api/test/self-delivery.integration.spec.ts` (6 tests) and
`self-courier.integration.spec.ts` (5).

---

## 5. What does not exist — do not describe these as working

- **No live GPS tracking** of any driver, bus, boat or aircraft. Route
  recommendations start from the driver's home district because that is the
  best legitimate proxy (in `queue()`, `driver-job-feed.service.ts`), and route
  estimates carry a disclosure precisely because there is no traffic data.
- **No timetables or scheduled departures.** `scheduleNote` is a label an
  operator types, not a calendar.
- **No reverse geocoding** — a pin cannot fill in its own town, which is part
  of why the town is always asked for directly.
- **Automatic dispatch shipped off** (migration
  `20261009120000_dispatch_default_off`), and the engine treats a missing
  settings row as off. **Whether it is on in production today cannot be
  checked from the repository** — the live `platform_settings` row must be
  read, not assumed (`PROJECT_STATUS.md` §12 records it as unread). Turning
  it on is a human product decision (`AGENT-WORKFLOW.md` §7). While it is
  off, **manual assignment is the production dispatch path** for both
  marketplace deliveries and shipment courier legs (closed gap 1 below).
  (An earlier revision asserted "off in production" as fact — corrected
  2026-09-09 to match what the repository can actually prove.)

---

## 6. Known gaps as of 2026-09-04

Each of these was verified in the code on 2026-09-04 (paths cited). They are
recorded so nobody promises a flow that cannot complete; the money-adjacent
ones need a product decision, not just code. Numbering is stable — closed
items keep their number so references elsewhere stay valid.

**Read this before the list — including the correction.** An earlier
revision of this paragraph said the missing production configuration was
entirely "operations, not code". **For hub pricing that was wrong**: the hub
schemas in `packages/validation` dropped `courierFeeMinor`, so the admin
console's "Courier rate" update was stripped to nothing and refused — an
operator who tried to price a terminal could not have succeeded. A code
defect, fixed by PR #19 (item 9 below). The distinction itself still holds:
production has no shipping network configured — no hubs, no routes, no
courier fees (`PROJECT_STATUS.md` §12, "Business configuration, not
defects") — and entering that data is operations' work no code change does
for them. But whether the data COULD be entered is a code question, and it is
now checked rather than assumed.

**1. CLOSED on `main` (PR #11) — a shipment courier leg can now be assigned
by hand.** `GET /admin/logistics/legs/:id/eligible-drivers`,
`POST legs/:id/assign` and `POST legs/:id/reassign` (all `logistics.operate`)
give operators the manual dispatch path the exhaustion alert always promised.
With `dispatchAutomatic` off — its shipped default; the live value is read,
not assumed (§5) — this is the production dispatch path for courier legs.

**2. CLOSED on `main` (PR #12) — every handoff code can reach the hand that
must type it.** `pinFor` treats a `DIRECT` leg as last-mile-equivalent, so the
customer sees the code for a door-to-door run; desk-held codes are revealed by
`GET /admin/logistics/legs/:id/handoff-pin` under `logistics.verify` —
scope-limited, refused to the leg's own assigned driver, and audited on every
reveal. Residual, still open within this area: **no admin override exists for
a handoff locked by five failed attempts**, though the lockout message
promises one; the permission is chosen (`logistics.verify`), and whether to
build a PIN bypass at all is human-gated.

**3. CLOSED on `main` (PR #15) — cancelling a shipment now releases the
driver.** `ShipmentService.cancel` closes the driver's half of every live
courier job the way the marketplace side always did: `courierStatus` goes
terminal, the assignment and vehicle are cleared, the ACTIVE or ACCEPTED
`ShipmentLegOffer` is ended, and every released driver — offered or accepted
— is notified after the commit. Covered by regression tests for both entry
states, including the notification.

**4. CLOSED on `main` (BMPL-103) — a leg EXCEPTION has a way back out.**
`POST /admin/logistics/legs/:id/resolve-exception` (`logistics.operate`, the
same permission that flags one; `ShipmentService.resolveException`) offers two
resolutions, both restoring states the lifecycle already defines. RESUME puts
the leg back exactly where it was flagged from — IN_PROGRESS if it had
started, READY if not — with its driver, its custody chain and everything
else untouched. RELEASE_DRIVER re-queues an uncollected courier leg: the
assignment clears, the offer history closes, and manual assignment (or the
sweeper, where automatic dispatch is on) restaffs it. Cancellation now
composes with exception too: `cancel` closes the driver's half of an
EXCEPTION leg (previously a phantom job survived in the driver's feed), and a
customer cannot self-cancel a shipment whose flagged leg had already started
— that is support's call, exactly as for IN_PROGRESS. Deliberately still
refused, because the policy does not exist (see gap 6): releasing a driver
who has already collected the parcel. Where a parcel stranded mid-carry
should go, who pays for the interrupted run and what the customer is owed are
owner decisions; until they are made, the endpoint fails closed and the outs
are RESUME or a staff cancellation.

**5. PARTIALLY CLOSED on `main` (BMPL-111) — the recipient can now see, but
is still not told.** The seeing half: every booking mints a high-entropy
capability token (`Shipment.recipientToken`), the sender shares the link, and
`GET /shipping/track/{token}` (public, strictly throttled,
`ShipmentService.trackPublic`) answers with a deliberate allowlist — status
and step progress in customer language, the destination town, and the
collection terminal only while the parcel is waiting there. Never: sender
identity or address, money, the parcel description, a handoff PIN, custody
actors, driver identity, or operator-typed reasons. Every miss is one fixed
404, so a guessed URL confirms nothing. The telling half stays open, and it
is a policy question, not an engineering one: pushing a notification to the
recipient requires `destinationEmail` / `destinationPhone` — contact details
BML holds only because a customer typed them, for a person who never signed
up. Whether to contact them, on which channel, with what consent posture, is
the owner's decision; nothing is sent today. (`AWAITING_COLLECTION` and the
collection flow itself remain gap-free.)

**6. Staff cancellation returns the whole escrow even when a driver completed
a leg.** `cancel` releases the full held amount to the customer
(`PaymentsService.releaseForShipment` →
`apps/api/src/payments/payments.service.ts`, which releases each hold in
full), completed legs deliberately stay COMPLETED, and `settleShipment` only
runs on DELIVERED / AWAITING_COLLECTION — so a driver who genuinely drove
leg 1 earns nothing when staff cancel at leg 2. The code comment "Nobody has
started work" (in `ShipmentService.cancel`, `shipment.service.ts`) is true on
the customer path, whose
guard blocks cancellation once a leg is IN_PROGRESS, and false on the staff
path. **Money-adjacent: what the driver should be paid, and what the customer
should be refunded, is a product-owner decision. Do not invent a policy.**

**7. CLOSED on `main` (PR #18) — the handoff desk has its screen.**
`apps/admin/app/dashboard/logistics/handoff-desk/page.tsx` consumes
`GET /admin/logistics/hubs/:id/expected` and surfaces the audited PIN reveal
(#12) beside each first-mile and line-haul row, so desk staff see what is
coming and can produce the code the courier must be told.

**8. CLOSED on `main` (PR #13) — an unpriced journey is refused in words,
not a 500.** This entry previously read "a fix exists on an unmerged branch
(`fix/zero-total-shipment-booking`) — this stays OPEN until that merges", and
**that was wrong at the 2026-09-04 review**: #13 (`f1d7553`) merged on
2026-09-04 and is an ancestor of `111cd4b`, the commit that review was made
against; the register carried the gap as open while the guard sat on `main`.
Corrected 2026-09-07 by reading the code. The guard lives in
`ShipmentService.create` (`apps/api/src/shipping/shipment.service.ts`, the
"ZERO IS NOT A PRICE" guard): a plan whose
`plan.totalMinor <= 0` is refused with a plain-words 400 ("this journey has
not been priced yet"), keyed on the total — deliberately not on
`pricingIncomplete`, so a zero-fee hub on a journey with priced transport
still books — and zero remains "not a price". A deliberate free shipment,
if the product ever wants one, is an explicit opt-in on top of this guard,
not a loosening of it.

**9. CLOSED on `main` (PR #19) — hub courier fees were unreachable through
the product.** Found by walking the admin flow, not by reading the API:
`courierFeeMinor` appeared nowhere in `packages/validation`'s hub schemas
(`hubBase` never carried it, and `updateHubSchema` is `hubBase.partial()`),
so the Terminals screen's "Courier rate" PATCH was stripped to `{}` and
refused. Operations could not have priced a hub even by doing everything
right — which also falsified this register's earlier claim that the missing
production network was purely an operations matter. #19 carries the field
end to end and makes the `isTest` practice network buildable through the
console.

---

*Written against `main` at `c73a2ed`; updated against `6b2e0d1`
(gaps 1–2 closed by #11/#12, gap 8 added); updated against `111cd4b`
(gaps 3 and 7 closed by #15/#18, item 9 added closed by #19, and the
operations-vs-code framing corrected above); updated against `3c41e1e`
(gap 8 corrected to CLOSED — it was already closed by #13 at the previous
review and the register was wrong; gaps 4, 5 and 6 re-verified still open);
every `file:line` anchor in this document re-verified against `origin/main`
at `75e9ef1` on 2026-09-07 — 38 checked, 12 corrected, prose untouched; then
converted to symbol+file form (a quoted marker where no symbol encloses the
spot) later the same day, so a stale citation fails loudly as a missing grep
hit instead of silently pointing at the wrong line; updated 2026-09-09
(BMPL-99, audited at `5b97624`): the `createFromCart` citation corrected to
`checkout`/`runCheckout`, and the `dispatchAutomatic` production claim
reduced to what the repository proves (the default-off migration) — the live
value is a read, not an assumption.
Sources: the controllers
and services cited inline — every endpoint named here was read in its
controller. Cross-references: `docs/PROJECT_STATUS.md` §6–7 for shipping and
routing, `CLAUDE.md` §5–6 for the invariants, `docs/AGENT-WORKFLOW.md` §7 for
the approval gates (enabling `dispatchAutomatic` is behind one).*

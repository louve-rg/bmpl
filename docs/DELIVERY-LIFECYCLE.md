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
`apps/api/src/shipping/shipment.service.ts:40`, converts from the database's
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

`OrdersService.createFromCart` creates the `OrderDelivery` inside the checkout
transaction with status `PENDING_ASSIGNMENT`
(`apps/api/src/orders/orders.service.ts:309`), snapshotting the fee, the free
threshold and the estimate from the vendor's delivery settings and the zone
that matched (`appliedZoneId`). Vendors configure those at
`/vendor/delivery` (`apps/api/src/delivery/delivery.controller.ts`); customers
get a pre-checkout quote from `POST /checkout/delivery-quote`.

### The vendor makes it dispatchable

Nothing is offered to any driver until the vendor marks the order ready.
`VendorFulfilmentService.markReady`
(`apps/api/src/orders/vendor-fulfilment.service.ts:79`) sets the vendor order
`READY_FOR_PICKUP` and stamps `readyForDispatchAt` on the delivery, then calls
the dispatch engine best-effort. The engine independently requires **both**
`readyForDispatchAt` and the vendor-order status to agree
(`apps/api/src/dispatch/dispatch-engine.service.ts:117-125`) — an over-broad
backfill once made unprepared orders look dispatchable, so the two checks are
deliberate.

### Getting a driver: two paths

**Automatic dispatch** (`DispatchEngineService.dispatch`,
`apps/api/src/dispatch/dispatch-engine.service.ts`) offers the delivery to one
driver at a time, ranked by `rankDrivers` in `@bmpl/shared`, with an offer
timeout, a retry budget (`dispatchMaxOffers`) and a per-driver concurrency cap.
It reads its settings from the `platform_settings` row; `dispatchAutomatic`
**defaults to off, including when no row exists**
(`dispatch-engine.service.ts:67`), and it is deliberately off in production —
that is correct configuration, not a bug. A sweeper
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
`DispatchService.assignInternal` (`apps/api/src/dispatch/dispatch.service.ts:201`),
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
  — the database is the arbiter (`driver-jobs.service.ts:368-397`). Accepting
  is also when the customer↔driver and vendor↔driver message threads open, not
  at assignment — a driver who merely saw an offer never joins a customer's
  conversation.
- **The customer's identity is earned by accepting.** Before `acceptedAt`, the
  driver's view carries the area, fee, vendor and item count only; the street
  address, name, phone, map pin and instructions unlock on acceptance
  (`delivery-core.service.ts:258-339`).
- **Pickup requires the vendor's PIN.** The vendor reads it at
  `GET /vendor/deliveries/:id/pickup-pin`
  (`apps/api/src/dispatch/delivery-access.controller.ts:53`) and hands it to
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
Neither general payload ever contains a PIN
(`delivery-core.service.ts:25-27`).

---

## 3. Shipping, end to end

### Quote and booking

`POST /api/shipping/quote` prices the journey without creating anything;
`POST /api/shipping` books it (`apps/api/src/shipping/shipping.controller.ts`,
`@Roles('CUSTOMER')`). Booking (`ShipmentService.create`,
`apps/api/src/shipping/shipment.service.ts:276`):

- freezes the planner's output into `ShipmentLeg` rows — addresses are
  **snapshotted**, so editing a saved address later cannot change a journey in
  flight;
- writes the first custody event (`SENDER` holds it) so the chain has no gap
  at its start;
- takes payment **in the same transaction** when `payWithWallet` is set: a
  wallet payment is created and escrowed, and if the customer cannot afford it
  the whole booking rolls back. An **unpaid shipment is never dispatched** —
  its legs stay `PENDING`, and `ShipmentDispatchService.isPaidFor` re-checks
  regardless (`shipment-dispatch.service.ts:91-93`);
- generates a 4-digit **handoff PIN per leg** at booking
  (`shipment.service.ts:440`);
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
free (`shipment.service.ts:93-154`). Production currently has no configured
network, so production shipping can quote a same-town direct courier and
nothing else — that is business configuration, not a defect.

### Leg kinds, and who operates each

`DIRECT`, `FIRST_MILE` and `LAST_MILE` are **courier legs**: a BML delivery
driver works them through `/driver/shipping-jobs`
(`apps/api/src/shipping/driver-shipping.controller.ts`). `LINE_HAUL` is flown,
sailed or driven by a **carrier BML does not employ**, so there is no driver
app for it — an operator with `logistics.operate` confirms what the carrier
did through `/admin/logistics/legs/:id/start|depart|arrive|handoff|exception`
(`apps/api/src/shipping/shipping.controller.ts:133-286`).

### Sequence is authority; status is derived; custody is append-only

Three rules govern every leg transition
(`shipment.service.ts:60-71`, enforced in `transition()`):

1. **A leg may only be worked once every earlier live leg has completed** —
   `isLegActionable` (`packages/shared/src/shipping.ts:234`), the same
   function dispatch uses, so no courier is ever sent to a terminal the parcel
   has not reached.
2. **Shipment status is never set by hand** — it is recomputed from the legs
   after every transition by `deriveShipmentStatus`
   (`packages/shared/src/shipping.ts:192`): AWAITING_PICKUP → FIRST_MILE →
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
(`shipment-dispatch.service.ts:55`). Workload is counted across **both** job
tables so a driver holding three marketplace deliveries is not handed a fourth
job. Its own sweeper (`shipment-dispatch.scheduler.ts`, ~20s, separate Redis
lock so one engine cannot take the other down) expires offers and re-offers;
exhaustion stamps `dispatchExhaustedAt` and alerts admins.

### Handoff PINs: held by the receiver

The PIN proves the handoff: whoever **receives** the parcel holds the code,
and the person handing it over must produce it. Five failed attempts lock the
leg with an admin alert (`shipment.service.ts:734-760`). Who can see which
PIN (`pinFor`, `shipment.service.ts:1105`):

- The **customer (sender)** sees the PIN only for a `LAST_MILE` leg on a
  journey ending at their recipient's door — the code they pass to the
  recipient.
- **Staff serialization always returns null** — there is no listing of PINs.

What that leaves uncovered is a real gap — see
[Known gaps](#6-known-gaps-as-of-2026-09-04), item 2.

### Ending at a terminal: AWAITING_COLLECTION

When the service ends at a hub (`DOOR_TO_HUB`, `HUB_TO_HUB`), the completed
journey reads `AWAITING_COLLECTION`. No leg moves when the recipient walks in,
so an operator records the collection at
`POST /admin/logistics/shipments/:id/collect`
(`ShipmentService.recordCollection`, `shipment.service.ts:927`) — custody
passes HUB → RECIPIENT and the shipment recomputes to `DELIVERED`. This flow
works today, including settlement.

### Settlement

When a shipment reaches `DELIVERED` or `AWAITING_COLLECTION`,
`SettlementService.settleShipment`
(`apps/api/src/settlement/settlement.service.ts:98`) releases the escrow in
one balanced ledger transaction keyed uniquely to the shipment: **one driver
earning per courier leg a driver actually completed** (share set by the same
`PlatformFeeConfig` the marketplace uses), remainder to platform revenue. A
line-haul or a cancelled leg earns nobody anything. `isTest` mirrors what went
into escrow, so test funds never become real earnings.

### Cancellation

`POST /shipping/:id/cancel` (customer) or
`POST /admin/logistics/shipments/:id/cancel` (staff, `logistics.manage`) —
`ShipmentService.cancel` (`shipment.service.ts:975`). A customer is refused
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
| `/admin/logistics/*` | `logistics.read` / `.manage` / `.operate` |

**A requester never fulfils their own delivery, matched on the underlying user
id, not the active role.** The same person may legitimately be a customer and
a driver; switching roles must not turn their own order into a job they can
take and confirm on their own say-so. The invariant is enforced independently
at every layer, so no single upstream mistake can defeat it:

- candidate pools exclude the requester
  (`eligibleDriversForDistrict({ excludeUserId })`, both engines);
- admin/system assignment hard-refuses the customer's own profile
  (`dispatch.service.ts:222-229`);
- shipment dispatch re-checks the chosen driver
  (`shipment-dispatch.service.ts:135-143`);
- the driver feed filters both kinds in the query (`notOwnOrder`,
  `notOwnDelivery`, `notOwnLeg` — `driver-job-feed.service.ts:97-103`);
- every per-job action passes an ownership check that 404s a driver's own
  order (`driver-jobs.service.ts:105-120`,
  `shipment-driver.service.ts:87-97`).

Covered by `apps/api/test/self-delivery.integration.spec.ts` (6 tests) and
`self-courier.integration.spec.ts` (5).

---

## 5. What does not exist — do not describe these as working

- **No live GPS tracking** of any driver, bus, boat or aircraft. Route
  recommendations start from the driver's home district because that is the
  best legitimate proxy (`driver-job-feed.service.ts:216-218`), and route
  estimates carry a disclosure precisely because there is no traffic data.
- **No timetables or scheduled departures.** `scheduleNote` is a label an
  operator types, not a calendar.
- **No reverse geocoding** — a pin cannot fill in its own town, which is part
  of why the town is always asked for directly.
- **Automatic dispatch is off in production**, by deliberate decision
  (migration `20261009120000_dispatch_default_off`), and the engine treats a
  missing settings row as off. Turning it on is a human product decision
  (`AGENT-WORKFLOW.md` §7). What that means for shipping while it is off is
  gap 1 below.

---

## 6. Known gaps as of 2026-09-04

Each of these was verified in the code on 2026-09-04 (paths cited). They are
recorded so nobody promises a flow that cannot complete; **none of them is
fixed by this document**, and the money-adjacent ones need a product decision,
not just code.

**1. A shipment courier leg has no manual assignment path — so with automatic
dispatch off, production shipping cannot reach a driver.** Marketplace
deliveries have `POST /admin/deliveries/:id/assign` and `/reassign`;
`AdminLogisticsController` exposes start / depart / arrive / handoff /
exception / collect / cancel and **no assign** (verified across
`apps/api/src/shipping/*.controller.ts`). With `dispatchAutomatic` off —
deliberate in production — `ShipmentDispatchService.dispatchLeg` always
returns SKIPPED (`shipment-dispatch.service.ts:55`), and when a leg's offers
are exhausted the admin alert literally says "Assign one by hand"
(`shipment-dispatch.service.ts:375`) — an instruction no API endpoint can
carry out. Operators *can* move a parcel via `legs/:id/start` + `handoff`,
but that bypasses the driver flow and driver earnings entirely.

**2. DIRECT and FIRST_MILE handoff PINs are unobtainable through the API, so
those handoffs cannot legitimately complete.** Every leg completion requires
the receiver's PIN (`verifyHandoffPin`, `shipment.service.ts:734`). But
`pinFor` (`shipment.service.ts:1105`) reveals a PIN only to the customer, only
for a `LAST_MILE` leg; staff serialization always returns null, and unlike
deliveries (`GET /admin/deliveries/:id/pins`) **no reveal endpoint exists for
shipment leg PINs** (verified by grep for `handoffPin` across
`apps/api/src`). So on a `DIRECT` leg the recipient is told to expect a code
nobody ever showed them, and on a `FIRST_MILE` the driver is told "terminal
staff hold the code" (`shipment-driver.service.ts:360`) while nothing shows
terminal staff that code. The integration specs pass because they read
`handoffPin` straight from the database. After five failed attempts the error
says an administrator has to confirm the handoff — and no override endpoint
exists for that either.

**3. Cancelling a shipment orphans an accepted courier job in the driver's
queue.** `ShipmentService.cancel` (`shipment.service.ts:985`) sets leg
`status` to CANCELLED but never clears `courierStatus` or
`assignedDriverProfileId`, never closes the `ShipmentLegOffer`, and never
notifies the driver. The driver feed filters legs on `courierStatus` alone
(`legScope`, `driver-job-feed.service.ts:413`), so a leg at `DRIVER_ACCEPTED`
on a cancelled shipment stays in the queue indefinitely: decline requires
`courierStatus ASSIGNED` (`shipment-driver.service.ts:149`) and pickup fails
`isLegActionable` because the leg is CANCELLED. The window is real — a
customer cancel is only blocked once a leg is `IN_PROGRESS`, and an accepted
leg is still `READY` until pickup. The marketplace side handles this
correctly (`DispatchService.cancel` closes the assignment and notifies the
driver). Untested: the cancellation specs never involve an assigned driver.

**4. A leg EXCEPTION is one-way.** `flagException`
(`shipment.service.ts:763`) sets the leg to EXCEPTION and stamps
`shipment.exceptionAt`; no endpoint clears either, `isLegActionable` refuses
EXCEPTION legs (`packages/shared/src/shipping.ts:238`), and any EXCEPTION leg
makes the whole shipment read EXCEPTION (`deriveShipmentStatus`). The only
exit is cancelling the shipment — there is no "damaged, repacked, continue"
path.

**5. The recipient is invisible.** Every shipment notification goes to
`customerUserId` — the sender (`notifyCustomer`, `shipment.service.ts:905`
and `shipment-driver.service.ts:371`). The `destinationEmail` /
`destinationPhone` snapshots are written at booking and the email is never
used for anything (verified by grep). There is no public or anonymous
tracking: `GET /shipping/:reference` requires the CUSTOMER role and
ownership. A recipient without a BML account learns their parcel is
"ready to collect" only if the sender tells them. (`AWAITING_COLLECTION`
itself works — the collection flow is gap-free once the recipient shows up.)

**6. Staff cancellation returns the whole escrow even when a driver completed
a leg.** `cancel` releases the full held amount to the customer
(`PaymentsService.releaseForShipment` →
`apps/api/src/payments/payments.service.ts:121`, which releases each hold in
full), completed legs deliberately stay COMPLETED, and `settleShipment` only
runs on DELIVERED / AWAITING_COLLECTION — so a driver who genuinely drove
leg 1 earns nothing when staff cancel at leg 2. The code comment "Nobody has
started work" (`shipment.service.ts:991`) is true on the customer path, whose
guard blocks cancellation once a leg is IN_PROGRESS, and false on the staff
path. **Money-adjacent: what the driver should be paid, and what the customer
should be refunded, is a product-owner decision. Do not invent a policy.**

**7. The handoff-desk feed has no screen.** `GET /admin/logistics/hubs/:id/expected`
(`ShipmentService.expectedAtHub`, `shipment.service.ts:562`) answers "what
should this terminal be expecting", and no admin UI calls it (verified by
grep across `apps/admin`).

---

*Written against `main` at `c73a2ed` (2026-09-04). Sources: the controllers
and services cited inline — every endpoint named here was read in its
controller. Cross-references: `docs/PROJECT_STATUS.md` §6–7 for shipping and
routing, `CLAUDE.md` §5–6 for the invariants, `docs/AGENT-WORKFLOW.md` §7 for
the approval gates (enabling `dispatchAutomatic` is behind one).*

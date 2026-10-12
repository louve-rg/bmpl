# End-to-end journeys — behaviour-verified on a local stack

This document exists because five customer journeys were proven working,
start to finish, for the first time on 2026-10-12 — and until now the only
record of that was agent inbox messages and kanban notes. It writes that
proof down.

**What "behaviour-verified on a local stack" means, and why that phrase and
not a stronger one:** every walk below was run by one QA agent (Jim,
`hive/agents/jim-mv09alb5/memory.md`) against his own local dev stack — his
own worktree, his own Postgres/Redis/MinIO containers, seeded and ad-hoc
`uat-*` test accounts, real code paths and real database writes, but never
production and never real money. **None of this is "production-verified."**
Where this document cannot tell from the record where something was
checked, it says so rather than picking the stronger word. This document was
written from that existing record; nothing in it was re-run to produce it.

---

## 1. Marketplace purchase → delivered order, tracker correct at all seven steps

Walked as `maya.customer@example.bz` buying from a real (non-test) vendor,
fulfilment type Delivery, through to a new `isTest:false` driver created via
the real onboarding + approval path (registration → email verification →
role application → admin approval → vehicle approval → service area).

**Full transition sequence watched live on `DeliveryTracker`
(`apps/web/components/DeliveryTracker.tsx`), each one matching backend state
on a fresh reload, order `ORD-96C33D2735`, BZ$55.00:**

`PENDING_ASSIGNMENT` ("Being packed by the store") → vendor marks ready
("Waiting for a driver to be assigned") → `ASSIGNED` ("Driver offered") →
`DRIVER_ACCEPTED` ("Driver accepted") → pickup confirmed ("Picked up," using
a vendor-revealed pickup PIN — a different code from the customer's delivery
PIN) → in transit → arriving ("Arriving," customer's own delivery-PIN reveal
worked at this step) → `DELIVERED` ("Delivered, Received by Maya Cardenas").
The `HISTORY` log carried a complete, correctly ordered, correctly
timestamped entry for every step.

**Automatic dispatch picked this up unattended.** No admin or script
re-triggered anything: `apps/api/src/dispatch/dispatch-scheduler.service.ts`
sweeps every `TICK_MS` (20 seconds), and once the new driver became eligible
and online, the delivery — stuck at `PENDING_ASSIGNMENT` since an earlier
pass — was auto-assigned within that window.

**Counter-intuitive fact, stated plainly because it cost real time to find:
a saved service area, not the driver's home district, is what makes a
driver eligible for automatic dispatch.** `DISPATCH.md` already documents
the rule (`DriverService.eligibleDriversForDistrict` filters to drivers who
"serve the delivery's district"); what the local walk added was the sharp
edge of it — a brand-new driver with an approved profile, an approved
vehicle and a home district set still produced zero eligible candidates
until a service area was explicitly checked and saved on
`/dashboard/driver/service-areas`. Nothing on the driver profile page or in
the vehicle-approval response's `canGoOnline` reasons calls this out; it is
easy to miss.

---

## 2. A three-leg shipping route with hub handoffs

Walked as `uat-customer@bzemarketplace.com` (the seeded `isTest:true`
account the UAT courier-lane fixtures require). The planner found a real
3-leg `DOOR_TO_DOOR` route through the seeded hub network (Belize City →
Belmopan), quoted BZ$29.00, and the first leg auto-assigned to the seeded
driver immediately on booking.

**Driver side walked separately, accept through complete**, with the
handoff PIN: Accept → Confirm pickup → Start the trip → Arriving → handoff.

**Counter-intuitive fact, already written up and merged
(`docs/DELIVERY-LIFECYCLE.md`, "Handoff PINs: held by the receiver"): a
hub-ending leg's handoff PIN is staff-only and never shown to the
customer.** A `FIRST_MILE` or `LINE_HAUL` leg ends at a hub counter, not a
door; only staff holding the `logistics.verify` permission can reveal that
leg's code, through `GET /admin/logistics/legs/:id/handoff-pin`
(`revealHandoffPin()`, `shipment.service.ts`) — never by listing, and never
to the leg's own assigned driver. This document does not restate that
finding's detail; `DELIVERY-LIFECYCLE.md`'s own section is the source and
is already behaviour-verified-on-a-local-stack worded correctly. No PIN
value appears there or here.

---

## 3. Passenger transport — request-and-confirm, not dispatch

Walked both sides: customer requests seats on a published departure →
operator confirms by hand → driver starts the trip → driver completes the
trip, booking status following `Requested` → `Confirmed` → `Completed`.

**Counter-intuitive fact, stated plainly because dispatch findings do not
transfer here: passenger transport uses a completely different mechanism,
with no automatic dispatch at all.** `apps/api/src/passenger/passenger-operations.service.ts`
contains the explicit comment "Manual staffing only — the delivery lesson;
no automatic dispatch exists for passengers." An operator or admin assigns
every trip by hand. There is also no `driver_service_areas`-equivalent
geography gate for passenger drivers — eligibility is fleet membership, role
approval and an approved vehicle only — so the marketplace service-area
lesson above does not generalize to this vertical. No payment exists
anywhere in the passenger flow: `baseFareMinor` is shown to the rider but
never charged (schema comment: "nothing in this phase computes, quotes or
charges one"). No PIN or boarding code exists in this module either — driver
actions are a plain "Start trip" / "Complete trip," no handoff verification
step.

---

## 4. Failure and deviation paths

Walked on existing fixtures, additive only, no money/refund endpoint
touched anywhere in this pass.

- **Driver decline vs. an unacted offer timing out are logged distinctly.**
  An explicit decline (driver job detail page, reason textarea) logs on the
  customer tracker as actor `driver`: `"DRIVER DECLINED · driver · ... ·
  <reason>"`. Separately, an offer nobody acts on **times out on its own**
  and logs as actor `system`: `"DRIVER DECLINED · system · ... The driver
  did not respond in time."` Both land back at "Awaiting driver," but the UI
  correctly distinguishes why, every time.
- **A delivery accepted but never completed has no staleness indicator.**
  Left deliberately at `DRIVER_ACCEPTED` with the driver simply not acting
  further — the customer tracker just says "Driver accepted," with no ETA or
  "this is taking longer than expected" messaging for this state. Not a
  defect by itself; worth knowing the tracker has no notion of "this has sat
  too long."
- **Passenger self-cancel of a confirmed booking works cleanly.**
  `/dashboard/passenger/bookings` → "Cancel booking" → booking goes
  `Confirmed` → `Cancelled`, with no leftover "seats held" message and no
  phantom-reserved seat.
- **An operator cancelling a departure correctly cascades to the rider's
  booking.** Cancelling a departure with a confirmed rider on it flips the
  departure to `CANCELLED` and the rider's own `CONFIRMED` booking
  automatically cascades to `"Cancelled: The departure was cancelled."` —
  no leftover booking claiming seats against a dead departure.

---

## 5. The one real gap: order-cancel exists, works, and is unreachable

`POST /api/orders/:id/cancel` is a real, working, correctly authorised
endpoint — restricted to orders still `PENDING`
(`apps/api/src/orders/orders.controller.ts:45-48`). **There are zero
references to it anywhere in `apps/web`.** A fresh `PENDING` order
(`ORD-0941D30FC0`) had no cancel affordance anywhere on its detail page or
any other page a customer could reach — only a "Message vendor" button. This
is a missing path, not a bug in the endpoint: the capability is built,
correct and authorised, and completely unreachable by a real customer today.

This is tracked as its own card (MDF-224), currently dispatched to build the
missing UI — gated on first establishing, before any UI is written, whether
a `PENDING` order has already had money captured, a wallet debited, or a
hold placed, and what `cancel()` does to it if so. That gate has not yet
cleared as of this writing; this document does not speak to its outcome.

---

## What this document does not claim

- **Nothing here was verified against production.** Every walk above ran on
  a local stack against seeded or ad-hoc `uat-*` test accounts.
- **The service-area mechanism above is proven; whether it explains any
  currently-stuck production delivery is not.** That a driver needs a saved
  service area (not just a home district) to be dispatch-eligible is a real,
  locally-verified fact about how the code behaves. Whether that is *why*
  any specific production delivery is stuck right now is a separate
  question this document does not answer — it depends on live
  `dispatchAutomatic` state and live driver service-area data, neither
  readable from the repository, and remains **a hypothesis awaiting an
  owner-authorised production read**, not a finding.
- **Scope actually walked** was limited to the account/fixture combinations
  named above; no claim is made about every possible path through any of
  these five verticals.

Source: `hive/tasks.json` (MDF-18, MDF-224, MDF-225) and
`hive/agents/jim-mv09alb5/memory.md` (passes one through five, 2026-10-12).
No password, PIN, or identifier beyond what was already recorded in those
sources appears in this document.

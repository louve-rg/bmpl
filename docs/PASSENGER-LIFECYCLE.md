# How people move — the passenger transportation lifecycle

How passenger transport actually works in BML today, written for a new
engineer or an operator. Everything here was read from the code on 2026-09-05
(`main` @ `fc84f86`), and every claim names the file it came from so it stays
checkable. **When this document and the code disagree, the code wins** — and
this document is what gets fixed.

The honest parts are at the end:
[What is not built](#8-what-is-not-built--do-not-infer-capability-from-silence)
and [Known gaps](#9-known-gaps-as-of-2026-09-05). Read both before promising
anything to anyone.

**The single most useful sentence in this document:** the passenger service is
engineering-complete but has **no routes, no departures and no fares
configured in production** — so today every booking attempt is correctly
refused, and that refusal is the system working, not a defect. "The
configuration is missing" and "the configuration could be entered" are
separate claims; both happen to be true here. Entering it is an operator's
business decision, made through their dashboard — never seed data.

A note on money, which governs this whole vertical: **no passenger money
moves.** No fare is charged, no commission taken, no cancellation fee
collected. `fareQuotedMinor` exists on the booking row and is deliberately
never written (`apps/api/src/passenger/passenger-operations.service.ts:187`),
because whether a fare is per seat or per booking — and every other piece of
pricing policy — is a product-owner decision that has not been made. This
document therefore contains no amounts, and neither should the code.

---

## 1. The cast, and how each is vetted

Three roles, all held alongside a person's other roles (the same human can be
a customer, a vendor and a passenger driver):

- **Rider** — any `CUSTOMER`. No extra vetting; the rider surface is plain
  customer functionality (`passenger-rider.controller.ts:20`).
- **Passenger driver** — a person approved to carry passengers. Role code
  `PASSENGER_DRIVER`.
- **Transport operator** (fleet provider) — a business running routes. Role
  code `PASSENGER_PROVIDER`.

Both vetted roles reuse the platform's **existing role-application
machinery** — the same `RoleApplication` pipeline every other role goes
through, reviewed in the admin console (`apps/api/src/admin/admin.service.ts`).
There is no passenger-specific application pipeline, deliberately.

The profile is the application's substance. Any customer may build a
driver or operator profile *before* approval — the profile endpoints are
`CUSTOMER`-gated (`passenger-driver.controller.ts:25`,
`passenger-provider.controller.ts:23`) — but **operations are gated
separately** on the role actually being APPROVED: the trips, network and
affiliation surfaces demand `PASSENGER_DRIVER` / `PASSENGER_PROVIDER`
(`passenger-driver-trips.controller.ts:14`,
`passenger-network.controller.ts`, class decorators).

**Vehicles are vetted individually.** A vehicle belongs to *either* a fleet
operator *or* an owner-driver, never both, and must be admin-approved before
it can carry anyone (`admin-passenger.controller.ts:58-64`,
`POST admin/passengers/vehicles/:id/approve|reject`).

**Whether a driver can actually work is computed, not stored.**
`GET passenger/driver/eligibility` derives it live: approved role + active
profile + unexpired licence + at least one usable vehicle — where *usable*
means approved, active, registration and insurance unexpired, and either the
driver's own or, for a fleet driver, one of their operator's
(`passenger-driver.service.ts:242`, `eligibility()`).

The web surfaces for all of this are merged: driver dashboard at
`apps/web/app/dashboard/passenger-driver/` (profile, vehicles, trips),
operator dashboard at `apps/web/app/dashboard/passenger-operator/` (profile,
vehicles, routes, departures, bookings), and moderation at
`apps/admin/app/dashboard/passengers/`.

---

## 2. The network: routes, stops, departures

An approved operator declares their own network; admins can also enter it on
an operator's behalf (`passenger-network.service.ts:111-158` — provider and
admin variants converge on the same private implementations).

- A **route** is origin to destination, with optional **ordered stops**
  replaced as a whole list (`replaceStops`,
  `passenger-network.service.ts:284`). Once a route has departures — *any*
  departures, cancelled ones included — its stops freeze
  (`passenger-network.service.ts:268`): a trip row means the route was
  operated as described, so the description stops being editable.
- A **departure** (trip) is one dated run of a route
  (`createTripForProvider`, `passenger-network.service.ts:358`). Every trip
  the product can create today is `kind: 'SCHEDULED'`
  (`passenger-network.service.ts:403`); the `ON_DEMAND` enum value has no
  writer — see [What is not built](#8-what-is-not-built--do-not-infer-capability-from-silence).
- Geography is the operator's own declaration. Nothing here invents towns,
  connections, schedules or times — the no-fabrication rule of `CLAUDE.md` §5
  applies to passenger transport identically (§8).

A trip's rider-facing **reference** shares the shipment alphabet and is
checked unique against *both* the trip and shipment tables — one reference
names exactly one thing anywhere in the product
(`passenger-network.service.ts`, `uniqueReference`).

---

## 3. The fare gate

The rule, exactly as the code behaves
(`passenger-operations.service.ts:73-79`, `fareGate()`):

> A booking can be neither **created** nor **confirmed** unless the trip's
> route carries a configured fare. **Null is no fare, and zero is not a
> price** — `baseFareMinor <= 0` refuses with a message telling the rider to
> check back.

The gate holds at both doors: booking creation
(`passenger-operations.service.ts:163`) and confirmation — re-checked inside
the confirming transaction, so a fare unset *after* the request still refuses
(`passenger-operations.service.ts:394-396`). Rider browse marks each
departure `fareConfigured` so the UI can say so up front
(`passenger-operations.service.ts:133`).

`baseFareMinor` is configuration an operator may enter on their own route
(`packages/validation/src/passenger.ts:138`) — like a hub's fees, it is
their commercial declaration, not the platform's invention. Nothing anywhere
quotes, computes or charges an amount from it.

---

## 4. Fleet affiliation — mutual consent

A driver staffs an operator's departure only if they are in that operator's
fleet, and a fleet is joined **only by mutual consent**: an operator may
*invite* (driver must accept) or a driver may *request* (operator must
approve). Neither side can reach an active affiliation alone — the whole rule
lives in `apps/api/src/passenger/passenger-affiliation.service.ts` (class
comment), and the migration that introduced it records the ruling verbatim
(`packages/database/prisma/migrations/20261104090000_passenger_fleet_affiliation_consent/`).

What the code guarantees, with the line to check:

- **Acceptance is the only place in the whole API** that sets
  `PassengerDriverProfile.providerProfileId` — the operational pointer the
  staffing rule reads — and it does so in the same transaction, conditionally,
  so a driver can never land in two fleets
  (`passenger-affiliation.service.ts:232`, `activate()`).
- **One live ask per pair, in either direction**, is a database fact, not
  just a service check: a partial unique index refuses twin pending asks that
  race past the pre-check
  (`packages/database/prisma/migrations/20261104093000_one_pending_ask_per_pair/`;
  the service converts the collision into the ordinary refusal,
  `passenger-affiliation.service.ts:417`). The second asker answers the
  existing ask with the proper verb instead.
- **Ending is unilateral** — consent creates the relationship, either side
  dissolves it. Departures already staffed stay staffed; only *new* staffing
  refuses (`passenger-affiliation.service.ts:322`, `end()`).
- **No one consents on someone else's behalf, admin included.** There is no
  admin affiliation mutation route; moderation sees affiliations through the
  driver detail (`admin-passenger.service.ts:52`).
- The affiliation row is **deliberately terms-free** — no commission, split
  or employment term — and the schema comment on `PassengerFleetAffiliation`
  explains why that is load-bearing for the consent design and what must be
  re-opened if a commercial field is ever added. Read it before touching that
  model.

Both halves are on screen. The driver's dashboard card answers invitations,
sends join requests and leaves a fleet
(`apps/web/components/passenger-driver/FleetCard.tsx`); the operator's roster
card invites, approves, declines and removes
(`passenger-operator/FleetRosterCard.tsx`). Both render consent visibly — a
pending ask says which side it is waiting on, and neither UI offers a party
an answer to their own ask (the server refuses in plain words if the UI is
ever wrong — both headers say so).

---

## 5. Booking a seat

The rider surface is `CUSTOMER`-gated and scoped throughout to the caller's
own side of the simulation boundary (`passenger-rider.controller.ts`).

**Browse.** `GET passenger/departures` lists upcoming, bookable departures:
`SCHEDULED`/`ASSIGNED`, future-dated, active route, active operator, the
rider's own `isTest` side (`passenger-operations.service.ts:85-95`).

**Request.** `POST passenger/bookings` creates a `REQUESTED` booking for a
seat count — after the fare gate, a duplicate-booking check, and the
self-service invariant on **user id, as always**: the person assigned to
drive a departure cannot ride it (`passenger-operations.service.ts:165-176`).
A request holds no seat.

**Confirm.** The operator (or an admin) confirms
(`passenger-network.controller.ts` / `admin-passenger-network.controller.ts:128`).
Confirmation is the moment a seat is actually held, and it **fails closed
three ways**: no configured fare, no assigned vehicle (capacity unknowable),
or not enough seats left — with the capacity sum run under a row lock on the
trip so concurrent confirmations serialize instead of overselling
(`passenger-operations.service.ts:378-407`).

**Cancel.** A rider cancels their own booking; the operator and admin can
cancel any booking on their trips, attributed by party
(`cancelBooking`, `passenger-operations.service.ts:439`). Once a departure
has begun, bookings on it can no longer be cancelled — with one deliberate
exception: a rider may **always withdraw their own unanswered `REQUESTED`
booking**, even after the departure left or completed, because it holds no
seat and would otherwise sit in their list forever
(`passenger-operations.service.ts:449-457`, and the open question it
preserves is recorded right there in the comment).

**Completion.** Completing a trip completes its `CONFIRMED` bookings with it;
`REQUESTED` ones are deliberately left untouched (same comment — what an
unanswered request *becomes* is undecided).

---

## 6. Staffing and movement

**Assignment is manual** — there is no automatic dispatch for passengers
(the delivery lesson, `passenger-operations.service.ts:488`, the `assignTrip`
comment).
The operator (or admin) assigns a driver and vehicle to one departure
(`POST passenger/provider/trips/:id/assign`,
`admin-passenger-network.controller.ts:117`). On the operator's web
Departures page the staffing control offers the fleet's ACCEPTED drivers and
its usable vehicles, shows every server refusal verbatim, and with nobody in
the roster does not render at all — the row says why instead
(`apps/web/components/passenger-operator/DeparturesManager.tsx`, header
comment).

The gates, in order (`passenger-operations.service.ts:500-560`):

- Only an unstaffed `SCHEDULED` departure can be assigned — there is **no
  reassignment path**, which is itself a guarantee: staffing cannot be
  silently swapped.
- The driver must exist, be active, be on the trip's side of the test
  boundary, hold an **APPROVED `PASSENGER_DRIVER` role — re-checked live at
  staffing time**, and belong to the operator's own fleet
  (`driver.providerProfileId !== trip.providerProfileId` refuses — this is
  what affiliation exists to set).
- The driver must not be **booked as a passenger** on the very trip they
  would drive (`passenger-operations.service.ts:529` — the self-delivery
  invariant, matched on user id).
- The vehicle must be approved, on the right side of the boundary, and
  either the operator's own or the assigned driver's own.
- **Capacity is snapshotted at assignment** (`seatCapacity` copied from the
  vehicle) — it is what confirmations sell; and an audited
  `PassengerTripAssignment` row records who staffed what.

**Movement** belongs to the assigned driver
(`passenger-driver-trips.controller.ts`): `POST :id/start` takes an
`ASSIGNED` trip to `IN_PROGRESS`; `POST :id/complete` takes `IN_PROGRESS` to
`COMPLETED`, completing confirmed bookings and closing the assignment row in
the same transaction, and incrementing the driver's completed-trip count
(`passenger-operations.service.ts:301-340`).

**Cancellation** of a departure is allowed from `SCHEDULED` and `ASSIGNED`
only — anything in progress "is people on a vehicle, and that is not a
cancellation, it is an exception" (`passenger-network.service.ts:441`,
`cancelTrip`). Riders on the departure are cancelled *with* it, attributed to
the same party, and the staffing record is closed truthfully.

---

## 7. The simulation boundary

Passenger rows carry `isTest` on every model that matters (profiles,
vehicles, routes, trips, bookings, affiliations), and the flag is **derived
server-side, never accepted from a request**:

- A rider's bookings and browse results are scoped to their own account's
  flag (`passenger-operations.service.ts:87`, `:151`).
- An affiliation may only join two profiles on the same side, re-verified at
  the moment of consent (`passenger-affiliation.service.ts`, `activate()`).
- Staffing refuses a driver or vehicle from the other side
  (`passenger-operations.service.ts:513`, `:543`).
- Admin test-mode flips re-derive an account's dependent rows and **refuse**
  while the account has open trips or an ACCEPTED affiliation — the guards
  run inside the flip transaction after the profile-row lock, so a flip
  cannot race a consent into a cross-boundary link
  (`admin-passenger.service.ts`, both `setTestMode` variants).

---

## 8. What is not built — do not infer capability from silence

Declared in the schema or visible in the UI, but **not product behaviour
today**. Do not describe any of these as working.

- **No on-demand flow.** `PassengerTripKind.ON_DEMAND` has no writer; every
  creatable trip is `SCHEDULED`. The request flow, its timing and its
  expiry semantics are undecided (`passenger-operations.service.ts:40`).
- **`NO_SHOW` and `EXPIRED` bookings are unreachable.** The enum values
  exist; nothing sets them. Who may declare a no-show, and when an
  unanswered request expires, are open product questions — recorded in the
  code where they bite (`passenger-operations.service.ts:439`, comment).
- **`PENDING_ASSIGNMENT`, `EN_ROUTE_TO_PICKUP` and `EXCEPTION` trips are
  unreachable** — reserved vocabulary with no writers.
- **Unanswered fleet asks never expire** (BMPL-61, with the owner). A
  pending invitation or request lives until answered or withdrawn;
  acceptance re-checks everything that matters, but time itself is not
  re-checked.
- **No rider web surface.** Browsing departures and booking seats is
  API-only today; no page in `apps/web` renders it.
- **No passenger payments of any kind** — no fare charged, no commission, no
  cancellation fee, no wallet movement. See the money note at the top and
  `CLAUDE.md` §8.
- **No live GPS tracking, no timetable calendar** — the platform-wide rule
  (`CLAUDE.md` §5) applies here too.

---

## 9. Known gaps as of 2026-09-05

- **Production configuration is empty.** No provider, route, departure or
  fare exists in production. Everything in §§2-6 is exercised by the
  integration suite (`apps/api/test/passenger-*.integration.spec.ts`) and
  usable the moment a real operator is onboarded and declares a network —
  that onboarding is a business step, not an engineering one.
- **A suspended operator can still create routes and trips** via the S2
  surfaces (`providerOf` there does not check `isActive`); the results are
  invisible and unbookable to riders, so there is no rider exposure — but
  the asymmetry with the affiliation and booking surfaces (which do check)
  is real. Known, low severity.
- **The rider is the one persona without a web surface.** Driver, operator
  and admin flows are all on screen (including fleet consent and staffing,
  since `fc84f86`); a rider can act only through the API.

When you close one of these, update this section in the same change.

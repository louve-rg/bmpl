# Edward requirements matrix

The owner's list of Edward's production-UAT requirements — twelve items — is
the authority here, not the kanban card set. This document is numbered on
that list; card ids appear as supporting evidence, not as the spine.

**Requirement 12 was never carded, and that absence is itself a finding.** A
cross-cutting dependency-mapping pass (kanban card BMPL-185) audited the
schema and the shipping service in 2026-09-25 and split the batch into cards
— but it produced only eleven, BMPL-174 through BMPL-184, one per
requirement 1–11. Requirement 12 (multi-leg ETA, material ETA-change
notification, terminal hold/reroute, and carrier schedule date exceptions)
never got a card of its own; only its last slice, carrier schedule date
exceptions, was ever built, and it shipped folded into BMPL-184, where it
reads as part of requirement 11. Counting the cards and counting the owner's
requirements gave two different totals, and the gap between them is exactly
how an entire requirement went unbuilt without anyone noticing — a
requirement with no card is invisible to every process this floor runs.
Recorded properly now as BMPL-340.

**The rule this document follows:** every status below is a claim about the
code, and those are the sentences that rot. Every row marked **Done** names
the commit that makes it true, and every one of those commits was checked
with `git merge-base --is-ancestor` against `origin/main` before being
written down — not taken from a PR title or a card's own claim. Where the
classification this document was built from said "done" and no commit could
be found, the entry below says what was actually found instead — see
requirement 1's history for an example of that happening the other way (a
card believed open turned out to already be shipped).

## Status summary

| # | Requirement | Status | Evidence |
| - | --- | --- | --- |
| 1 | Vendor location-level inventory & fulfilment origin | **Design approved, not built** | BMPL-175. No commit — no branch exists yet. |
| 2 | Package pickup/handoff photo | **Done (API)** | `682b501` (PR #127) |
| 3 | Recipient account linking & incoming-shipment tracking | **Blocked, unmerged** | PR #135 open; no commit on `main` |
| 4 | Granular driver service areas (district → city) | **Done** | `3950db0` (PR #126) |
| 5 | Operating hours & closed/soon-closing handling | **Mostly done, one piece open** | `056b709`, `e498765`, `c2d1b0a`, `a072971`; remainder on BMPL-338 |
| 6 | Handoff-chain security & an end-to-end walk test | **Security fix done; walk test open** | `6676d68` (PR #117); BMPL-337 in progress |
| 7 | Courier & vehicle identification once assigned | **Done** | `a4fb20d` (PR #119); phone exclusion also confirmed at `expectedAtHub` by BMPL-247 |
| 8 | Expandable maps & A/B/C/D route stops (pre-acceptance) | **Mostly done, one check open** | `4eac6e8` (PR #121), `c99a596` (PR #129); BMPL-338 checking map precision |
| 9 | Saved addresses — label, CRUD, default, delete-safety | **Done** | `c4b9f2b` (PR #122); default and delete-safety re-verified directly against source, see below |
| 10 | Cancellation before custody, failed delivery, return-to-sender | **Blocked** | Pre-custody half already correct in shipped code; the rest is designed, nothing built |
| 11 | Recipient availability windows & updates | **Mostly done, one piece open** | `056b709`, `e498765`, `c2d1b0a`, `42d658f`; see below for what's missing |
| 12 | Multi-leg ETA, material ETA-change notice, terminal hold/reroute, carrier schedule exceptions | **Never carded until today; not started except one slice** | Schedule-exceptions slice only: `fcc3592`, folded into BMPL-184. Everything else: BMPL-340, no branch |

---

## 1. Vendor location-level inventory & fulfilment origin

**Status: design approved 2026-09-30, nothing built.** `VendorLocation` already
exists (label, address, district, lat/long, `isPrimary`); inventory is keyed
on product/variant only, with no location dimension, and `VendorOrder` has no
field recording which location fulfilled it.

The design (argued from the code, not assumed): a new child table keyed on
`inventoryId` + `locationId`, with the existing `Inventory` row kept as the
identity/settings anchor, so every product that never adopts a location keeps
working unchanged. Origin selection is availability-only, with
`VendorLocation.isPrimary` as the tie-break — `DeliveryPricingService.quote()`
carries no `locationId` and does no routing, so anything claiming to pick the
"most efficient" origin would be inventing a capability that doesn't exist.
Historical orders get `originLocationId` **null, permanently** — there is no
way to recover which location fulfilled a past order, and guessing one would
put a fabricated fact in the record. A one-location vendor experiences
nothing different.

The owner authorized proceeding on 2026-09-30 (checked against
[`OWNER-RULINGS.md`](./OWNER-RULINGS.md) first — nothing there contradicts
it). **No branch exists yet.**

## 2. Package pickup/handoff photo

**Status: done, API only.** Merged `682b501` (PR #127). Reuses
`ShipmentLeg.handoffPhotoKeys` (already private storage keys, already
unused) rather than inventing a second image concept.

Verified directly against `apps/api/src/shipping/shipment.service.ts` and
`shipment-driver.service.ts` for this matrix (god's own read-only check,
requested alongside this document): `pickupPhotoUrls` reaches exactly three
audiences —

- the **sender**, via `track()` → `serialize()`, gated on
  `shipment.customerUserId === viewer.userId`;
- **staff**, via the same `serialize()`, behind the existing
  `logistics.read`/`operate`/`manage` route decorators;
- the **assigned courier**, on their own leg only, via `getJob()` →
  `ownedLeg()`, gated on `leg.assignedDriverProfileId === profileId`.

`trackPublic()` — the anonymous, unauthenticated tracking-link view — is a
hand-built allowlist that never calls `serialize()` and has no photo field at
all, so an anonymous link holder cannot reach a photo. This matches
[Ruling 7](./OWNER-RULINGS.md#ruling-7--who-can-see-a-pickuphandoff-photo)
exactly for the three audiences that exist today.

**What remains:** the owner approved recipient access to the photo in
principle (Ruling 7), but there is no "recipient" audience to grant it to —
that depends on requirement 3 landing first.

## 3. Recipient account linking & incoming-shipment tracking

**Status: blocked, unmerged.** PR #135 is built and independently reviewed —
`recipientUserId`/`recipientClaimedAt`, a claim endpoint on its own
controller so it doesn't inherit the public tracking route's decorator, a
strict throttle, keyed on the token alone (never on a reference, id, or
`destinationEmail`/`destinationPhone` match, to avoid an account-lookup
oracle) — but it does not merge as designed.

[Ruling 12](./OWNER-RULINGS.md#ruling-12--a-tracking-token-proves-possession-not-identity)
eliminates the claim policy the PR shipped: "first authenticated claimant
wins" is exactly the position the ruling rejects, since claiming is an
authorization-granting act keyed on nothing but possession of the link. Two
narrower options remain (require a matching contact signal, or have the
sender confirm the claim) and the choice is the owner's.

Confirmed for this matrix: `trackAsRecipient` and `listIncoming` do not exist
anywhere in `apps/api/src` on `origin/main` — they exist only on the
unmerged branch.

## 4. Granular driver service areas (district → city)

**Status: done.** Merged `3950db0` (PR #126). `DriverServiceArea` stayed
completely unchanged; a new `DriverServiceCity` table
(`driverProfileId`, `district`, `city`, `isActive`, composite FK cascading
from the district row) carries the finer grain. An empty city set for a
district means "serves the whole district" — the same thing every existing
row has always meant — so no row needed a migration decision.

Consumed by dispatch matching in BMPL-194 (exact-match `sameCity`, documented
in [`DISPATCH.md`](./DISPATCH.md)).

## 5. Operating hours & closed/soon-closing handling

**Status: mostly done.** The **terminal half** is complete end to end:
structured hub hours and dated exceptions, the write surface, and a
consumer that actually defers dispatch outside hours and self-corrects
(shipped ahead of this matrix — see [`PROJECT_STATUS.md`](./PROJECT_STATUS.md)
§12). The **business (vendor) half** — dispatch reading `VendorOpeningHours`
and deferring a marketplace pickup while the vendor is closed — merged
`a072971` (PR #248). A customer-facing "closed now" badge merged separately
(BMPL-335, BMPL-334 for one-off closures).

**What remains:** Edward's specific ask — a warning that a location **may
close before arrival** — is not built. Inputs exist (the structured week, the
exception rows, the pre-transaction delivery estimate); the copy constraint
is that hours constrain dispatch, they don't block ordering, so the warning
must never imply the order can't be placed, and no configured hours must mean
no warning at all. In progress on BMPL-338.

## 6. Handoff-chain security & an end-to-end walk test

**Status: security fix done and live; the walk test is open.** The defect —
a handoff code alone released a shipment, with no check that the
authenticated actor was the currently assigned courier — is fixed. Merged
`6676d68` (PR #117): `verifyHandoffPin` now resolves the actor's
`DriverProfile` and folds a wrong-courier result into the same failure path
as a wrong code, sharing the attempt counter, so neither can be distinguished
from the other. A terminal-to-terminal leg (`LINE_HAUL`) never carries
`assignedDriverProfileId`, so the new check is a correct no-op there rather
than a second custody-code requirement the owner never asked for.

**What remains:** the individual pieces (`startLeg`, `departLeg`, `arriveLeg`,
`completeLeg`, `verifyHandoffPin`, `appendCustody`,
`flagException`/`resolveException`, `pinFor()`) are each unit-tested, but no
single test walks a whole multi-leg journey through all of them at once —
in progress on BMPL-337. That card also carries a second question: whether
BMPL-138 (a San Pedro → Belize City leg stuck unable to mark departed) is a
code defect or missing carrier schedule configuration.

## 7. Courier & vehicle identification once assigned

**Status: done.** Merged `a4fb20d` (PR #119). Reuses the existing
privacy-scoped `driverSummary()` shape and the moderated `publicAvatarUrl()`
(not the unmoderated verification-document photo). Deliberately omits phone,
legal name, licence, registration and insurance — confirmed by an
independent review reading the exact Prisma select, not the PR's own
description of it. The owner separately ruled (2026-09-26) that a private
account phone must never be exposed as a customer-contact number; what
already shipped matches the ruling exactly, so no change was needed. The same
boundary was independently enforced on the courier's own side by BMPL-247,
which removed `DriverProfile.phone` from `ShipmentService.expectedAtHub()`'s
selection entirely — not filtered from the response, absent from the query.
The unbuilt piece — a dedicated business contact number, explicitly
distinguished from a private one — is its own open card, BMPL-201.

## 8. Expandable maps & A/B/C/D route stops (pre-acceptance)

**Status: mostly done.** Merged `4eac6e8` (PR #121) — a reusable
embedded-preview → expand → full-screen modal pattern, verified to touch none
of the residential-privacy-sensitive files it was excluded from and to
introduce no new coordinate source. Merged `c99a596` (PR #129) — the driver
endpoint now walks every leg of the shipment and returns every real stop
(sender door, each hub the shipment actually routes through, recipient
door), so a multi-hub journey can reach its real A-to-D length instead of
being capped at two points; independently re-verified that a first-mile
driver still sees nothing about the recipient door beyond city/district, and
vice versa for last-mile.

A real-browser mobile audit (2026-09-26, Chromium, touch-emulated, at two
viewport sizes) confirmed the modal, zoom, select and scroll-lock all work
against a real four-stop journey. One item was explicitly **not** certified:
a synthetic touch-drag pan did not move the map, but the same context panned
correctly under mouse events and a plain desktop context panned correctly
under touch — the auditor named this an inference about headless pointer-event
emulation, not a claimed defect, and asked for a ten-second check on a real
phone. Not yet done.

**What remains:** BMPL-338 is separately re-checking the privacy half —
that pre-acceptance stops send only approximate positions, never exact
coordinates, reduced before the value leaves the API rather than merely
drawn coarsely on the client.

## 9. Saved addresses — label, CRUD, default, delete-safety

**Status: done.** `SavedAddress` (label, full contact fields, address,
district, lat/long, `isDefault`) plus API CRUD existed before this batch; the
audit (merged `c4b9f2b`, PR #122) found the real gap was in the **web app**,
which only ever called the read endpoint for the checkout dropdown — create,
edit, delete and the star/favourite affordance did not exist in the UI at
all. Closed by wiring the existing components, with duplicate detection
keyed on `savedAddressId` (identity) and never on display-name text, plus a
cross-user negative test (a forged edit/delete on another account's address
returns 404 with the target row untouched).

[Ruling 8](./OWNER-RULINGS.md#ruling-8--saved-addresses) requires both a
preferred/default address and that deletion never alters a historical
snapshot. Re-verified directly for this matrix, against the actual source
rather than the PR's own description:

- **Default exists and is maintained as a genuine singleton.**
  `SavedAddress.isDefault` (`packages/database/prisma/schema.prisma:2585`).
  `AddressesService.create`/`update` (`apps/api/src/addresses/addresses.service.ts`)
  clear every other default in the same transaction before setting a new one;
  `remove()` promotes the next-most-recently-updated address to default if the
  deleted one held it, so the book is never left with no default at all.
- **Deletion cannot touch a historical order or shipment, structurally, not
  just by policy.** `SavedAddress` has no relation to `Order`, `VendorOrder`
  or `Shipment` anywhere in the schema — `grep`-confirmed. `Shipment` carries
  its own inline `originAddress`/`destinationAddress` fields
  (`schema.prisma:4894`, `:4909`); checkout copies address data at the time of
  the order rather than storing a foreign key back to the address book. There
  is nothing a delete could cascade into, because nothing points at the
  address book from an order in the first place.

**What remains (flagged by the audit, not required by ruling 8):** no
standalone "manage my addresses" page, and no way to change which address is
default except by deleting the current one.

## 10. Cancellation before custody, failed delivery, return-to-sender

**Status: blocked on two owner decisions; nothing built for the open half.**
The custody boundary itself — a courier *accepting* a job is not the same as
*custody* — was already correct in shipped code before this card existed:
`ShipmentService.cancel()` blocks once a leg reaches `IN_PROGRESS`, set only
by `startLeg()`, which appends custody in the same call. PR #115's
marketplace-side cancellation window is independently correct for the same
reason and needed no change.

Failed delivery and return-to-sender are designed but **zero code has been
written**: the `EXCEPTION` state and `flagException`/`resolveException`
already exist and are the right mechanism to extend rather than duplicate,
but the *trigger* — any signal that a delivery attempt failed — does not
exist anywhere; today a failed attempt only enters the system if staff hear
about it and type it in by hand, and `DeliveryStatus` has no `FAILED` value.
The charge path needs nothing new (`PaymentsService.createForShipment` is
already charge-shown-before-confirmation), but there is no way today to quote
a return leg "from wherever this parcel currently sits, back to the sender."

**What remains, both genuinely the owner's:** who may initiate a return
(staff-mediated vs. sender-direct), and the return-leg price. No branch
exists.

## 11. Recipient availability windows & updates

**Status: mostly done, one piece open.**

**Done:**
- **Sender-entered shipment availability windows**, end to end: the child
  table and sender write surface (`056b709`, PR #209), dispatch actually
  reading them with symmetric `FIRST_MILE`/`LAST_MILE`/`DIRECT` handling and
  correct overnight-window support (`e498765`, PR #214), and the sender-facing
  UI (`c2d1b0a`, PR #218).
- **Customer-facing requested travel date** — `42d658f` (PR #244): a customer
  can choose a travel date, the system searches the real planner forward up
  to fourteen days for a serviceable date rather than inventing one, and
  degrades honestly to "could not confirm a date" when the configured
  schedule can't support the request.

**Not built:**
- **Recipient-side self-service on availability windows.** Re-verified
  directly for this matrix: `setAvailabilityWindows`
  (`apps/api/src/shipping/shipment.service.ts:1728`) gates the **entire**
  call on `shipment.customerUserId === actor.userId` before it even looks at
  which role's window is being set — so today only the sender can set a
  window for *either* role, including the recipient's own.
  [Ruling 11](./OWNER-RULINGS.md#ruling-11--recipient-availability-and-eta-changes)
  says recipients may provide or update one. This is not a silent
  contradiction of the ruling: the code that shipped this (BMPL-288) states
  in its own card notes that recipient self-service is deliberately
  deferred, because there is no way to authenticate a "recipient" at all
  without requirement 3 (recipient account linking) landing first. It
  resolves the moment requirement 3 does.

## 12. Multi-leg ETA, material ETA-change notice, terminal hold/reroute, carrier schedule exceptions

**Status: not started, except one slice — and this requirement never had a
card until BMPL-340 was opened today.**

Four distinct pieces, per the owner's original requirement, none of them
built except the last:

- **A multi-leg ETA derived only from actually configured schedules,
  operating hours, exceptions and current shipment state** — never a guess,
  a map service, or an invented average. **Does not exist.** Confirmed by
  search: `transportMinutes` (`shipment.service.ts:179`) is a quote-time
  planner total produced once at booking, not a live, updating ETA. The rest
  of the codebase is explicit about the same absence rather than silent
  about it — `dispatch.module.ts`'s own module comment states "NO
  GPS/tracking/routing/ETA/…", `delivery.pricing.ts` documents "NO routing,
  geocoding, ETA-from-maps, or dispatch", and the one driver-facing route
  estimate that exists (`driver-jobs.service.ts`) carries its own comment,
  "Never presented as a live ETA — there is no traffic data behind it."
- **Material ETA-change notification, on the owner's already-approved
  30-minute threshold** ([Ruling 11](./OWNER-RULINGS.md#ruling-11--recipient-availability-and-eta-changes)).
  **Does not exist.** There is no ETA-change event in the notification
  catalog, and — see above — nothing computes an ETA to change in the first
  place.
- **Terminal hold / reroute / return for a recipient known to be
  unavailable.** **Does not exist.** No status represents it. Adjacent to
  requirement 10 but proactive (before dispatch reaches the recipient)
  rather than reactive (after a failed delivery attempt).
- **Date-specific carrier schedule exceptions.** **The one slice that is
  done** — `RouteOperatingDay` + `RouteScheduleException` (BMPL-186, merged
  `fcc3592`) already provide the weekly default and date-specific overrides,
  found by audit rather than built again. It shipped and is documented under
  BMPL-184 because that is the card the audit was run against — a card
  boundary, not a requirement boundary; it belongs here on the owner's own
  list.

**Why this matters more than a missing row:** this requirement was never
carded by the BMPL-185 dependency-mapping pass that produced BMPL-174
through BMPL-184, so no agent was ever assigned to build it, no PR was ever
expected against it, and nothing on any board flagged it as outstanding. It
surfaced only because this document counted the owner's requirements
independently of the card set and the two totals disagreed. Tracked now as
BMPL-340, queued behind requirement 1 (BMPL-175).

---

*Sources: kanban cards BMPL-174 through BMPL-190, BMPL-201, BMPL-247,
BMPL-283 through BMPL-288, BMPL-337, BMPL-338, BMPL-340, and the owner
rulings in [`OWNER-RULINGS.md`](./OWNER-RULINGS.md). Every commit cited above
was confirmed to be an ancestor of `origin/main` before this document was
written. If a status here and a dependent card's own notes ever disagree,
the code — not either document — is the tiebreaker.*

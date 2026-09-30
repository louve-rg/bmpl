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
never got a card of its own until this document's own count disagreed with
the card set; its last slice, carrier schedule date exceptions, had already
shipped as BMPL-186 (`fcc3592`) but was tracked/audited under BMPL-184,
where it reads as part of requirement 11 — see requirement 12 below for how
the two cards relate. The gap between the two totals is exactly how an
entire requirement went unbuilt without anyone noticing — a requirement with
no card is invisible to
every process this floor runs. Recorded properly now as BMPL-340, which has
since shipped its multi-leg-ETA slice (`f1bbfce`); two of the requirement's
four pieces are done, two remain open as BMPL-345 and BMPL-343 — see
requirement 12 below.

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
| 5 | Operating hours & closed/soon-closing handling | **Done** | `056b709`, `e498765`, `c2d1b0a`, `a072971`, `1161a6f` (PR #255) |
| 6 | Handoff-chain security & an end-to-end walk test | **Security fix done; walk test open** | `6676d68` (PR #117); BMPL-337 in progress |
| 7 | Courier & vehicle identification once assigned | **Done** | `a4fb20d` (PR #119); phone exclusion also confirmed at `expectedAtHub` by BMPL-247 |
| 8 | Expandable maps & A/B/C/D route stops (pre-acceptance) | **Done** | `4eac6e8` (PR #121), `c99a596` (PR #129), `1161a6f` (PR #255) |
| 9 | Saved addresses — label, CRUD, default, delete-safety | **Done** | `c4b9f2b` (PR #122); default and delete-safety re-verified directly against source, see below |
| 10 | Cancellation before custody, failed delivery, return-to-sender | **Blocked** | Pre-custody half already correct in shipped code; the rest is designed, nothing built |
| 11 | Recipient availability windows & updates | **Mostly done, one piece open** | `056b709`, `e498765`, `c2d1b0a`, `42d658f`; see below for what's missing |
| 12 | Multi-leg ETA, material ETA-change notice, terminal hold/reroute, carrier schedule exceptions | **Two of four pieces done** | ETA: `f1bbfce` (BMPL-340 phase 1), with its one gap (nothing wrote a LINE_HAUL leg's own scheduled time) closed by BMPL-346. Schedule exceptions: `fcc3592`, which names BMPL-186 (the build); tracked/audited under BMPL-184, the card the audit was run against — see requirement 12 below for how the two relate. Open: ETA-change notice (BMPL-345), hold/reroute (BMPL-343) |

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

**Status: done.** The **terminal half** is complete end to end: structured
hub hours and dated exceptions, the write surface, and a consumer that
actually defers dispatch outside hours and self-corrects (shipped ahead of
this matrix — see [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) §12). The
**business (vendor) half** — dispatch reading `VendorOpeningHours` and
deferring a marketplace pickup while the vendor is closed — merged `a072971`
(PR #248). A customer-facing "closed now" badge merged separately (BMPL-335,
BMPL-334 for one-off closures).

Edward's specific remaining ask — a warning that a location **may close
before arrival** — merged `1161a6f` (PR #255, confirmed an ancestor of
`origin/main`). The checkout delivery quote now carries each DELIVERY
vendor's `openingHours`/`hoursExceptions` (documented in
[`docs/openapi/marketplace.yaml`](./openapi/marketplace.yaml) as this same
change — see `DeliveryQuoteVendor`), and the web client composes the warning
client-side from that data plus the vendor's own configured delivery
estimate, never a second server-side calculation or an invented promise.
Matches the closed-badge's own rule: no configured hours means no warning at
all, and the warning never implies the order can't be placed.

## 6. Handoff-chain security & an end-to-end walk test

**Status: done.** The defect — a handoff code alone released a shipment,
with no check that the authenticated actor was the currently assigned
courier — is fixed. Merged `6676d68` (PR #117): `verifyHandoffPin` now
resolves the actor's `DriverProfile` and folds a wrong-courier result into
the same failure path as a wrong code, sharing the attempt counter, so
neither can be distinguished from the other. A terminal-to-terminal leg
(`LINE_HAUL`) never carries `assignedDriverProfileId`, so the new check is a
correct no-op there rather than a second custody-code requirement the owner
never asked for.

The walk test (BMPL-337) is merged: one integration test books a
`DOOR_TO_DOOR` shipment and drives it through `FIRST_MILE` → `LINE_HAUL` →
`LAST_MILE` to `DELIVERED`, asserting at every handoff that a non-assigned
courier is refused, a wrong PIN is refused and counted on the shared
lockout counter, exactly one custody row is written per real transfer (and
none for a rejected attempt or a bare arrival stamp), and the PIN never
leaks into a response that shouldn't carry it — not the courier's own job
view, not the staff admin view, not the public tracking link.
`apps/api/test/transport-leg-operations.integration.spec.ts`.

BMPL-138 (a San Pedro → Belize City leg stuck unable to mark departed) was
traced end to end — route/leg creation, schedule resolution, carrier vs.
staff authorization, the admin UI's `controlsFor()` — with no code defect
found. A second test in the same file proves what the code does when a
route is genuinely configured `NOT_OPERATING` for a day: `departLeg` refuses
with the schedule reason and recovers once the exception is removed. That
makes a data/configuration fact (a schedule exception, or a route never
configured for that day) or an account-permission issue the more likely
explanation than a bug — but the four facts originally asked of Edward
(shipment reference, leg rows, account grants, screen used) were never
answered and remain the concrete next step. No schedule data was invented
to reproduce his exact live case.

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

**Status: done.** Merged `4eac6e8` (PR #121) — a reusable
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

The remaining pieces merged `1161a6f` (PR #255, confirmed an ancestor of
`origin/main`). The privacy half was checked, not assumed, before anything
was built: the pre-acceptance A/B/C/D job maps already reduce a door-end pin
to `null` at the API select before acceptance, and the driver job list's own
serializer never puts coordinates on the wire at all — no leak found, so no
API change was needed for it. The real remaining gap was `LocationPicker`,
which had no way to place a pin outside a fixed 256px box; it now opens the
same picker full-screen inside `FullScreenMapModal` on request, as two
independent Leaflet instances that are never both mounted at once (the
existing `ExpandableRouteMap`/`MapPreview` pattern). Confirmed for this
matrix: every file this commit touches for requirement 8 is under
`apps/web` — no API file changed, so no OpenAPI spec update was needed for
this half either.

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

**Status: in progress — two of four pieces now done, and this requirement
never had a card until BMPL-340 was opened.**

Four distinct pieces, per the owner's original requirement:

- **A multi-leg ETA derived only from actually configured schedules,
  operating hours, exceptions and current shipment state** — never a guess,
  a map service, or an invented average. **Done (`f1bbfce`, BMPL-340 phase
  1).** `estimateShipmentEta` (`packages/shared/src/shipment-eta.ts`) walks a
  shipment's live legs, anchoring each to a carrier's own scheduled
  commitment, a terminal's configured hours, or a sender/recipient
  availability window — never a fabricated timetable — and reports `UNKNOWN`
  rather than guess the moment nothing configured can anchor a leg. Exposed
  as `eta` on every tracking payload: customer/staff (`ShipmentView`, full
  per-leg detail) and the public/recipient views (`RecipientTrackingView` —
  `trackPublic`, `trackAsRecipient`, `listIncoming` — journey-level
  confidence + arrival only). Documented in `docs/openapi/shipping.yaml`
  (`EtaConfidence`, `ShipmentEta`, `ShipmentLegEta`). The one real gap this
  phase left, found and reported rather than built around, is now also
  closed: nothing anywhere wrote a `LINE_HAUL` leg's own
  `scheduledDepartureAt`/`scheduledArrivalAt`, so a multi-hub shipment's
  overall ETA read `UNKNOWN` even though its `FIRST_MILE`/`LAST_MILE` legs
  resolved correctly. **Done (BMPL-346)**: `ShipmentService.scheduleLeg` is
  the writer — established first that nothing configured could be derived
  instead (`LogisticsRoute.scheduleNote` is a free-text label by its own
  field comment; `PassengerTrip`'s own departure time is populated the same
  operator-typed way) — reachable by the admin desk (`logistics.operate`)
  and by the carrier's own organization (`assertMyLeg`), LINE_HAUL only, on
  a positive allow-list of eligible leg statuses rather than the existing
  transition machinery, since a carrier's fixed sailing time is knowable
  before an earlier leg has even started.
- **Material ETA-change notification, on the owner's already-approved
  30-minute threshold** ([Ruling 11](./OWNER-RULINGS.md#ruling-11--recipient-availability-and-eta-changes)).
  **Does not exist.** Split out as BMPL-345 (needs a persisted previous-ETA
  value to compare against and hasn't been built).
- **Terminal hold / reroute / return for a recipient known to be
  unavailable.** **Does not exist.** No status represents it. Adjacent to
  requirement 10 but proactive (before dispatch reaches the recipient)
  rather than reactive (after a failed delivery attempt). Tracked as
  BMPL-343.
- **Date-specific carrier schedule exceptions.** **The one slice that is
  done** — `RouteOperatingDay` + `RouteScheduleException` (BMPL-186, merged
  `fcc3592`) already provide the weekly default and date-specific overrides,
  found by audit rather than built again. It shipped and is documented under
  BMPL-184 because that is the card the audit was run against — a card
  boundary, not a requirement boundary; it belongs here on the owner's own
  list.

**Why this mattered more than a missing row:** this requirement was never
carded by the BMPL-185 dependency-mapping pass that produced BMPL-174
through BMPL-184, so no agent was ever assigned to build it, no PR was ever
expected against it, and nothing on any board flagged it as outstanding. It
surfaced only because this document counted the owner's requirements
independently of the card set and the two totals disagreed. The first piece
above is the corrective work; the remaining two pieces stay open, tracked
as BMPL-345 and BMPL-343.

The contract above exists in the repository. Whether a given commit is
currently deployed is a question this document does not answer — a served
commit is a fact that changes with the next deploy, and this document
cannot hold that current; asking a running-API source (e.g.
`pnpm deploy:status`) is the only way to actually know.

---

*Sources: kanban cards BMPL-174 through BMPL-190, BMPL-201, BMPL-247,
BMPL-283 through BMPL-288, BMPL-337, BMPL-338, BMPL-340, BMPL-343, BMPL-345,
BMPL-346, and the owner rulings in [`OWNER-RULINGS.md`](./OWNER-RULINGS.md).
Every commit cited above was confirmed to be an ancestor of `origin/main`
before this document was written. If a status here and a dependent card's
own notes ever disagree, the code — not either document — is the
tiebreaker.*

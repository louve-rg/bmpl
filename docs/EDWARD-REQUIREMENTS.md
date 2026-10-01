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
since shipped its multi-leg-ETA slice (`f1bbfce`); every one of the
requirement's four pieces has a merged API as of `7ff34a1` (hold/reroute,
BMPL-343, merged while this very document was being corrected), and the one
remaining gap as of that commit is a staff screen for hold/reroute, in an
open PR (#278) — see requirement 12 below.

**The rule this document follows:** every status below is a claim about the
code, and those are the sentences that rot. Every row marked **Done** names
the commit that makes it true, and every one of those commits was checked
with `git merge-base --is-ancestor` against `origin/main` before being
written down — not taken from a PR title or a card's own claim. Where the
classification this document was built from said "done" and no commit could
be found, the entry below says what was actually found instead — see
requirement 1's history for an example of that happening the other way (a
card believed open turned out to already be shipped). That second direction
is the harder one to catch: every review of this document all evening looked
for a claim of more than the code delivers; nobody was looking for the
opposite until a final-acceptance audit checked cards against rows directly
and found it on requirements 1, 3 and 11 at once.

## Status summary

| # | Requirement | Status | Evidence |
| - | --- | --- | --- |
| 1 | Vendor location-level inventory & fulfilment origin | **Done as of `74cbcd6`** | `bad7b3f` (BMPL-175, PR #259) for the API; UI landed `74cbcd6` (BMPL-354, PR #273) |
| 2 | Package pickup/handoff photo | **Done for sender, staff and courier as of `a568d6a`; recipient access still not wired as of `a568d6a`** | `682b501` (PR #127) for the API; UI landed `a568d6a` (BMPL-352, PR #270) — courier upload, sender and staff view |
| 3 | Recipient account linking & incoming-shipment tracking | **Done** | `a6b7d97` (BMPL-179, PR #135); two policy questions open (BMPL-119), see below |
| 4 | Granular driver service areas (district → city) | **End-to-end as of `2cbcf73`** | `3950db0` (PR #126) for the API; city picker landed `99e98c1` (BMPL-353, PR #272); wired to the lane-town endpoint by `2cbcf73` (BMPL-368, PR #279) — a lane-only town (e.g. Ladyville) is selectable as of `2cbcf73` |
| 5 | Operating hours & closed/soon-closing handling | **Done** | `056b709`, `e498765`, `c2d1b0a`, `a072971`, `1161a6f` (PR #255) |
| 6 | Handoff-chain security & an end-to-end walk test | **Done** | `6676d68` (PR #117); walk test `cbc6765` (BMPL-337, PR #257) |
| 7 | Courier & vehicle identification once assigned | **Done** | `a4fb20d` (PR #119); phone exclusion also confirmed at `expectedAtHub` by BMPL-247 |
| 8 | Expandable maps & A/B/C/D route stops (pre-acceptance) | **Done** | `4eac6e8` (PR #121), `c99a596` (PR #129), `1161a6f` (PR #255) |
| 9 | Saved addresses — label, CRUD, default, delete-safety | **Done** | `c4b9f2b` (PR #122); default and delete-safety re-verified directly against source, see below |
| 10 | Cancellation before custody, failed delivery, return-to-sender | **No longer owner-blocked as of `f8f89dd`; return-to-sender shipped API-only as of `f8f89dd`; failed delivery unbuilt as of `f8f89dd`** | Pre-custody half already correct in shipped code; return-to-sender (non-vendor courier) landed `f8f89dd` (BMPL-183/343, PR #271) once the owner ruled on price and who may initiate; no staff screen as of `f8f89dd` (one is in open PR #278, alongside hold/reroute); failed-delivery trigger does not exist as of `f8f89dd` |
| 11 | Recipient availability windows & updates | **Done** | `056b709`, `e498765`, `c2d1b0a`, `42d658f`, `a6b7d97` (BMPL-179), `a6f81bb` (BMPL-344) |
| 12 | Multi-leg ETA, material ETA-change notice, terminal hold/reroute, carrier schedule exceptions | **API done on all four as of `7ff34a1`; staff screen pending for one as of `7ff34a1`** | ETA: `f1bbfce` (BMPL-340 phase 1), with its one gap (nothing wrote a LINE_HAUL leg's own scheduled time) closed by BMPL-346. ETA-change notice: `e7ef2ed` (BMPL-345). Schedule exceptions: `fcc3592`, which names BMPL-186 (the build); tracked/audited under BMPL-184, the card the audit was run against — see requirement 12 below for how the two relate. Hold/reroute: `7ff34a1` (BMPL-343, PR #275) — API-only as of `7ff34a1`; the staff screen is in an open PR, #278, not merged as of `7ff34a1` |

**Three of twelve — requirements 1, 2 and 4 — shared one cause, not three
separate ones: each had a real, merged, tested API and no user-facing
screen at all,** confirmed for each by diffing its own merge commit for
`apps/web`/`apps/admin` files (`bad7b3f`, `682b501`, `3950db0` — every one
touched zero) rather than inferring it from the commit message. This batch
was built API-first, and the web half of all three was never scheduled — not
blocked on a decision, not attempted and abandoned.

**Update: all three have since shipped their UI.** Requirement 1's landed
whole as of `74cbcd6` (BMPL-354). Requirement 2's landed for every audience
except the recipient as of `a568d6a` (BMPL-352). Requirement 4's landed as
of `99e98c1` (BMPL-353) and became end-to-end as of `2cbcf73` (BMPL-368,
PR #279) — a lane-only town is selectable as of that commit. The original
finding — why there were three isolated API-only rows at once — is unchanged
by these follow-ups landing; it is why each was carded rather than fixed
quietly, and the cards are what let this update happen at all.

**A pattern worth naming, not just this one update:** seven pull requests
landed on `main` during the single editing pass that produced this table,
and one of this table's own prior claims (requirement 12's hold/reroute)
went stale while it was being written, caught only by re-checking before
reporting back. A present-tense status claim on a floor that merges this
fast is not a mistake waiting to happen — it is a certainty waiting to
happen, silently, with nothing marking it. That is why every status above
is now anchored to the commit it was true as of, not stated as a bare
present tense: a reader who sees a commit a hundred merges old knows to go
and check; a reader who sees "is done" believes it without checking
anything. Anchoring is what keeps this document honest without someone
rewriting it every hour.

---

## 1. Vendor location-level inventory & fulfilment origin

**Status: done as of `74cbcd6`.** Merged `bad7b3f` (BMPL-175, PR #259) —
`packages/database/prisma/migrations/20261104170800_vendor_location_inventory`.
A new child table (`inventory_locations`: `inventoryId` + `locationId` FKs,
`quantity`/`reserved`) lets a vendor with multiple `VendorLocation`s track
stock per shop, with the existing `Inventory` row kept as the identity/
settings anchor — a product that never adopts per-location tracking is
completely unaffected (zero child rows, byte-identical behaviour). Checkout
chooses the fulfilling location by availability only, with
`VendorLocation.isPrimary` then `createdAt` as the two-level tie-break
(`chooseLocation()`, `bad7b3f`) — `DeliveryPricingService.quote()`
carries no `locationId` and does no routing, so anything claiming to pick the
"most efficient" origin would be inventing a capability that doesn't exist —
and records it on the new nullable `VendorOrder.originLocationId`, reserving/
releasing/finalizing against that location's own row through the same
lock-then-check-then-write discipline as the existing product-level
reservation path (BMPL-256), never a second way to reserve. Historical orders
get `originLocationId` **null, permanently** — there is no way to recover
which location fulfilled a past order, and guessing one would put a
fabricated fact in the record. A one-location vendor experiences nothing
different. Every other direct reader of raw `Inventory.quantity`/`.reserved`
was updated to honour per-location adoption in the same PR (cart add/view,
the public product and variant pages, the vendor's own inventory and
variant-management views, and the search/listing raw SQL), so the feature
does not go stale in six other call sites the moment a vendor actually
adopts it. A `VendorLocation` cannot be deleted while any of its rows still
carries a reservation, tested for both the refusal and the reservation's
survival.

One narrow question was split off rather than answered silently: when a
single vendor's cart splits across two origin locations, the delivery fee
and free-delivery threshold are evaluated per resulting order rather than
pooled — real, configured rates, nothing invented, but it does change what a
customer pays, so it went to the owner as its own question rather than
riding through on this merge. Now tracked as BMPL-351, open.

**The UI gap closed.** `bad7b3f` itself touched zero files under `apps/web`
or `apps/admin` — 13 files, all `apps/api` plus `packages/database` plus one
integration spec — and for a time there was no vendor screen to set stock
per location and no admin screen to see which location fulfilled a
`VendorOrder`, tracked as BMPL-354. That shipped as `74cbcd6` (PR #273):
the vendor's existing product-level inventory editor (`VariantCard`'s
`InventoryField`) now carries a "Stock by location" breakdown against the
same location-scoped endpoints `bad7b3f` already exposed — no parallel
inventory system, no API change needed. The single shared
`shapeVendorOrder()` now also serializes `originLocation: {id, label}`,
reaching all three audiences that read it — the customer's own order, the
owning vendor's, and admin's — shown as "Fulfilled from <location>"; a
historical order with no recorded origin reads as `null`, never an error.

**History:** this requirement was carried as "design approved, nothing
built" through this document's original writing (BMPL-339); BMPL-175
shipped in the same evening without the matrix being told. A first
correction pass (this same final-acceptance audit) swung the row straight to
"Done," which was also wrong at the time — the code delivered the API, not
the requirement, and neither extreme described what had actually shipped.
`74cbcd6` is what makes "Done" correct now.

## 2. Package pickup/handoff photo

**Status: done for sender, staff and courier as of `a568d6a`. Recipient
access is the one piece still open as of `a568d6a`.** Merged `682b501`
(PR #127) for the API, and `a568d6a`
(BMPL-352, PR #270) for the web surface — matching exactly the three
audiences the API already granted: a courier can upload from
`/dashboard/driver/shipping/[id]` (an "add" control shown only while nothing
is attached yet, since `confirmPickupPhoto` replaces the photo set wholesale
on every call and the read side never returns the underlying keys, so a
second session has no way to merge into a first without risking a silent
overwrite); the sender sees a thumbnail grid on
`/dashboard/shipments/[reference]` (`ShipmentJourney`'s `LegRow`); staff see
the same treatment on `/dashboard/logistics/[reference]`. Reuses
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
principle (Ruling 7). Requirement 3 has since landed, so a real "recipient"
audience now exists — but nothing has wired `pickupPhotoUrls` into
`trackAsRecipient`/`listIncoming`/`trackPublic` for it, and `a568d6a`'s own
commit message names this gap directly rather than guessing past it. Sender,
staff and courier screens are now done. No card names this specific
recipient-wiring gap as of this writing — reported plainly rather than
inventing a number for it.

## 3. Recipient account linking & incoming-shipment tracking

**Status: done, as Edward asked for it.** Merged `a6b7d97` (BMPL-179, PR
#135) — `packages/database/prisma/migrations/20261104170000_shipment_recipient_link_audit`,
`20261104180000_shipment_recipient_link`,
`20261104190000_shipment_recipient_claim_failed_audit`. `recipientUserId`/
`recipientClaimedAt` record a deliberate, authenticated claim
(`POST /shipping/track/{token}/claim`) against the existing `recipientToken`
capability link, on its own controller so it doesn't inherit the public
tracking route's `@Public()`. The shipped claim policy is the one
[Ruling 12](./OWNER-RULINGS.md#ruling-12--a-tracking-token-proves-possession-not-identity)
requires, not the one an earlier draft of this PR carried: a claim succeeds
only when the caller's own account email or phone (normalized, already on
file) matches the shipment's `destinationEmail`/`destinationPhone` —
possession of the token alone is never sufficient. A failed match is
rate-limited per shipment (5 attempts, counted on the shipment itself so it
cannot be laundered by registering a fresh account) and audited; a repeat
claim by the same account answers identically to the first success. Refuses
across the `isTest` boundary. `trackAsRecipient` and `listIncoming` exist and
are reached with the exact same allowlisted payload the anonymous link
already returns — linking changes WHERE the view can be read from, never
WHAT is in it.

**This is the requirement as Edward asked for it, delivered. Two further
policy questions widen it and remain open — they are not missing pieces of
what was asked, and a reader should not conclude the requirement is
incomplete or that nothing is outstanding.** Card BMPL-119 (blocked), split
out when the base tracking link shipped:

- May BML text or email a recipient their tracking link using contact
  details the sender supplied, when that person never gave BML their own
  details? Deliberately not answered by Ruling 11's ETA-change-notification
  language — "notify affected users" is not permission to initiate contact
  with someone who never signed up, and the owner explicitly said not to
  stretch it.
- Should shipments booked before the tracking column existed get links
  back-issued, or only new ones?

Both are the owner's to answer and neither blocks anything shipping today.

## 4. Granular driver service areas (district → city)

**Status: end-to-end as of `2cbcf73`.** Merged `3950db0` (PR #126) — `apps/api/src/driver/driver.controller.ts`,
`driver.service.ts` and an integration spec only, zero `apps/web`/`apps/admin`
files. `DriverServiceArea` stayed completely unchanged; a new
`DriverServiceCity` table (`driverProfileId`, `district`, `city`,
`isActive`, composite FK cascading from the district row) carries the finer
grain. An empty city set for a district means "serves the whole district" —
the same thing every existing row has always meant — so no row needed a
migration decision.

Consumed by dispatch matching in BMPL-194 (exact-match `sameCity`, documented
in [`DISPATCH.md`](./DISPATCH.md)) — so the matching logic is genuinely
live, not dormant.

**The UI landed, then became end-to-end.** `99e98c1` (BMPL-353, PR #272)
extends the existing district picker (`ServiceAreasSection.tsx`) rather
than adding a second service-area editor: each saved district gets an
optional town picker, with an empty selection still meaning "the whole
district," unchanged. A driver can narrow a district to specific towns
from the real screen, and dispatch matching benefits for real.

At `99e98c1`, the picker's town options came from `GET /shipping/hubs`,
the public hub list — so a courier-lane-only town with no hub of its own
(Ladyville is the named case) was deliberately not offered, by the same
"lanes are never shown to anyone as a service" convention admin's own
courier-lanes screen follows. A new endpoint,
`GET /driver/service-areas/:district/cities` (`a032771`, BMPL-365/360, PR
#277), served hub towns merged with every lane-reachable town for the
district, but the picker was not yet updated to call it.

**Closed as of `2cbcf73`** (BMPL-368, PR #279): `ServiceAreasSection.tsx`
now calls the driver-scoped `GET /driver/service-areas/:district/cities`
endpoint directly, and no hub-feed call remains in the file (confirmed by
reading the merged source directly, not the PR title) — a driver whose
real service area is a lane-only town can select it from the real screen
as of this commit.

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

**Status: no longer owner-blocked as of `f8f89dd`; return-to-sender
shipped API-only as of `f8f89dd`; failed delivery still entirely unbuilt
as of `f8f89dd`.** The custody boundary itself — a
courier *accepting* a job is not the same as *custody* — was already
correct in shipped code before this card existed:
`ShipmentService.cancel()` blocks once a leg reaches `IN_PROGRESS`, set only
by `startLeg()`, which appends custody in the same call. PR #115's
marketplace-side cancellation window is independently correct for the same
reason and needed no change.

**The two owner decisions this row was blocked on have been made and
shipped**, as `f8f89dd` (BMPL-183/343, PR #271): once a courier has taken
custody of a non-vendor package, a return to sender is a **new** transport
service, priced with BML's own normal configured pricing for that return
movement (`previewReturn()`/`returnToSender()` reuse `quote()` reversed —
zero new pricing logic, recomputed fresh at confirmation, never trusted from
a prior preview) — calculated, shown, explicitly confirmed, then charged
through the existing payment path, never a silent reversal of the original
charge. Who may initiate: the charge-creating confirmation requires
`logistics.manage` and there is no customer-facing route anywhere in this
codebase for it — staff-mediated, not sender-direct. Scope fence: non-vendor
courier shipments only; a marketplace shipment is refused outright. If no
valid price can be calculated, the return stays `PENDING_MANUAL` rather than
guessing. **No staff screen exists as of `f8f89dd`** — that commit is
API-only (8 files, all `apps/api`/`packages/database`); one is being built
in an open PR (#278, covering both this and hold/reroute together), not
yet merged.

Failed delivery remains **entirely unbuilt as of `f8f89dd`**: the `EXCEPTION` state and
`flagException`/`resolveException` already exist and are the right
mechanism to extend rather than duplicate, but the *trigger* — any signal
that a delivery attempt failed — does not exist anywhere; today a failed
attempt only enters the system if staff hear about it and type it in by
hand, and `DeliveryStatus` has no `FAILED` value. No branch exists for this
half.

**Separately flagged, not fixed here:** [Ruling 1](./OWNER-RULINGS.md#ruling-1--a-courier-accepting-a-job-is-not-custody)
in `OWNER-RULINGS.md` still reads "still open on BMPL-183: who may initiate
a return... and the return-leg price" — that ruling text is itself stale
now that `f8f89dd` has shipped both answers. Reported to god; out of scope
for this edit (one file, five rows).

## 11. Recipient availability windows & updates

**Status: done.**

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
- **Recipient-side self-service on availability windows** — merged `a6f81bb`
  (BMPL-344), the moment requirement 3 (`a6b7d97`, BMPL-179) landed and made
  it possible to authenticate a "recipient" at all, exactly as this
  requirement's history below predicted. `setAvailabilityWindows` now scopes
  its delete to `{shipmentId, role IN allowedRoles}` rather than replacing
  every role's rows — the sender's own path stays byte-identical (its
  allowed roles are still both), so a recipient write can never erase the
  sender's window. Authorization is `recipientUserId`, set only by
  `claimAsRecipient` and never the token — Ruling 12 held. The recipient's
  write returns a separate, smaller ack shape (reference + their own windows
  only), never the full sender-facing view. Delivery *location* — Ruling
  11's "where policy permits" — is correctly still not built; no card claims
  otherwise.

**History:** until this landed, this row read "mostly done, one piece
open," and its own text already said the open piece would resolve the
moment requirement 3 did — requirement 3 merged in the same evening and the
row was not updated until this final-acceptance audit checked it directly.

## 12. Multi-leg ETA, material ETA-change notice, terminal hold/reroute, carrier schedule exceptions

**Status: every piece has a merged API as of `7ff34a1`; one still has no
staff screen as of `7ff34a1`. This requirement never had a card until
BMPL-340 was opened.**

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
  **Done (`e7ef2ed`, BMPL-345).** The threshold is env-configurable
  (`SHIPMENT_ETA_CHANGE_THRESHOLD_MINUTES`, default 30) rather than
  hard-coded. The previous ETA is persisted on `Shipment.etaBaselineAt`,
  compare-and-set via `updateMany` keyed on the old value so a restart,
  redeploy or second worker can never re-notify or double-fire. Wired into
  both real trigger points (every leg transition; `scheduleLeg`'s own
  LINE_HAUL write). Never fires while the new ETA is `UNKNOWN`; establishes
  the baseline silently the first time an ETA becomes knowable; a
  sub-threshold move leaves the baseline alone so several small moves still
  sum against the original reference point. Ships with its migration
  additive and unapplied pending review, per this card's own instruction.
- **Terminal hold / reroute / return for a recipient known to be
  unavailable.** **API done as of `7ff34a1` (BMPL-356/343, PR #275); no
  staff screen as of `7ff34a1`.** Merged after this very edit started — the dispatch that
  requested this correction described it as still unmerged, and it was,
  until it wasn't; re-checked directly rather than trusted from the
  original instruction. Hold needed no new state machine (the existing
  `EXCEPTION`/`flagException` already is one) beyond notifying the
  recipient too, not just staff and the sender, per Ruling 1. `RETURNED`
  is now an honest terminal status (BMPL-356) instead of a return staying
  at `EXCEPTION` forever. Reroute mirrors return-to-sender's architecture
  (requirement 10) — its own new `Shipment`/`Payment`, never a reversal or
  a direct wallet mutation — with three pricing rules: real configured
  pricing shown and confirmed before a charge that increases what the
  customer already paid, `PENDING_MANUAL` when no valid price exists, and a
  scoped notification with no payment dialog when the charge does not
  increase. **No staff screen exists on `main` as of `7ff34a1`** — the
  trigger UI for this and for requirement 10's return-to-sender is one
  coherent panel built in a still-open PR, #278. Do not read this as done
  for a staff user without checking #278's status. Adjacent to
  requirement 10 but proactive (before dispatch reaches
  the recipient) rather than reactive (after a failed delivery attempt).
  Tracked as BMPL-343.
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
independently of the card set and the two totals disagreed. All four
pieces above have a merged API as of `7ff34a1`; the one piece still
missing as of that commit is a staff screen, tracked as BMPL-343 (open
PR #278).

The contract above exists in the repository. Whether a given commit is
currently deployed is a question this document does not answer — a served
commit is a fact that changes with the next deploy, and this document
cannot hold that current; asking a running-API source (e.g.
`pnpm deploy:status`) is the only way to actually know.

---

*Sources: kanban cards BMPL-119, BMPL-174 through BMPL-190, BMPL-201,
BMPL-247, BMPL-283 through BMPL-288, BMPL-337, BMPL-338, BMPL-340, BMPL-343,
BMPL-344, BMPL-345, BMPL-346, BMPL-351, BMPL-352, BMPL-353, BMPL-354,
BMPL-356, BMPL-360, BMPL-364, BMPL-365, BMPL-368, and
the owner rulings in
[`OWNER-RULINGS.md`](./OWNER-RULINGS.md).
Every commit cited above was confirmed to be an ancestor of `origin/main`
before this document was written. If a status here and a dependent card's
own notes ever disagree, the code — not either document — is the
tiebreaker.*

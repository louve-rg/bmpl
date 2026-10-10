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
BMPL-343, merged while this very document was being corrected), and the staff
screen that was the one remaining gap as of `7ff34a1` landed as PR #309
(`5fe37cf`) — as of `effc63e` (re-verified against current `origin/main`,
no change since `e72da60`), every requirement-12 piece has a merged API
and a staff trigger. See requirement 12 below.

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

**Citing a schema.prisma field: name it, don't pin it (MDF-91).** Write the
backtick-wrapped model-and-field name alone, with no trailing colon and
number for the schema line it sits on. `scripts/detect-lookup-inventory-
citation-drift.mjs` checks that form exactly as strongly as a line-pinned
one — it confirms the field is declared inside that model's own block — but
a schema insertion anywhere above the field can no longer make the citation
stale, which is the exact failure PR #293 hit. This applies to schema.prisma
fields specifically; a source-file-and-line citation still needs its line
number, since that script has no model-block equivalent for TypeScript
source.

**"Done" is five different claims, and this document now separates
them.** The owner's own distinction: IMPLEMENTED (the code exists),
TESTED (a test exists that would fail without it, seen to pass),
MERGED (an ancestor of `origin/main` — the anchor every row already
carried), DEPLOYED (an ancestor of the *live* commit, checked with
`git merge-base --is-ancestor` against the live commit, never inferred
from a date or a position in a log — that specific substitution is how a
report went wrong this same evening), and PRODUCTION-VERIFIED (someone
has watched the behaviour work in production and it is recorded
somewhere citable). Each requirement section below has an **Evidence
ladder** stating which rungs it has reached, as of two checked facts:
production web is `3aa35d6` and every commit between it and `origin/main`
touches no `apps/web` file; production API is `9ec6764` and every commit
between it and `origin/main` touches no `apps/api`/`packages` file — so a
MERGED commit touching only one of those two areas is also DEPLOYED.

**A third rung-prover for `apps/admin` exists and this document's first
pass at the ladder missed it.** `https://bmpl-admin.vercel.app/health`
answers `{"status":"ok","commit":"effc63e"}` — confirmed directly, not
taken on report. The route is `apps/admin/app/health/route.ts`, the exact
mirror of the web and API health checks. The same trap applies as the
API's own health check: `https://admin.bzemarketplace.com/health` and
`https://www.bzemarketplace.com/admin/health` both 404 (confirmed) — only
the `vercel.app` host answers. Production admin is therefore `effc63e`,
the current `origin/main` tip — the **most** current of the three
surfaces, not the least. A MERGED commit touching `apps/admin` is
DEPLOYED whenever it is an ancestor of `effc63e`, checked the same way as
the other two.

Most rows still stop at DEPLOYED rather than reaching
PRODUCTION-VERIFIED: that is not a defect in this document, it is the
actual state of a repository where nobody has yet recorded watching most
of this working live.

## Status summary

| # | Requirement | Status | Evidence |
| - | --- | --- | --- |
| 1 | Vendor location-level inventory & fulfilment origin | **Done as of `74cbcd6`** | `bad7b3f` (BMPL-175, PR #259) for the API; UI landed `74cbcd6` (BMPL-354, PR #273) |
| 2 | Package pickup/handoff photo | **Done for sender, staff, courier and linked recipient as of `0c322d6`** | `682b501` (PR #127) for the API; UI landed `a568d6a` (BMPL-352, PR #270) — courier upload, sender and staff view; linked-recipient access landed `66487e4` (PR #304) and `0c322d6` (BMPL-391, PR #305) |
| 3 | Recipient account linking & incoming-shipment tracking | **Done** | `a6b7d97` (BMPL-179, PR #135); two policy questions open (BMPL-119), see below |
| 4 | Granular driver service areas (district → city) | **End-to-end as of `2cbcf73`** | `3950db0` (PR #126) for the API; city picker landed `99e98c1` (BMPL-353, PR #272); wired to the lane-town endpoint by `2cbcf73` (BMPL-368, PR #279) — a lane-only town (e.g. Ladyville) is selectable as of `2cbcf73` |
| 5 | Operating hours & closed/soon-closing handling | **Done** | `056b709`, `e498765`, `c2d1b0a`, `a072971`, `1161a6f` (PR #255); terminal half `699a3e3` (BMPL-262), `4eac6be` (BMPL-271), `b12afb3` (BMPL-273); closed-now badge `0d50de2` (BMPL-335), one-off closures `81ad57f` (BMPL-334) — all five found and added `effc63e`-pass, none cited here before |
| 6 | Handoff-chain security & an end-to-end walk test | **Done** | `6676d68` (PR #117); walk test `cbc6765` (BMPL-337, PR #257) |
| 7 | Courier & vehicle identification once assigned | **Done for the booking customer as of `4d96bb0`; for a linked recipient, messaging is now wired end-to-end (API and web) as of `c7690a5`/`5c11021`, but courier identity is still not shown to the recipient as of `effc63e`** | `a4fb20d` (PR #119); phone exclusion also confirmed at `expectedAtHub` by BMPL-247; messaging wired in `ShipmentJourney.tsx`; recipient messaging API: PR #293 (BMPL-359), merged `910d5b2`; recipient messaging read + UI: PR #315 (`5c11021`) and PR #314 (`c7690a5`); `RECIPIENT_VIEW_INCLUDE` re-checked directly at `effc63e` — still no `assignedDriver`/`assignedVehicle` |
| 8 | Expandable maps & A/B/C/D route stops (pre-acceptance) | **Done for shipping and marketplace delivery, as of `16e4b4b`; whether the requirement was ever meant to cover marketplace's always-two-stop case is unsettled** | `4eac6e8` (PR #121), `c99a596` (PR #129), `1161a6f` (PR #255) for shipping; marketplace's driver job screen wired to the same `ExpandableRouteMap` by `16e4b4b` (BMPL-390, PR #302) — no API change, the pre-acceptance pin gate was already correct |
| 9 | Saved addresses — label, CRUD, default, delete-safety | **Done, and the two gaps this document used to flag as "what remains" are now also closed as of `444a1ec`/`9ec6764`** | `c4b9f2b` (PR #122); default and delete-safety re-verified directly against source, see below; standalone manage page `444a1ec` (PR #323); un-defaulting the current default without a delete `9ec6764` (PR #336) |
| 10 | Cancellation before custody, failed delivery, return-to-sender | **NOT complete as of `effc63e` (re-verified, no change since `e72da60`): the staff-alone charge defect under Ruling 1 (BMPL-375) is fixed; failed delivery is still unbuilt** | Pre-custody half correct in shipped code. Return-to-sender/reroute shipped `f8f89dd` (BMPL-183/343, PR #271) with a staff-alone charge defect, fixed by `0efd970` (BMPL-375, PR #288, merged); negative-control tests PR #285 (`3ea4fa1`) and a sink ownership test PR #306 (`302a84c`) are on main; customer confirmation `e72da60` (PR #308); staff prepare panel `5fe37cf` (PR #309); the fix's own red-team guards now pass under their real names, not a `[RED]` prefix, as of `5b7dd1a` (PR #312); acceptance-is-not-custody now has a named behavioural test as of `d5b1dec` (PR #318). Failed-delivery trigger does not exist as of `effc63e` |
| 11 | Recipient availability windows & updates | **Done** | `056b709`, `e498765`, `c2d1b0a`, `42d658f`, `a6b7d97` (BMPL-179), `a6f81bb` (BMPL-344) |
| 12 | Multi-leg ETA, material ETA-change notice, terminal hold/reroute, carrier schedule exceptions | **API done on all four as of `7ff34a1`; staff triggers for all four as of `effc63e` (re-verified, no change since `e72da60`)** | ETA: `f1bbfce` (BMPL-340 phase 1), with its one gap (nothing wrote a LINE_HAUL leg's own scheduled time) closed by `e56c425` (BMPL-346, found and added `effc63e`-pass; not cited here before). ETA-change notice: `e7ef2ed` (BMPL-345). Schedule exceptions: `fcc3592`, which names BMPL-186 (the build); tracked/audited under BMPL-184, the card the audit was run against — see requirement 12 below for how the two relate. Hold/reroute: `7ff34a1` (BMPL-343, PR #275) — API-only as of `7ff34a1`; the staff screen landed as PR #309 (`5fe37cf`; it replaced the closed PR #278) after `7ff34a1` |

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

**2026-10-10 re-anchor pass:** every commit cited
below was re-checked against `origin/main` at `effc63e` — thirty-three
pull requests landed since `e72da60`, the document's previous newest
anchor (counted via `git log --oneline e72da60..effc63e`, not assumed).
Two rows moved: requirement 7 (the linked recipient's courier-conversation
UI shipped) and requirement 9 (the two gaps the audit had flagged as
"what remains" both closed). Every other row was re-checked and found
unchanged; those anchors are bumped to `effc63e` to record that the check
happened, not because the underlying commit changed. Each requirement
section below also gains an **Acceptance criteria** block — concrete,
checkable steps against what already exists in the repository, not a new
claim about behaviour. The API-side rows most likely to move further
today are pending a parallel validation pass; where that is true it is
noted in the row itself rather than guessed at here.

---

## 1. Vendor location-level inventory & fulfilment origin

**Evidence ladder:**
- IMPLEMENTED: yes — `bad7b3f` (API), `74cbcd6` (UI).
- TESTED: yes, an integration spec shipped in `bad7b3f` itself; not
  independently re-run in this pass.
- MERGED: yes — both an ancestor of `origin/main`.
- DEPLOYED: **yes, all of it, admin included.** `bad7b3f` touches only
  `apps/api`/`packages/database`, within production API currency; `74cbcd6`
  touches `apps/web` and `apps/admin`, both within production currency —
  `apps/admin/health` answers `commit: effc63e`, and `74cbcd6` is an
  ancestor of `effc63e` (checked directly).
- PRODUCTION-VERIFIED: **no record.**

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

**Note for this pass:** Oscar and Jim are currently reproducing
responsive-layout defects that may touch this requirement's screens; no
commit landed against this requirement's files between `e72da60` and
`effc63e` (checked directly), so this section is unchanged pending their
findings.

**Acceptance criteria:** as a vendor with more than one `VendorLocation`,
set stock for a product at a specific location in the inventory editor's
"Stock by location" panel; place an order for it as a customer; confirm the
order shows "Fulfilled from <location>" on the customer, vendor and admin
order views; confirm an order placed before this feature shipped still
shows no origin line (not an error, not a guess). Confirm deleting a
`VendorLocation` that still carries a reservation is refused.

**History:** this requirement was carried as "design approved, nothing
built" through this document's original writing (BMPL-339); BMPL-175
shipped in the same evening without the matrix being told. A first
correction pass (this same final-acceptance audit) swung the row straight to
"Done," which was also wrong at the time — the code delivered the API, not
the requirement, and neither extreme described what had actually shipped.
`74cbcd6` is what makes "Done" correct now.

## 2. Package pickup/handoff photo

**Evidence ladder:**
- IMPLEMENTED: yes — `682b501` (API), `a568d6a` (web, courier/sender/staff),
  `66487e4`/`0c322d6` (recipient access).
- TESTED: yes, named integration coverage shipped with these PRs; not
  independently re-run in this pass.
- MERGED: yes — all four an ancestor of `origin/main`.
- DEPLOYED: **yes.** Every one of these commits touches only `apps/api`
  and/or `apps/web` (confirmed directly, `git show --stat`) — no `apps/admin`
  file in any of them — so both production-currency facts apply in full.
- PRODUCTION-VERIFIED: **no record.**

**Status: done for sender, staff, courier and linked recipient as of
`0c322d6`.** The linked-recipient piece landed as `66487e4` (PR #304) and
`0c322d6` (BMPL-391, PR #305). Merged `682b501`
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
unused) rather than inventing a second image concept. A later fix,
`8841444` (BMPL-189), stopped a re-attached photo from writing a second
pickup-audit row — an audit-log-integrity correction, not a change to
who can see the photo or how upload works.

Verified directly against `apps/api/src/shipping/shipment.service.ts` and
`shipment-driver.service.ts` for this matrix (god's own read-only check,
requested alongside this document): `pickupPhotoUrls` reached three audiences
as of `a568d6a`, and a fourth — the linked recipient — as of `0c322d6`:

- the **sender**, via `track()` → `serialize()`, gated on
  `shipment.customerUserId === viewer.userId`;
- **staff**, via the same `serialize()`, behind the existing
  `logistics.read`/`operate`/`manage` route decorators;
- the **assigned courier**, on their own leg only, via `getJob()` →
  `ownedLeg()`, gated on `leg.assignedDriverProfileId === profileId`;
- the **linked recipient**, via `trackAsRecipient()` and `listIncoming()`,
  which call `attachPickupPhotos()` on the recipient view (`shipment.service.ts`).

`trackPublic()` — the anonymous, unauthenticated tracking-link view — does not
call `attachPickupPhotos()` and has no photo field, so an anonymous link holder
cannot reach a photo. This matches
[Ruling 7](./OWNER-RULINGS.md#ruling-7--who-can-see-a-pickuphandoff-photo).

**What remains:** nothing for this requirement as of `0c322d6`. Every audience
Ruling 7 names is wired.

**Acceptance criteria:** as the assigned courier, upload a pickup photo
from `/dashboard/driver/shipping/[id]`; confirm the sender sees it on
`/dashboard/shipments/[reference]`, staff see it on
`/dashboard/logistics/[reference]`, and a linked recipient sees it on
their incoming-shipment view. Confirm the anonymous `/track/[token]` link
shows no photo and no photo field at all. Confirm re-uploading a photo for
the same leg does not create a second pickup-audit row.

**Note for this pass:** Oscar and Jim are currently reproducing
responsive-layout defects that may touch this requirement's screens; no
commit landed against this requirement's files between `e72da60` and
`effc63e` (checked directly), so this section is unchanged pending their
findings.

## 3. Recipient account linking & incoming-shipment tracking

**Evidence ladder:**
- IMPLEMENTED: yes — `a6b7d97` (three migrations plus the claim
  controller/service).
- TESTED: yes, named integration coverage shipped with the PR; not
  independently re-run in this pass.
- MERGED: yes — an ancestor of `origin/main`.
- DEPLOYED: **yes.** Touches `apps/api`, `apps/web`, `packages/database`,
  `packages/shared` only — no `apps/admin` file — both production-currency
  facts apply.
- PRODUCTION-VERIFIED: **no record.** (The two open policy questions,
  BMPL-119, are the owner's to answer and are a separate axis from this
  ladder — a question outstanding does not change what has shipped.)

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

**Acceptance criteria:** from the shipment's own tracking token, call
`POST /shipping/track/{token}/claim` signed in as an account whose own
email/phone matches the shipment's `destinationEmail`/`destinationPhone`;
confirm the claim succeeds and `trackAsRecipient`/`listIncoming` then serve
the shipment from the signed-in account. Confirm a sixth mismatched attempt
on the same shipment is refused independent of which account made it (the
rate limit is per-shipment, not per-account). Confirm an already-claimed
shipment answers an immediate repeat claim by the same account identically
to the first success.

## 4. Granular driver service areas (district → city)

**Evidence ladder:**
- IMPLEMENTED: yes — `3950db0` (API), `99e98c1`/`2cbcf73` (web),
  `a032771` (API, the merged endpoint).
- TESTED: yes, named integration coverage shipped with these PRs; not
  independently re-run in this pass.
- MERGED: yes — all four an ancestor of `origin/main`.
- DEPLOYED: **yes.** Every commit touches only `apps/api` or `apps/web` —
  no `apps/admin` — both production-currency facts apply.
- PRODUCTION-VERIFIED: **no record.**

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

**Note for this pass:** Oscar and Jim are currently reproducing
responsive-layout defects that may touch this requirement's screens; no
commit landed against this requirement's files between `e72da60` and
`effc63e` (checked directly), so this section is unchanged pending their
findings.

**Acceptance criteria:** as a driver, open `ServiceAreasSection.tsx`
(`/dashboard/driver/service-areas`), pick a district with at least one
lane-only town configured (Ladyville is the named case) and confirm it
appears in the town picker and can be saved. Confirm an empty town
selection for a saved district still matches the whole district in
dispatch, not nothing. Confirm a booking to a lane-only town in that
district is offered to a driver who selected it.

## 5. Operating hours & closed/soon-closing handling

**Evidence ladder — for the five commits this row cites (`056b709`,
`e498765`, `c2d1b0a`, `a072971`, `1161a6f`) only:**
- IMPLEMENTED: yes.
- TESTED: yes, named integration coverage shipped with these PRs; not
  independently re-run in this pass.
- MERGED: yes — all five an ancestor of `origin/main`.
- DEPLOYED: **yes.** Every one touches only `apps/api` and/or `apps/web` —
  no `apps/admin` — both production-currency facts apply.
- PRODUCTION-VERIFIED: **no record.**

**Gap closed, 2026-10-10:** the **terminal-half** hub-hours work and the
**closed-now badge** used to be referenced below by card id only, with no
commit SHA anywhere in this document — "shipped ahead of this matrix"
meant exactly that they predated this document's own citation discipline.
Found by `git log --all --grep` for the two badge card ids and by
`git log -S` for the terminal-half's actual schema model name
(`HubOpeningDay`), since no card id was ever written into those messages:

- **Terminal half**, three pieces: the `HubOpeningDay`/`HubHoursException`
  schema, migration and pure resolver is commit `699a3e3` (BMPL-262,
  PR #193, tested in `packages/shared/src/hub-hours.test.ts`); the
  admin-consumed read-only "is this terminal open" endpoint is commit
  `4eac6be` (BMPL-271, PR #198, tested in
  `apps/api/test/hub-hours.integration.spec.ts`); the dispatch consumer
  that actually warns and reschedules around hub hours is commit
  `b12afb3` (BMPL-273, PR #200, tested in
  `apps/api/test/shipment-hub-hours-dispatch.integration.spec.ts`).
- **Closed-now badge** — `0d50de2` (BMPL-335, PR #251, `apps/api`+
  `apps/web`, tested in `apps/api/test/storefront.integration.spec.ts`
  and `apps/web/lib/vendor-hours.test.ts`).
- **One-off closures** (the badge's own BMPL-334 dependency) — `81ad57f`
  (PR #250, `apps/api` only, tested in
  `apps/api/test/vendor-hours-exceptions.integration.spec.ts` and an
  extension of `vendor-hours-dispatch.integration.spec.ts`).

All five are confirmed ancestors of `origin/main`, touch no `apps/admin`
file, and are therefore DEPLOYED under the same web/API facts the rest of
this ladder uses. PRODUCTION-VERIFIED stays **no record** for all five —
finding the commit is not the same claim as watching it work.

**Status: done.** The **terminal half** is complete end to end: structured
hub hours (`699a3e3`, BMPL-262) and dated exceptions (same commit), the
read surface for admin (`4eac6be`, BMPL-271), and a dispatch consumer that
actually defers outside hours and self-corrects (`b12afb3`, BMPL-273) —
shipped ahead of this matrix, which is why none of the three had a commit
cited here until this pass found them. **The "see PROJECT_STATUS.md §12"
pointer this sentence used to carry was itself stale** — that document's
current §12 is unrelated (deployed marketplace-checkout mobile QA), with
no mention of hub hours anywhere in the file; removed rather than left
for a reader to follow into the wrong section. The **business (vendor)
half** — dispatch reading `VendorOpeningHours` and deferring a
marketplace pickup while the vendor is closed — merged `a072971`
(PR #248). A customer-facing "closed now" badge merged separately
(`0d50de2`, BMPL-335, PR #251; one-off closures `81ad57f`, BMPL-334,
PR #250 — both found this pass, see the Evidence ladder above).

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

**Acceptance criteria:** at checkout for a DELIVERY vendor with configured
`VendorOpeningHours`, request a delivery time close enough to closing that
the order could arrive after the vendor shuts; confirm the "may close
before arrival" warning appears and that it never blocks placing the
order. Confirm a vendor with no configured hours shows no warning at all,
not a false negative badge. Confirm an out-of-hours marketplace pickup is
deferred, not dropped, and self-corrects once hours reopen.

## 6. Handoff-chain security & an end-to-end walk test

**Evidence ladder:**
- IMPLEMENTED: yes — `6676d68` (the fix).
- TESTED: yes — `cbc6765` added the walk test
  (`apps/api/test/transport-leg-operations.integration.spec.ts`); seen
  passing as part of CI on the merging PR, not independently re-run in
  this pass.
- MERGED: yes — both commits an ancestor of `origin/main`.
- DEPLOYED: **yes.** Both touch only `apps/api` (`cbc6765`'s only non-test
  file is this document itself) — production-API-current fact applies.
- PRODUCTION-VERIFIED: **no record of the fix itself being watched live.**
  BMPL-138 is a *production incident report* that a specific leg could not
  be marked departed — the trace found no code defect and no schedule data
  was invented to reproduce it, but that is an unresolved report, not a
  confirmation that the fixed behaviour has been observed working. The
  four facts asked of Edward to reproduce his case remain outstanding.

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

**Acceptance criteria:** run
`apps/api/test/transport-leg-operations.integration.spec.ts` and confirm
every assertion named above still holds (wrong courier refused, wrong PIN
counted on the shared lockout, exactly one custody row per real transfer,
no PIN leak to any viewer). BMPL-138 itself is not closed by this — it
stays open until Edward supplies the four facts (shipment reference, leg
rows, account grants, screen used) needed to reproduce his specific case.

## 7. Courier & vehicle identification once assigned

**Evidence ladder — for the booking-customer piece and the recipient
messaging piece that have actually shipped; identity-for-the-recipient has
not implemented, so no ladder applies to it (see below):**
- IMPLEMENTED: yes — `a4fb20d` (booking customer), `910d5b2`/`5c11021`/
  `c7690a5` (recipient messaging, API + web).
- TESTED: yes. Two separate commits added test coverage: `5c11021` added
  `apps/api/test/shipping-messaging.integration.spec.ts` on the API side,
  and `c7690a5` added `RecipientCourierMessage.test.tsx` plus an extension
  of `apps/web/app/track/[token]/page.test.tsx` on the web side; not
  independently re-run in this pass.
- MERGED: yes — all four an ancestor of `origin/main`.
- DEPLOYED: **yes.** Every one of these commits touches only `apps/api`
  and/or `apps/web` (`5c11021` confirmed `apps/api` only; `c7690a5`
  confirmed `apps/web` only) — no `apps/admin` — both
  production-currency facts apply.
- PRODUCTION-VERIFIED: **no record**, for either the booking-customer
  messaging link or the recipient's.

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
**The business-contact-number question is closed, not open.** BMPL-201
closed 2026-10-01 as already satisfied by prior work, with no schema change:
the existing SHIPMENT_LEG/CUSTOMER_DRIVER messaging thread (below) routes
contact through BML rather than through any phone number at all, which
makes the missing personal/business-number distinction moot rather than
blocking. The line above once pointed at BMPL-201 as the unbuilt piece; it
no longer is one.

**Messaging for the booking customer is wired and reachable**: a per-leg
"Message your courier" link appears once a driver has accepted
(`ShipmentJourney.tsx`, gated on a non-null `conversationId` so an
unaccepted leg shows nothing rather than a dead link) — the owner's
instruction that customer-to-courier contact should use BML's existing
per-leg messaging, confirmed wired end-to-end, not just present in the API.

**For the RECIPIENT, when different from the booking customer**, as of
`effc63e`:

- **Messaging landed, API and web both.** PR #293 (BMPL-359, merged
  `910d5b2`) adds a RECIPIENT conversation participant role
  (`packages/shared/src/messaging.ts`, with its migration
  `20261104260000_conversation_participant_role_recipient` on main) and
  opens the per-leg thread to a linked recipient only on LAST_MILE and
  DIRECT legs, the legs that end by delivering to them. The read side —
  `GET /shipping/incoming/:reference/courier-conversation` — landed as PR
  #315 (`5c11021`), and the web entry point (`RecipientCourierMessage.tsx`
  on the incoming-shipment page, rendered only when the API reports an open
  conversation) landed as PR #314 (`c7690a5`). Verified directly: the
  anonymous `/track/[token]` page does not render the entry point and does
  not call the read endpoint. Whether the participant-role migration has
  been applied to production is not established by this document.
- **Courier identity has not landed.** `RECIPIENT_VIEW_INCLUDE`
  (`shipment.service.ts`) selects no assigned driver and no assigned vehicle
  — re-read directly at `effc63e`, unchanged — so a linked recipient still
  sees no courier identity. Nothing in this document claims otherwise.

**Acceptance criteria:** as a linked recipient of a shipment whose
LAST_MILE or DIRECT leg has an assigned, accepted courier, open the
incoming-shipment page and confirm a "Message your courier" entry point
appears and opens a real conversation. Confirm it does not appear before a
courier has accepted. Confirm the same shipment's anonymous tracking link
(`/track/[token]`) shows no such entry point and that the underlying GET
endpoint refuses an unauthenticated caller. Confirm no screen shown to a
linked recipient displays the courier's name, photo or vehicle.

**What would make this row Done for the recipient, precisely:**
`RECIPIENT_VIEW_INCLUDE` would need to select `assignedDriver` through the
same `driverSummary()`/`publicAvatarUrl()` shape already serialized to the
booking customer, wired into the recipient serializer — confirmed to need
no new capability and no schema change. The blocker is not engineering: it
is an unmade product decision on whether a recipient should see courier
identity at all, asked of the owner as `MDF-97` and still unanswered. The
criterion above is written so the row can flip the day that decision
lands, without waiting on a second audit to define what "Done" means.

## 8. Expandable maps & A/B/C/D route stops (pre-acceptance)

**Evidence ladder:**
- IMPLEMENTED: yes — `4eac6e8`, `c99a596`, `1161a6f` (shipping), `16e4b4b`
  (marketplace).
- TESTED: yes, named integration/component coverage shipped with these
  PRs, plus the 2026-09-26 real-browser mobile audit noted below; not
  independently re-run in this pass.
- MERGED: yes — all four an ancestor of `origin/main`.
- DEPLOYED: **yes.** Every one touches only `apps/api` and/or `apps/web` —
  no `apps/admin` — both production-currency facts apply.
- PRODUCTION-VERIFIED: **no record.** The 2026-09-26 mobile audit
  (described below) does not state which environment it ran against —
  not named as production, so not counted as one. The one explicitly
  uncertain item from that audit (a real-phone touch-drag pan) is also
  still open.

**Status: done for both shipping's multi-hub job maps and marketplace
delivery, as of `16e4b4b`.** `apps/web/app/dashboard/driver/jobs/[id]` (the
marketplace delivery driver's own job screen) now reuses `ExpandableRouteMap`
directly via a new `jobMapPoints()` (`lib/driver-job.ts`) that feeds the
existing `tripMapPoints()` — no second map implementation. No API change was
needed: `delivery-core.service.ts` already gated the customer's door pin on
acceptance (`pinnedLocation: null` until `acceptedAt` is set) exactly the
same way shipping's leg pins are gated, so the pre-acceptance privacy half
of this requirement was already correct for marketplace — this closed only
the missing screen. `jobMapPoints()` draws whatever pin it is handed and
never re-checks the gate itself, so a pre-acceptance call naturally yields a
pickup-only pin; it does not duplicate the server's privacy rule in a second
place.

A marketplace delivery always has exactly two stops (pickup, drop-off), so
whether the owner's A/B/C/D requirement was ever meant to cover it at all
remains **unsettled** — nothing quotes Edward on that point either way.
`16e4b4b` answers the engineering question, not the scope question: a
shipped component does not retroactively settle what Edward asked for.

Merged `4eac6e8` (PR #121) — a reusable
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

**Acceptance criteria:** as a driver on a multi-hub shipping job, open the
job's map and confirm it expands full-screen and shows every real stop the
leg actually routes through (not capped at two points), with zoom/scroll
working on both desktop and a real mobile device (the one unresolved item
from the 2026-09-26 audit is a real-phone touch-drag pan check — confirm
that specifically, not just the emulated one). As a marketplace delivery
driver, open a job before the customer has accepted and confirm the
door-end pin is absent, not merely hidden; confirm it appears once
accepted. **Not yet acceptance-testable:** whether a two-stop marketplace
delivery was ever meant to satisfy the A/B/C/D wording — there is no
criterion to write until Edward settles the scope question.

**Note for this pass:** Oscar and Jim are currently reproducing
responsive-layout defects that may touch this requirement's screens; no
commit landed against this requirement's files between `e72da60` and
`effc63e` (checked directly, not inferred), so this section is unchanged
pending their findings.

## 9. Saved addresses — label, CRUD, default, delete-safety

**Evidence ladder:**
- IMPLEMENTED: yes — `c4b9f2b` (web CRUD wiring over pre-existing API),
  `444a1ec` (manage-addresses page), `9ec6764` (un-default-without-delete).
- TESTED: yes, named — `apps/api/test/addresses.integration.spec.ts`
  (extended by `9ec6764`); the cross-user negative test and duplicate-
  detection behaviour are described in this document's body but not
  independently named here.
- MERGED: yes — all three an ancestor of `origin/main`.
- DEPLOYED: **yes.** `c4b9f2b` and `9ec6764` touch only `apps/api`/
  `apps/web`; `444a1ec` touches only `apps/web` — no `apps/admin` in any
  of them — both production-currency facts apply.
- PRODUCTION-VERIFIED: **partial, and attributed, not independently
  re-checked by me.** `board.md` (2026-10-04, Oscar) records that
  `/dashboard/addresses` resolves live behind the login gate after a
  separate navigation change removed it from the public menu — that is
  page *reachability*, not the CRUD/default behaviour itself, which has
  no recorded live observation.

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
  `SavedAddress.isDefault`.
  `AddressesService.create`/`update` (`apps/api/src/addresses/addresses.service.ts`)
  clear every other default in the same transaction before setting a new one;
  `remove()` promotes the next-most-recently-updated address to default if the
  deleted one held it, so the book is never left with no default at all.
- **Deletion cannot touch a historical order or shipment, structurally, not
  just by policy.** `SavedAddress` has no relation to `Order`, `VendorOrder`
  or `Shipment` anywhere in the schema — `grep`-confirmed. `Shipment` carries
  its own inline `originAddress`/`destinationAddress` fields
  (`schema.prisma:5025`, `:5040`); checkout copies address data at the time of
  the order rather than storing a foreign key back to the address book. There
  is nothing a delete could cascade into, because nothing points at the
  address book from an order in the first place.

**What remained (flagged by the audit, not required by Ruling 8) is now
closed.** A standalone manage-addresses page landed as `444a1ec` (PR #323,
nav Favorites > Addresses) — list, add, edit, set default and delete, over
the existing `/addresses` API, reusing checkout's own payload mapping and
`savedAddressSchema` so a save refused here is the same rule the server
applies; editing or deleting changes only that saved row, since no order or
shipment references a saved address. A way to change the default without
deleting the current one landed as `9ec6764` (PR #336): `PATCH
isDefault:false` on the current default promotes the next address, or is
refused outright if it is the only address on the account — verified
directly against `apps/api/src/addresses/addresses.service.ts`, not taken
from the PR title. (This row touches `apps/api`; noted here because it was
found while re-anchoring, not as a substitute for the parallel API-side
validation pass this requirement is also part of.)

**Acceptance criteria:** add two addresses, set one as default, then
`PATCH` the default address to `isDefault:false` and confirm the other
address becomes default automatically. Delete down to one address and
confirm attempting to un-default it is refused rather than leaving the
account with no default. Open `/dashboard` → Favorites → Addresses and
confirm list/add/edit/delete/set-default all work from that page without
going through checkout. Attempt to edit or delete another account's
address by id and confirm a 404 with the target row unchanged.

## 10. Cancellation before custody, failed delivery, return-to-sender

**Evidence ladder — for the shipped pieces only; failed delivery has no
code to ladder at all, see below:**
- IMPLEMENTED: yes, for custody/cancellation (pre-existing,
  `ShipmentService.cancel()`) and for return-to-sender/reroute as fixed
  (`f8f89dd` then `0efd970`).
- TESTED: yes, named —
  `apps/api/test/bmpl-376-wallet-authorization-redteam.integration.spec.ts`
  (`3ea4fa1`, retitled passing by `5b7dd1a`),
  `apps/api/test/bmpl-378-escrow-sink-boundary.integration.spec.ts`
  (`302a84c`), and
  `apps/api/test/shipment-acceptance-and-tracking.integration.spec.ts`
  (`d5b1dec`); not independently re-run in this pass.
- MERGED: yes — `f8f89dd`, `0efd970`, `3ea4fa1`, `302a84c`, `e72da60`,
  `5fe37cf`, `5b7dd1a`, `d5b1dec` all ancestors of `origin/main`.
- DEPLOYED: **yes, all of it, staff panel included.** `f8f89dd`/
  `0efd970`/test commits touch only `apps/api` (plus `packages/*`);
  `e72da60`'s confirmation surface touches only `apps/web`; `5fe37cf`'s
  staff panel touches only `apps/admin` — `apps/admin/health` answers
  `commit: effc63e`, and `5fe37cf` is an ancestor of `effc63e` (checked
  directly). Whether the `20261104250000_shipment_routing_proposal`
  migration itself has been applied to production is, separately, not
  established by this document (stated already in the body below) —
  a schema migration is not something the admin build's own commit
  identity can answer.
- PRODUCTION-VERIFIED: **no record**, for any of the three (cancel,
  return, reroute).

**Failed delivery has no ladder at all:** IMPLEMENTED is already "no" — no
trigger of any kind exists, so TESTED/MERGED/DEPLOYED/PRODUCTION-VERIFIED
do not apply to a thing that was never built. This is the blank the ladder
is supposed to make visible rather than hide behind "NOT complete."

**Status: NOT complete as of `effc63e` (re-verified, no change since
`e72da60`). The staff-alone charge defect under
[Ruling 1](./OWNER-RULINGS.md#ruling-1--a-courier-accepting-a-job-is-not-custody)
(tracked BMPL-375) is fixed on main; failed delivery is still entirely unbuilt.** The custody boundary itself — a
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
charge — **that is the design, and it is not what shipped.** As `f8f89dd`
actually shipped it, the staff confirmation that requires `logistics.manage`
is **also** the thing that charges the customer's wallet, with no customer
route anywhere in this codebase and no customer confirmation step of any
kind. That is the exact shape Ruling 1's further ruling forbids: "staff
action alone must never authorize charging the customer's wallet." It is
not a hypothetical — the API lane confirmed the chain by reading the code
(`reversedReturnInput()` hardcodes `payWithWallet: true`) and the QA lane
reproduced it empirically against `4d96bb0` (a customer wallet moved
83300 → 66600 on return, 83300 → 75800 on reroute, from one staff HTTP call,
no customer involved anywhere). Reroute mirrors return exactly and carries
the identical defect.

**The two-step fix is merged.** PR #288 (`0efd970`, BMPL-375) splits the
staff action into two steps: staff may prepare a return or reroute (a
`ShipmentRoutingProposal` row, nothing charged), and only the shipment's own
customer may confirm it. Confirmation for any other user returns 404, and only
that confirmation step executes the charge. The migration
`20261104250000_shipment_routing_proposal` is on main. Negative-control tests
(PR #285, `3ea4fa1`) and a sink-level ownership test (PR #306, `302a84c`,
carrying the same title as the closed PR #292) are on main too. Whether the
migration has been applied to production is not established by this document.

The fix's own red-team guards, written to fail until #288 shipped, now pass
under their real names: `5b7dd1a` (PR #312) dropped the
`[RED — expected to FAIL today]` prefix from
`bmpl-376-wallet-authorization-redteam.integration.spec.ts` with no change
to the assertions themselves — a passing test still carrying a
fail-expected label reads as expected-to-fail and gets ignored the day it
actually goes red, so the retitle is the thing that makes a future
regression visible. Separately, `d5b1dec` (PR #318) adds a named
behavioural test proving a customer cancelling after acceptance but before
custody gets a full refund with no custody row written, and that the same
cancel after a real custody transfer is refused and refunds nothing.

The customer's confirmation surface landed as `e72da60` (PR #308). The staff
prepare panel landed as `5fe37cf` (PR #309, which replaced the closed PR #278):
it offers return and reroute, and its own header says it prepares and never
charges. This pass read that header and the panel's action list; it did not
re-verify the panel's UI against the two-step design beyond that.

Scope fence: non-vendor courier shipments only; a marketplace shipment is
refused outright. If no valid price can be calculated, the return stays
`PENDING_MANUAL` rather than guessing.

Failed delivery remains **entirely unbuilt as of `effc63e`** (re-checked,
no change since `e72da60`): the `EXCEPTION` state and
`flagException`/`resolveException` already exist and are the right
mechanism to extend rather than duplicate, but the *trigger* — any signal
that a delivery attempt failed — does not exist anywhere; today a failed
attempt only enters the system if staff hear about it and type it in by
hand, and `DeliveryStatus` has no `FAILED` value. A separate path exists for a
locked delivery PIN (`deliveryVerificationStatus` `FAILED`, with an
`ADMIN_FAILED_DELIVERY` notification, `driver-jobs.service.ts`). That records
wrong PIN codes, not a failed attempt, and adds no `DeliveryStatus` value. Whether an open
branch exists for the trigger was not checked in this pass. This is the
piece `MDF-96` has asked the owner about (does he expect the courier
themselves to report a failed attempt, or is the existing staff-exception
workflow what he meant) — unanswered as of this document.

**Acceptance criteria:** confirm `ShipmentService.cancel()` refuses once any
leg reaches `IN_PROGRESS` and succeeds before. For return-to-sender: as the
shipment's own customer, confirm staff "preparing" a return or reroute
creates a `ShipmentRoutingProposal` and charges nothing; confirm only the
shipment's own customer can confirm it (any other account gets 404);
confirm confirming is the only step that executes the charge, at a price
recomputed fresh rather than trusted from the earlier preview. Confirm the
same two behaviours for reroute. Confirm a marketplace (non-courier)
shipment is refused outright for both. **Not acceptance-testable yet:**
failed delivery has no trigger to test against.

## 11. Recipient availability windows & updates

**Evidence ladder:**
- IMPLEMENTED: yes — `056b709`/`e498765` (sender windows, API),
  `c2d1b0a` (sender UI), `42d658f` (customer travel date),
  `a6f81bb` (recipient self-service).
- TESTED: yes, named integration coverage shipped with each of these PRs;
  not independently re-run in this pass.
- MERGED: yes — all five an ancestor of `origin/main`.
- DEPLOYED: **yes.** Every one touches only `apps/api` and/or `apps/web`
  and/or `packages/*` — no `apps/admin` — both production-currency facts
  apply.
- PRODUCTION-VERIFIED: **no record.**

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

**Acceptance criteria:** as a sender, set an availability window on a
shipment and confirm dispatch actually withholds/offers the leg
accordingly for both `FIRST_MILE`/`LAST_MILE` and an overnight window. As a
customer, pick a requested travel date at booking and confirm the system
either returns a real serviceable date from the configured schedule within
fourteen days or an honest "could not confirm a date" — never an invented
date. As a linked recipient (after claiming via requirement 3), write your
own availability window and confirm the sender's own window on the same
shipment is untouched.

## 12. Multi-leg ETA, material ETA-change notice, terminal hold/reroute, carrier schedule exceptions

**Evidence ladder — per piece, since the four pieces do not share one:**
- **Multi-leg ETA** (`f1bbfce`): IMPLEMENTED/MERGED yes, ancestor of
  `origin/main`; touches only `apps/api`/`packages/shared` — DEPLOYED yes.
  TESTED: a test exists per the PR, not independently named here. **The
  gap this phase left, found to have no commit SHA in this document at
  all, now has one:** `git log --all --grep=BMPL-346` found `e56c425`
  (PR #267, `apps/api`/`packages/database`/`packages/shared`/
  `packages/validation`, tested in
  `apps/api/test/carrier-org-access.integration.spec.ts` and an extension
  of `transport-leg-operations.integration.spec.ts`). Ancestor of
  `origin/main`, no `apps/admin` file — DEPLOYED yes.
- **ETA-change notice** (`e7ef2ed`): IMPLEMENTED/MERGED yes, ancestor of
  `origin/main`; touches `apps/api`/`packages/database`/`packages/shared`
  only — DEPLOYED yes. TESTED: a test exists per the PR, not
  independently named here. PRODUCTION-VERIFIED: no record, and its own
  migration ships "additive and unapplied pending review" by the body
  text below — whether it is applied in production is not established.
- **Terminal hold/reroute** (`7ff34a1` API; `5fe37cf` staff screen):
  IMPLEMENTED/MERGED yes, both ancestors of `origin/main`. DEPLOYED:
  **yes, all of it, admin included** — the non-admin files in `7ff34a1`
  are `apps/api`/`packages/*` (production-API-current); `5fe37cf` and the
  admin portion of `7ff34a1` are ancestors of `effc63e`, the live admin
  commit (`apps/admin/health`, checked directly — same commit as
  requirement 10's staff panel). TESTED: a test exists per the PR, not
  independently named here.
- **Carrier schedule exceptions** (`fcc3592`, BMPL-186): IMPLEMENTED/
  MERGED yes, ancestor of `origin/main`. DEPLOYED: **yes, all of it,
  admin included** — the API portion is production-current; the admin
  portion is an ancestor of `effc63e`, the live admin commit (checked
  directly).
- PRODUCTION-VERIFIED, all four pieces: **no record.**

**Status as of `effc63e` (re-verified, no change since `e72da60`): every
piece has a merged API, and every piece has a staff trigger (the
reroute/return panel landed as `5fe37cf`, PR #309). This
requirement never had a card until BMPL-340 was opened.**

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
  resolved correctly. **Done (`e56c425`, BMPL-346)** — found this pass via
  `git log --all --grep=BMPL-346`; no commit was cited here before:
  `ShipmentService.scheduleLeg` is
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
  increase. **Staff triggers as of `effc63e` (re-verified, no change
  since `e72da60`):** reroute and return-to-sender
  are in the admin panel from PR #309 (`5fe37cf`, which replaced the closed
  PR #278); hold uses the existing exception-flag button on the admin
  logistics page (`flagException`,
  `apps/admin/app/dashboard/logistics/[reference]/page.tsx`). Whether that
  button does what requirement 12 asks for hold was not verified in this
  pass. Adjacent to
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
pieces above have a merged API, and as of `effc63e` (re-verified, no change
since `e72da60`) each has a staff trigger.
The staff-screen gap tracked as BMPL-343 closed in `5fe37cf` (PR #309).

**Acceptance criteria:** book a multi-hub shipment and confirm `eta` on the
tracking payload reports a real anchored value once every leg has a
configured schedule/hours/window to anchor to, and `UNKNOWN` (never a
guess) when one does not — including a `LINE_HAUL` leg before
`scheduleLeg` has been called on it. Move a leg's ETA by more than the
configured threshold (`SHIPMENT_ETA_CHANGE_THRESHOLD_MINUTES`, default 30
minutes) and confirm a notification fires exactly once, with a second
sub-threshold move not re-triggering it. As admin, flag an exception on a
leg (`flagException`) and confirm the recipient is notified, not just
staff and the sender. As admin, trigger a reroute/return from the panel
PR #309 added and confirm it only *prepares* — see requirement 10's
acceptance criteria for the charge-side confirmation. Configure a
date-specific `RouteScheduleException` and confirm a route otherwise open
that day is refused with the schedule reason, then confirm it recovers
once the exception is removed.

The contract above exists in the repository. As of this 2026-10-10 pass,
each requirement's Evidence ladder states DEPLOYED where it could be
checked against the two live commits this pass used (web `3aa35d6`, API
`9ec6764`) — but that check is only as current as this document, and a
served commit is a fact that changes with the next deploy. Re-checking it
is cheap (`git merge-base --is-ancestor <commit> <live-commit>`, or
asking a running-API source such as `pnpm deploy:status` directly) and
should be done again before trusting an old DEPLOYED rung, not assumed to
still hold.

**Reserved: UI-defect findings from Oscar and Jim's responsive-layout
audit.** Not yet written — their measurements (375/414/768/1024/1440) are
in progress as of this pass. When routed here, each confirmed defect
touching requirements 1, 2, 4, 7 or 8 will be recorded with who
reproduced it, which commit fixed it, and who re-verified the fix — the
same evidence discipline as the rest of this document, not invented ahead
of the findings.

---

*Sources: kanban cards BMPL-119, BMPL-174 through BMPL-190, BMPL-201,
BMPL-247, BMPL-262, BMPL-271, BMPL-273, BMPL-283 through BMPL-288,
BMPL-334, BMPL-335, BMPL-337, BMPL-338, BMPL-340, BMPL-343,
BMPL-344, BMPL-345, BMPL-346, BMPL-351, BMPL-352, BMPL-353, BMPL-354,
BMPL-356, BMPL-359, BMPL-360, BMPL-364, BMPL-365, BMPL-368, BMPL-375,
BMPL-376, BMPL-378, BMPL-391, hive cards MDF-96 and MDF-97, and
the owner rulings in
[`OWNER-RULINGS.md`](./OWNER-RULINGS.md).
Every commit cited above was confirmed to be an ancestor of `origin/main`
before this document was written. If a status here and a dependent card's
own notes ever disagree, the code — not either document — is the
tiebreaker.*

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

**A third direction, found tonight on requirements 1 and 10 within minutes
of each other: a citation can stay perfectly anchored while the sentence
beside it goes false.** Both scripts this document runs
(`detect-lookup-inventory-citation-drift.mjs`,
`detect-commit-anchor-drift.mjs`) check that a citation still points at
the symbol or commit it names — they say nothing about whether the prose
next to that citation still matches what the code now does. Requirement
10's own "fix(docs)" commits re-anchored four line numbers inside this
document without anyone updating the status claim beside them; requirement
1's "reaching all three audiences" survived an admin-only reality the same
way. Re-anchored is not re-verified, and nothing currently run against this
document can tell the two apart.

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
carried), DEPLOYED (an ancestor of the commit a specific app is actually
*serving right now*, checked with `git merge-base --is-ancestor` against
that app's own live commit, never inferred from a date or a position in
a log — that specific substitution is how a report went wrong one
evening), and PRODUCTION-VERIFIED (someone has watched the behaviour work
in production and it is recorded somewhere citable).

**DEPLOYED is a property of one app, never of `origin/main`.** The three
BMPL apps rebuild and redeploy independently, only when their own
affected paths change — each one can sit on a different commit than the
others, and all three can be, and currently are, behind `origin/main`.
That is not three broken deploys: a PR whose check output literally says
"Vercel - bmpl-admin: Skipped - Not affected" is a PR that correctly
left admin's deployed commit where it was. **A row may only claim
DEPLOYED by naming which app serves the change and which commit that
app is currently on** — "an ancestor of `origin/main`" proves MERGED,
nothing more; main moving forward does not deploy anything by itself.

As of this pass (2026-10-14), the three live facts (each independently
re-checked just now — `curl`'d directly, not taken from a prior report or
from the dispatch that requested this pass, which itself named a now-stale
web commit) are:

- **`apps/api`** is on `1fec2bb` — `https://www.bzemarketplace.com/api/health`
  answers a **live, per-request** read: `status`, `uptime` (seconds since
  process start) and `startedAt` all vary request to request. This is the
  one surface that proves the running process, not just the build.
- **`apps/web`** is on `68d7ff0` (read from the live `X-Bmpl-Commit`
  response header) — **this is `origin/main`'s own current tip**, not merely
  an ancestor of it. Every requirement-related commit on `main` as of this
  pass is therefore DEPLOYED to web right now, with no further ancestor
  check needed for the web side of anything below.
- **`apps/admin`** is on `015d665` — `https://bmpl-admin.vercel.app/health`
  (the same host trap as before: `admin.bzemarketplace.com/health` and
  `www.bzemarketplace.com/admin/health` both 404; only the `vercel.app`
  host answers).

All three new anchors (`1fec2bb`, `68d7ff0`, `015d665`) were confirmed
ancestors of (or equal to) `origin/main`, and the document's previous anchors
(`4936812`, `5b2b0a9`, `effc63e`) were confirmed ancestors of these new ones
— `git merge-base --is-ancestor` both directions — so every DEPLOYED claim
already established in this document under the old anchors transfers forward
unchanged; nothing below needed re-deriving from zero, only re-anchoring.

**web and admin's `commit` field is baked in at build time, not read live
— both route files say so in their own source.** Confirmed directly: the
value cannot be cache-busted, because there is nothing live to bust: it
identifies which *build* is being served, not a running process. Only
`apps/api`'s `/health` is evidence of liveness; `apps/web` and
`apps/admin`'s are evidence of build identity, and should be cited as
exactly that, never as proof a process is up.

A MERGED commit that touches only one app's paths is DEPLOYED once it is
an ancestor of that specific app's live commit above, checked the same
way for all three.

**Tonight's release (2026-10-10/11) measured this thesis directly, rather
than just arguing it — reported by Michael and Pam during the release and
recorded here as given, not independently re-checked by this pass; a
point-in-time production snapshot is not something this document reprobes
after the fact.** A nine-commit release chain landed on `origin/main`
(`4b92c38` → `b96b02e` → `cc2e941` → `b6b436e` → `9b69fa8` → `db9bb52` →
`8e33a82` → `158ec35` → `c4d9855`), and at the moment the release
finished, with nothing failing, each app was serving a different point in
that chain: `apps/web` served `8e33a82` (read from the `X-Bmpl-Commit`
header on `https://www.bzemarketplace.com`), `apps/api` served `db9bb52`
(`/api/health`, `startedAt` `23:15:34.078Z`, `/api/health/ready`
reporting `database: true`, `redis: true`, `storage: ok`), and
`apps/admin` served `9b69fa8`. **Three apps, three different commits,
none equal to `origin/main`'s own `c4d9855`** — at the same moment, with
the release finished and nothing failing. That is this section's own
claim, now a measurement rather than an argument.

**An absent commit status is not an absent deployment, and the two facts
come from two different APIs.** Railway posts no commit status until it
begins a build; the GitHub Deployments API is the one that answers
whether a deployment exists at all, and the commit-status API does not.
For one release commit (`4b92c38`, #358's merge), the Deployment object
existed at `22:48:52Z` — six seconds after the merge — while the commit
status did not appear until `22:58:21Z`, a roughly ten-minute window in
which the deploy was running and invisible to anyone checking commit
status alone. Querying the Deployments API for that same commit is,
separately, what proved four other fast "no deployment needed" answers
that session had created no deployment at all — a check that commit
status alone cannot make.

**An API deploy takes roughly 12–13 minutes trigger-to-running, with the
commit status absent for the first 9–10 — two samples, not a service
level.** #358 took about 12.5 minutes; #354 took 12m44s. Both are observed
points, not a guarantee, and this document treats them as exactly two
data points, no more. **The cause of that duration is not established.**
An earlier claim that it was driven by `pnpm-lock.yaml` invalidating
Railway's cached dependency layer is wrong — #354 touches no lockfile and
took almost the same time — and this document does not substitute a
guessed cause for one that has not been established.

**None of this proves a migration has run — and "not established" alone
undersells what is actually known.** A commit being DEPLOYED proves the
*code* is live; it says nothing about whether a Prisma migration that
commit shipped has actually been applied to the production database.
Nothing external to this repository can observe that — `/health/ready`'s
own database check is a bare `SELECT 1`, which passes whether or not any
particular migration has run. But the repository's own deploy
configuration says what *should* have happened: `railway.json`'s
`preDeployCommand` runs `prisma migrate deploy` unconditionally on every
`apps/api` deploy — applying every migration not yet recorded, with no
mechanism to apply some and skip one in particular — and that deploy is
itself gated by `railway.json`'s own `build.watchPatterns`
(`apps/api/**`, `packages/shared`/`validation`/`database`/
`authentication`/`authorization`/`wallet`/`notifications`, plus the
lockfile and root configs), confirmed directly rather than inferred from
comparing commit values.

So for a migration-bearing commit that is **confirmed an ancestor of the
current live API commit** (checked per commit, the same way DEPLOYED
is), application is the **expected state — and still unverified.**
Expected and observed are not the same claim, and the row says both
halves: unobservable from outside the repository, and expected given the
pipeline. Neither half may be dropped. A row that drops the first and
reads as **"applied"** claims something nobody can observe; a row that
drops the second and reads as plain **"outstanding"** invites a reader to
conclude it probably has not run, when the documented pipeline says the
opposite is expected. "Expected but unverified" is the one phrase between
those two that the evidence actually supports, and it is wrong the same
way a wrong DEPLOYED claim would be if it drifts toward either side. A
commit that is **not** confirmed an ancestor of the live commit does not
earn this phrase at all and keeps a plainer "not established" instead.

Most rows still stop at DEPLOYED rather than reaching
PRODUCTION-VERIFIED: that is not a defect in this document, it is the
actual state of a repository where nobody has yet recorded watching most
of this working live.

**A TESTED rung may cite a test that only runs locally, when that is the
owner's own approved decision, not an accreted default.** PR #351
(`d40e2b7`) found thirty authenticated-dashboard-geometry specs that had
been silently skipping in CI since they were first committed — no seeded
database, no live API, and no `SUPER_ADMIN_EMAIL`/`PASSWORD` exist in the
CI job that runs them, so `test.skip()` fired on all thirty and a skip
reported success exactly like a pass. The fix made that status impossible
to miss rather than hidden: the file is named
`authenticated-dashboard-geometry.local-only.spec.ts`, and every describe
block it contains is prefixed `[LOCAL ONLY, skips in CI — see file
header]`. [Ruling 15](./OWNER-RULINGS.md#ruling-15--authenticated-tests-stay-local-only-for-now)
(2026-10-10): "retain the transparent local-only labels for authenticated
tests for now. Do not build an expensive new authenticated CI environment
without separate approval." **That makes the convention a decided state,
not a gap waiting to be reported as closed.** A TESTED rung that names a
`.local-only.spec.ts` file, or a describe block carrying the
`[LOCAL ONLY, skips in CI]` prefix, should say exactly that — verified
locally, not in CI, and that is the sanctioned state per Ruling 15 —
rather than reading as an uncaught gap. A live authenticated CI environment (a
services block, a seeded database, a running API inside the job) remains
possible, but only on a separate owner approval; nothing in this document
should imply one is pending by default.

## Status summary — unified evidence matrix

**Owner-specified columns, used exactly as named, 2026-10-14.** This replaces
the previous two-table format (a status/evidence summary plus a separate
implemented/accepted table) with one table per the owner's own instruction.
**The owner's rule this table exists to enforce: implementation, testing,
deployment and formal acceptance are four different states, never
collapsed.** "Relevant merged PRs" proves MERGED only. "Local integration
evidence" cites a named test and, where stated, that it was seen to pass —
never inferred from a PR title or description, per the owner's evidence
standard (no PR description, title, or agent summary — this document's own
included — counts as proof on its own). "Production verification" is listed
only where someone has actually watched the behaviour live and recorded it;
most rows say **NO RECORD**, which is the honest, current state of this
repository, not a gap in this table. "Edward acceptance status" is **NOT
ACCEPTED** for every row below, with zero exceptions — see the search
documented above (zero of twelve found anywhere in the hive) — regardless
of what engineering, this team's own QA passes, or this document's own
language elsewhere says.

**Update, 2026-10-15 — Jim's MDF-238 live walk is complete and folded into
every row's "Local integration evidence" cell below, and nothing else.**
Method: real browser/manual + direct API calls + direct Postgres reads
against real fixture accounts on the local stack (`bmpl-jim`, real
Postgres/Redis/MinIO) — not unit tests, and **not production**. 12 of 12
requirements now have at least one live walk (or a verified null-diff
against an earlier one) on record; 0 of 12 have a recorded acceptance from
Edward, unchanged. **This evidence fills "Local integration evidence" only
— it does not touch "Production verification" (unchanged below) or "Edward
acceptance status" (still NOT ACCEPTED, zero exceptions), by Jim's own
explicit statement for all twelve and by this document's standing rule that
the three are never collapsed.** One row (8) still carries an **IN
VERIFICATION** tag, now narrowed by a separate pass (Dwight/QA, MDF-247) to
the single owner/Edward scope question that remains blocked; that same pass
independently resolved requirement 8's other open item (the real-phone
touch-drag question) as a **testing gap, confirmed working**, so it no
longer carries an IN VERIFICATION tag — see row 8 and §8 below.

| # | Exact requirement | Implemented functionality | Relevant merged PRs | Local integration evidence | Production verification where available | Remaining gap or owner decision | Edward acceptance status |
| - | --- | --- | --- | --- | --- | --- | --- |
| 1 | Vendor location-level inventory & fulfilment origin | Per-location inventory derivation (API) and an admin-only "Fulfilled from" display | #259 (`bad7b3f`) API; #273 (`74cbcd6`) admin UI | See §1 below for named tests (carried forward, not re-run this pass); Jim's MDF-238 pass (2026-10-15) did not re-walk this a second time, citing the admin-only live finding already captured above as current | DEPLOYED (api `1fec2bb`, admin `015d665` — both ancestors, transitively via `effc63e`); NO RECORD of a live-behaviour observation | "Fulfilled from" does not appear on the customer's or vendor's own order view — admin-only today | NOT ACCEPTED (no record) |
| 2 | Package pickup/handoff photo | Upload/view for sender, staff, courier and linked recipient | #127 (`682b501`) API; #270 (`a568d6a`) UI; #304/#305 (`66487e4`/`0c322d6`) recipient access | See §2 below for named tests (carried forward, not re-run this pass); **Jim's MDF-238 live walk (2026-10-15): clean** — all four audiences confirmed live (sender sees the real MinIO URL, linked recipient sees the same photo under `steps[].pickupPhotoUrls`, staff via the admin route, anonymous tracking shows none); the one item that had rested only on a named test (re-upload not duplicating the pickup-audit row) was walked live: a second upload grew `handoffPhotoKeys` to 2, the audit row count stayed at 1, same row id both times | DEPLOYED (api+web+admin, all ancestors transitively); NO RECORD of a live-behaviour observation | None open as of this pass | NOT ACCEPTED (no record) |
| 3 | Recipient account linking & incoming-shipment tracking | Linking + `listIncoming` tracking | #135 (`a6b7d97`, BMPL-179) | See §3 below for named tests (carried forward, not re-run this pass); **Jim's MDF-238 live walk (2026-10-15): clean** — a same-`isTest` claim succeeds; a cross-`isTest` claim (real account claiming a test shipment) correctly refuses even with an exact email match, so the `isTest` boundary holds, not just the email check. **The 5-failed-attempt rate limit was not exercised** (named as a time-budget limitation, not a skipped check) | DEPLOYED (api, ancestor transitively); NO RECORD of a live-behaviour observation | Two policy questions open under BMPL-119 — not implementation gaps | NOT ACCEPTED (no record) |
| 4 | Granular driver service areas (district → city) | API + city picker, wired to the lane-town endpoint | #126 (`3950db0`) API; #272 (`99e98c1`) picker; #279 (`2cbcf73`) wiring | See §4 below for named tests (carried forward, not re-run this pass); **Jim's MDF-238 live walk (2026-10-15): clean** — narrowed a real driver to one city, a delivery to a different city sat `PENDING_ASSIGNMENT` through two dispatch sweeps, widened back, same delivery auto-assigned next sweep; both directions proven live and reversible — the live demonstration behind the "service-area, not home-district" hypothesis | DEPLOYED (api+web, ancestors transitively); NO RECORD of a live-behaviour observation | None open as of this pass | NOT ACCEPTED (no record) |
| 5 | Operating hours & closed/soon-closing handling | Vendor-hours dispatch, closing-soon warning, terminal half, closed-now badge, one-off closures | #248/#255/BMPL-262/BMPL-271/BMPL-273/BMPL-335/BMPL-334 (nine commits, see §5) | See §5 below for named tests (carried forward, not re-run this pass); **Jim's MDF-238 live walk (2026-10-15): clean** — closed store shows the real badge, order still placeable while closed (hours gate dispatch, not ordering), reopened store makes the driver eligible again immediately; re-walked after an unrelated PR (#400) touched the same screen, confirming a real DB write (`storeStatus` CLOSED→OPEN, not client-only) before restoring the shared fixture back to CLOSED for other agents' walks | DEPLOYED (api+web, ancestors transitively); NO RECORD of a live-behaviour observation | None open as of this pass | NOT ACCEPTED (no record) |
| 6 | Handoff-chain security & an end-to-end walk test | Handoff-chain security + a named walk test | #117 (`6676d68`); #257 (`cbc6765`, BMPL-337) | `cbc6765`'s own walk test (named in §6); **Jim's MDF-238 live walk (2026-10-15): clean** — wrong PIN refused and counted; a different courier (staff impersonating via the admin route) refused on the same shared `handoffPinAttempts` counter, not a per-actor one; right PIN by the right courier succeeds with the custody count +1 exactly; the PIN never leaks on the driver's own job view, anonymous tracking, or staff's default read, only the dedicated `logistics.verify` endpoint returns it. **Walked live exactly once, by deliberate choice** — nothing since has touched the handoff/lockout code, and the owner explicitly forbade repeating unchanged work | DEPLOYED (api, ancestor transitively); NO RECORD of a live-behaviour observation | None open as of this pass | NOT ACCEPTED (no record) |
| 7 | Courier & vehicle identification once assigned | Identification for the booking customer; recipient messaging wired end-to-end (API+web) | #119 (`a4fb20d`); #293 (`910d5b2`, BMPL-359, API); #314/#315 (`c7690a5`/`5c11021`, UI) | `RECIPIENT_VIEW_INCLUDE` re-checked directly (no `assignedDriver`/`assignedVehicle`) — ruled state, not an unread gap; **Jim's MDF-238 live walk (2026-10-15): clean** — booking-customer messaging confirmed to materialize only after accept (a real null-to-real transition), a real message round-trips driver↔customer, and the same anonymous-tracking response confirms `assignedDriver`/`assignedVehicle` absent from both the shipment and the leg, matching Ruling 13 structurally and empirically at once. **Walked live exactly once, by deliberate choice** — nothing since has touched the messaging/anonymous-tracking code, and the owner explicitly forbade repeating unchanged work | DEPLOYED (api+web, ancestors transitively); NO RECORD of a live-behaviour observation | Recipient-facing courier identity restricted by [Ruling 13](./OWNER-RULINGS.md#ruling-13) — owner decision, not an engineering gap | NOT ACCEPTED (no record) |
| 8 | Expandable maps & A/B/C/D route stops (pre-acceptance) | Full-screen multi-stop map for shipping and marketplace delivery driver screens | #121 (`4eac6e8`), #129 (`c99a596`), #255 (`1161a6f`), #302 (`16e4b4b`, marketplace) | 2026-09-26 real-browser mobile audit (environment not named as production); **Jim's MDF-238 live walk (2026-10-15): clean** — pre-acceptance pin gating confirmed identical in both the marketplace and shipping code paths; multi-stop route data confirmed real (4 points via requirement 12's own shipment, not capped at 2). **Touch-drag pan resolved this pass (Dwight/QA, MDF-247, and Ryan):** structurally a TESTING gap, not a functional one — the only two `L.map()` sites (`MapPreview.tsx:90-99`, `LocationPicker.tsx:271-275`) set no `dragging`/`touchZoom` override, so both inherit Leaflet's unmodified defaults; Ryan then dispatched real touch events through the Chrome DevTools Protocol and observed touch panning actually work on both Leaflet maps — the 2026-09-26 audit's inability to confirm it was a headless pointer-event-emulation harness artifact, not a product defect | DEPLOYED (api+web, ancestors transitively); NO RECORD of a production observation | **IN VERIFICATION (Dwight/QA, MDF-247 — narrowed 2026-10-15):** the only item still open is the owner/Edward scope question — whether a two-stop marketplace delivery was ever meant to satisfy the A/B/C/D wording at all; unsettled, no outcome pre-written here. The touch-drag question (left column) is no longer open | NOT ACCEPTED (no record) |
| 9 | Saved addresses — label, CRUD, default, delete-safety | Full CRUD, default, delete-safety, standalone manage page, un-default-without-delete | #122 (`c4b9f2b`); #323 (`444a1ec`); #336 (`9ec6764`) | Default/delete-safety re-verified directly against source (§9); **Jim's MDF-238 live walk (2026-10-15): clean** — add/edit-label/default/delete all confirmed working live; deleting the current default while a second address exists auto-promotes the remaining one live, with no manual step | DEPLOYED (api+web, ancestors transitively); NO RECORD of a live-behaviour observation | None open as of this pass | NOT ACCEPTED (no record) |
| 10 | Cancellation before custody, failed delivery, return-to-sender | Custody-boundary cancel; return/reroute two-step charge fix (Ruling 1); failed-delivery API trigger **and, as of this pass, its web screen** — see correction below | #271/#288/#285/#306/#308/#309/#312/#318 (return/reroute chain); #365 (`e4b4be7`, MDF-96, API trigger); **#393 (`9f5c3c8`) — the "Report an issue" screen, closing the previously-reported "no screen anywhere" gap; #398/#401 reconcile it against the EXCEPTION-blocks-progression rule**; #428 (`8d84c59`) closes a courier-self-report test gap | See §10 below for the five named API-side test files (not re-run this pass); **new this pass: `apps/web/app/dashboard/driver/shipping/[id]/page.test.tsx`'s "report an issue (MDF-96)" and "report-issue is itself blocked during an open exception" describe blocks, read directly from the diff; Jim's MDF-238 live walk (2026-10-13 through 2026-10-15) is recorded in full in §10 below, including a live-proven defect he found on 2026-10-13 (same-window fix: #398/#401) and his own later, separately retracted re-finding of what looked like the same gap — both named, not smoothed over** | DEPLOYED (api `1fec2bb` incl. `e4b4be7`; web `68d7ff0` incl. `9f5c3c8`/`e9eb27a`/`ecb83d5`; admin `015d665` incl. `5fe37cf`); **NO RECORD** of anyone watching any of it work in production | Decision memo on the fuller failed-delivery workflow still in progress (Ruling 14; Pam) — may be narrower now that #393 shipped one concrete answer. **Disclosed limitation in #393 itself: the "reported" confirmation is client-side only and does not survive a page reload** — `ShipmentDriverService#serialize` has no field to reconstruct it from. Jim's MDF-238 walk is complete for this row (no longer IN VERIFICATION) — see §10 below for the full account | NOT ACCEPTED (no record) |
| 11 | Recipient availability windows & updates | Availability windows, read + write, sender and recipient sides; **ETA now recomputes on a window change, as of this pass** | #179 (`a6b7d97`, BMPL-179); BMPL-344 (`a6f81bb`); **#403 (`817bf5c`) — `setAvailabilityWindows` now triggers the same ETA-change notice every other ETA-affecting write already does**; **#416 (`7151c95`) — the sender-UI piece gained a named behavioural test** | New this pass: `apps/api/test/shipment-availability-windows-eta.integration.spec.ts` and `AvailabilityWindows.test.tsx` (256 added lines) — both named in §11 below; sha already given in the merged-PRs column; **Jim's MDF-238 live walk (2026-10-15): clean** — sender and recipient set independent windows on the same shipment, each side's own row isolated from the other's, structural (`allowedRoles` differs by role, not incidental) | DEPLOYED (api+web, both `#403`/`#416` ancestors of live `1fec2bb`/`68d7ff0`, confirmed directly); NO RECORD of a live-behaviour observation | None open as of this pass | NOT ACCEPTED (no record) |
| 12 | Multi-leg ETA, material ETA-change notice, terminal hold/reroute, carrier schedule exceptions | All four pieces have a merged API and a staff trigger; **the availability-window ETA gap (see req 11) also closes this requirement's own notice path** | ETA: `f1bbfce`/`e56c425` (BMPL-340/346); notice: `e7ef2ed` (BMPL-345); hold/reroute: `7ff34a1`/`5fe37cf` (BMPL-343, PR #275/#309); schedule exceptions: `fcc3592` (BMPL-186); **#403 (`817bf5c`) closes the availability-window gap** | Named per-piece tests in §12 (`shipment-eta...spec.ts`, `shipment-eta-notification...spec.ts`, `shipment-reroute...spec.ts`, `shipment-return-to-sender...spec.ts`, `ExceptionResolution.test.tsx`, plus #403's new test above); **Jim's MDF-238 live walk (2026-10-15): clean on all 5 pieces, including the 2 originally time-boxed on his first pass (reroute-prepares-only, date-specific schedule exception) — see §12 below for the per-piece account, including the ETA-notification fix he walked live himself** | DEPLOYED (api+web+admin, all ancestors transitively, re-confirmed against the new anchors this pass); all migration-bearing commits: **expected but unverified**, never "applied" (see methodology above); NO RECORD of a live-behaviour observation | None open as of this pass | NOT ACCEPTED (no record) |

**Summary: 11 of 12 requirements have fully shipped, deployed functionality
(every PR cited above confirmed an ancestor of this pass's live commit for
the app it touches); requirement 10's failed-delivery piece gained its
missing web screen this pass (#393) but still has an owner decision memo in
progress and a disclosed reload limitation. Zero of twelve have a recorded
acceptance from Edward himself — this is unchanged from every prior pass and
is independent of how much engineering work has landed.** Where this table
or any other part of this document has used "done," "ready," or similar
language, read it as this team's own engineering judgment — never Edward's
word — unless a dated quote from him is cited directly beside it, which, as
of this pass, is true of none of the twelve rows.

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

**A sixth claim this document was missing: IMPLEMENTED is not ACCEPTED.**
Owner instruction, 2026-10-12, prompted by requirement 10's failed-delivery
trigger (`MDF-54`): "obtain or locate [Edward's] exact wording before
declaring the requirement complete. Separate what is implemented from what
he has actually accepted." Checked both halves against the record rather
than inferred from either.

**Requirement 10's exact wording search: NOT ON RECORD — and this is a
known, standing fact confirmed again, not a new gap found today.**
`hive/agents/god/edward-questions.md` already states it plainly: "every one
of the twelve audit rows reported the same thing: our document does not
quote Edward anywhere. Twelve for twelve." This document's own requirement
10 history calls the staff `EXCEPTION`/`flagException`/`resolveException`
path "the right mechanism to extend rather than duplicate" — that sentence
is this document's paraphrase, never Edward's. Nothing searched for this
pass (this document, `OWNER-RULINGS.md`, and every Edward-named file in the
hive) contains a quote, transcript or dated message in his own words about
the failed-delivery trigger.
[Ruling 14](./OWNER-RULINGS.md#ruling-14--failed-delivery-finish-it-dont-leave-it-indefinitely-blocked)
(2026-10-10) already moved this decision "off Edward and onto the owner
himself" for exactly this reason — not a new search outcome, a
standing, already-decided fact this pass confirms rather than discovers.

**None of the twelve has a recorded acceptance from Edward himself — zero
of twelve, not an estimate.** Searched this document, `OWNER-RULINGS.md`
and every Edward-named file in the hive (`bmpl-edward-script.md`,
`bmpl-edward-uat.md`, `bmpl-edward-uat-round2-findings.md`,
`agents/god/EDWARD-MASTER-HANDOFF.md`, `EDWARD-MORNING-HANDOFF.md`,
`EDWARD-FACTS-REQUEST.md`, `edward-questions.md`) for a quote, a dated
reply, or an explicit "yes" in his own words against any of the twelve.
Found none. What exists instead, repeatedly, is this team's own assessment
of readiness: "EDWARD ACCEPTANCE PASS" (kanban `MDF-87` through `MDF-90`)
explicitly means "could Edward actually perform this workflow through the
product right now," checked by this team, not confirmation that he did it;
requirement 3 below reads "done, as Edward asked for it," which is this
document's judgment that the build matches the request, not his sign-off.
Both are real and valuable, and neither is acceptance. The one place
Edward's own words *are* quoted directly in this codebase is a different
requirement set entirely — the responsive-navigation work (kanban
`MDF-103`: "Edward said 'Mobile Menu'...", "His words: 'Do NOT force a
mobile drawer onto desktop...'") — which shows this team does quote him
verbatim when it has his words, and did not fabricate one here because it
has none for these twelve.

| # | Implemented (per the evidence ladder above) | Accepted by Edward |
| - | --- | --- |
| 1 | Yes | NO RECORD |
| 2 | Yes | NO RECORD |
| 3 | Yes (two policy questions open — not implementation gaps) | NO RECORD |
| 4 | Yes | NO RECORD |
| 5 | Yes | NO RECORD |
| 6 | Yes | NO RECORD |
| 7 | Yes for the booking customer; recipient-facing courier identity ruled out of scope by the owner (Ruling 13), not an Edward answer | NO RECORD |
| 8 | Yes for shipping and marketplace delivery; whether the requirement was ever meant to cover marketplace's two-stop case is unsettled | NO RECORD |
| 9 | Yes | NO RECORD |
| 10 | **Partial** — the failed-delivery trigger now exists, API only (`e4b4be7`, PR #365); no web UI calls it. Pre-custody/return-to-sender half is implemented | NO RECORD (exact wording searched for and not found — see above) |
| 11 | Yes | NO RECORD |
| 12 | Yes, API and staff triggers on all four pieces; migration application expected but unverified | NO RECORD |

**11 of 12 fully implemented, 1 of 12 (requirement 10) partially
implemented; 0 of 12 have a recorded acceptance from Edward himself.**
"Implemented" above follows each requirement's own evidence ladder, not
this table's invention — requirement 10 is the sole exception, and this
pass corrected it from "No" to "Partial": a failed-delivery trigger now
exists in code (API only, no web UI), where the previous pass found none
at all. Where this document or a kanban card has used the
word "accepted," "done, as Edward asked," or "ready," read it as this
team's own judgment unless a quote or a dated reply from Edward is cited
next to it — none is, anywhere in this document, as of this pass.

---

## 1. Vendor location-level inventory & fulfilment origin

**Evidence ladder:**
- IMPLEMENTED: yes — `bad7b3f` (API), `74cbcd6` (UI).
- TESTED: yes, named —
  `apps/api/test/vendor-location-inventory.integration.spec.ts` (shipped
  in `bad7b3f`); not independently re-run in this pass.
- MERGED: yes — both an ancestor of `origin/main`.
- DEPLOYED: **yes, all of it, admin included — the code.** `bad7b3f`
  touches only `apps/api`/`packages/database`; `apps/api`'s live commit is
  `4936812`, and `bad7b3f` is an ancestor of it. `74cbcd6` touches
  `apps/web` and `apps/admin`; `apps/web`'s is `5b2b0a9`, `apps/admin`'s is
  `effc63e` (build identity, confirmed un-cache-bustable, not a live
  read), and `74cbcd6` is an ancestor of both. `bad7b3f`'s own migration
  (`inventory_locations`) is a confirmed ancestor of the live API commit
  — **application is expected but unverified** (see the methodology
  section above).
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
`shapeVendorOrder()` serializes `originLocation: {id, label}` to all three
callers that read it (`apps/api/src/orders/orders.service.ts:1083`,
by its own in-code comment at the field: "exactly THREE callers ... all
three see this field, INCLUDING the customer") — **that is the API
response, not the screen.** Jim walked this live and confirmed only
`apps/admin`'s order page actually renders it, as "Fulfilled from
<location>" (`apps/admin/app/dashboard/orders/[id]/page.tsx:132-134`).
**Neither the customer's own order view nor the vendor's own order view
shows it, anywhere, today.** Grep-confirmed: zero references to
`originLocation` under `apps/web`, and `apps/web/lib/orders.ts`'s own
`VendorOrderView` type does not even declare the field — the data the API
already sends to those two audiences is simply discarded on arrival. This
was this document's own invented claim, not something Edward asked for or
the owner approved; it is corrected here as a fact, not proposed as
something that should be built. A historical order with no recorded
origin reads as `null`, never an error — that half of the original claim
is unaffected and still only checked against `apps/admin`.

**Note for this pass:** Oscar and Jim are currently reproducing
responsive-layout defects that may touch this requirement's screens; no
commit landed against this requirement's files between `e72da60` and
`effc63e` (checked directly), so this section is unchanged pending their
findings.

**Acceptance criteria:** as a vendor with more than one `VendorLocation`,
set stock for a product at a specific location in the inventory editor's
"Stock by location" panel; place an order for it as a customer; confirm
the order correctly sources from the location with stock over one at zero
(mechanism, not display). Confirm admin's order view shows "Fulfilled
from <location>"; confirm the customer's own order view and the vendor's
own order view show **no** such line — that is today's correct behaviour,
not a bug to silently fix here. Confirm an order placed before this
feature shipped still shows no origin line on admin either (not an error,
not a guess). Confirm deleting a `VendorLocation` that still carries a
reservation is refused.

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
- TESTED: yes, named —
  `apps/api/test/shipping-pickup-photo.integration.spec.ts` (`682b501`,
  extended by `66487e4`), `apps/web/lib/driver-shipping-job.test.ts`
  (`a568d6a`, courier-upload UI) and
  `apps/admin/app/dashboard/logistics/[reference]/page.test.tsx` (the
  staff view's own test, `a568d6a`'s own citation — the staff logistics
  screen has since moved from `apps/web` to `apps/admin`, so the file
  this PR originally touched no longer exists; this is the current
  equivalent), and
  `apps/api/test/shipment-recipient-linking.integration.spec.ts`/
  `apps/web/components/shipping/RecipientTracking.test.tsx` (recipient
  access, `66487e4`/`0c322d6`); not independently re-run in this pass.
- MERGED: yes — all four an ancestor of `origin/main`.
- DEPLOYED: **yes, the code.** Every one of these commits touches only
  `apps/api` and/or `apps/web` (confirmed directly, `git show --stat`) —
  no `apps/admin` file in any of them — an ancestor of both `apps/api`'s
  (`4936812`) and `apps/web`'s (`5b2b0a9`) live commits.
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
- TESTED: yes, named —
  `apps/api/test/shipment-recipient-linking.integration.spec.ts`; not
  independently re-run in this pass.
- MERGED: yes — an ancestor of `origin/main`.
- DEPLOYED: **yes, the code.** Touches `apps/api`, `apps/web`,
  `packages/database`, `packages/shared` only — no `apps/admin` file —
  an ancestor of both `apps/api`'s (`4936812`) and `apps/web`'s
  (`5b2b0a9`) live commits. Its three migrations
  (`recipientUserId`/`recipientClaimedAt` and the two audit-trail tables)
  are a confirmed ancestor of the live API commit — **application is
  expected but unverified** (see the methodology section above); the
  claim endpoint depends on those columns existing.
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
- TESTED: yes, named — `apps/api/test/driver.integration.spec.ts`
  (`3950db0`, extended by `a032771`) and
  `apps/web/components/driver/ServiceAreasSection.test.tsx`
  (`99e98c1`/`2cbcf73`); not independently re-run in this pass.
- MERGED: yes — all four an ancestor of `origin/main`.
- DEPLOYED: **yes, the code.** Every commit touches only `apps/api` or
  `apps/web` — no `apps/admin` — an ancestor of both `apps/api`'s
  (`4936812`) and `apps/web`'s (`5b2b0a9`) live commits. `3950db0`'s own
  migration (the new `DriverServiceCity` table) is a confirmed ancestor
  of the live API commit — **application is expected but unverified**
  (see the methodology section above).
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

**Evidence ladder — for the seven commits that actually prove this row
(MDF-215: `056b709`/`e498765`/`c2d1b0a` removed from this ladder — they
are requirement 11's shipment-availability-window commits, PRs
#209/#214/#218, and touch no vendor-hours/closing-soon code at all;
their own tests
(`apps/api/test/shipment-availability-windows*.integration.spec.ts`,
`packages/shared/src/availability-windows.test.ts`) prove requirement
11, see that row, not this one) — vendor-hours dispatch `a072971`,
closing-soon warning `1161a6f`, terminal half `699a3e3`/`4eac6be`/
`b12afb3`, closed-now badge `0d50de2`, one-off closures `81ad57f`:**
- IMPLEMENTED: yes.
- TESTED: yes, named —
  `apps/api/test/vendor-hours-dispatch.integration.spec.ts`
  (`a072971`); `apps/api/test/delivery.integration.spec.ts` and
  `apps/web/lib/vendor-hours.test.ts` (`1161a6f`'s closing-soon half,
  the latter extended again by `0d50de2` below);
  `packages/shared/src/hub-hours.test.ts` (`699a3e3`);
  `apps/api/test/hub-hours.integration.spec.ts` (`4eac6be`);
  `apps/api/test/shipment-hub-hours-dispatch.integration.spec.ts`
  (`b12afb3`); `apps/api/test/storefront.integration.spec.ts` and
  `apps/web/lib/vendor-hours.test.ts` (`0d50de2`);
  `apps/api/test/vendor-hours-exceptions.integration.spec.ts` and an
  extension of `vendor-hours-dispatch.integration.spec.ts` (`81ad57f`);
  not independently re-run in this pass.
- MERGED: yes — all seven an ancestor of `origin/main`.
- DEPLOYED: **yes, the code.** Every one touches only `apps/api` and/or
  `apps/web` — no `apps/admin` — an ancestor of both `apps/api`'s
  (`4936812`) and `apps/web`'s (`5b2b0a9`) live commits. `699a3e3`,
  `81ad57f` and `a072971` each carry their own migration, each a
  confirmed ancestor of the live API commit — **application is expected
  but unverified** (see the methodology section above).
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
file, and are now folded into the evidence ladder above as part of this
row's own seven commits rather than sitting separately from it — the
code, that is: `699a3e3` (the `HubOpeningDay`/`HubHoursException` schema
and migration) and `81ad57f` (one-off closures, also migration-bearing)
are DEPLOYED as code on the same terms as `a072971` above, each
confirmed an ancestor of the live API commit — **application is equally
expected but unverified** (see the methodology section above).
PRODUCTION-VERIFIED stays **no record** for
all five — finding the commit is not the same claim as watching it work.

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
- DEPLOYED: **yes, the code.** Both touch only `apps/api` (`cbc6765`'s
  only non-test file is this document itself) — an ancestor of
  `apps/api`'s live commit, `4936812`.
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
messaging piece that have actually shipped; identity-for-the-recipient is
out of scope by owner ruling, not unimplemented, so no ladder applies to
it (see below):**
- IMPLEMENTED: yes — `a4fb20d` (booking customer), `910d5b2`/`5c11021`/
  `c7690a5` (recipient messaging, API + web).
- TESTED: yes. Two separate commits added test coverage: `5c11021` added
  `apps/api/test/shipping-messaging.integration.spec.ts` on the API side,
  and `c7690a5` added `RecipientCourierMessage.test.tsx` plus an extension
  of `apps/web/app/track/[token]/page.test.tsx` on the web side; not
  independently re-run in this pass.
- MERGED: yes — all four an ancestor of `origin/main`.
- DEPLOYED: **yes, the code.** Every one of these commits touches only
  `apps/api` and/or `apps/web` (`5c11021` confirmed `apps/api` only;
  `c7690a5` confirmed `apps/web` only) — no `apps/admin` — an ancestor
  of both `apps/api`'s (`4936812`) and `apps/web`'s (`5b2b0a9`) live
  commits.
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
  not call the read endpoint. The participant-role migration (`910d5b2`)
  is a confirmed ancestor of the live API commit — **application is
  expected but unverified** (see the methodology section above).
- **Courier identity is restricted to the booking customer by owner
  ruling, not an unbuilt gap.**
  [Ruling 13](./OWNER-RULINGS.md#ruling-13--courier-identity-toward-a-linked-recipient-for-now)
  (2026-10-10): "keep courier identity restricted to the booking customer
  for now. Do not expose additional personal information to recipients
  without a confirmed product requirement. Keep the Edward clarification
  recorded." `RECIPIENT_VIEW_INCLUDE` (`shipment.service.ts`) selects no
  assigned driver and no assigned vehicle — re-read directly at `effc63e`,
  unchanged — and that is now the decided, correct state, not a thing
  left to build. Nothing in this document claims otherwise.

**Acceptance criteria:** as a linked recipient of a shipment whose
LAST_MILE or DIRECT leg has an assigned, accepted courier, open the
incoming-shipment page and confirm a "Message your courier" entry point
appears and opens a real conversation. Confirm it does not appear before a
courier has accepted. Confirm the same shipment's anonymous tracking link
(`/track/[token]`) shows no such entry point and that the underlying GET
endpoint refuses an unauthenticated caller. Confirm no screen shown to a
linked recipient displays the courier's name, photo or vehicle.

**What would reopen this, precisely, if it ever does:** `MDF-97` asked
whether a recipient should see courier identity at all. The owner's
2026-10-10 ruling answers what BMPL does for now — restrict it to the
booking customer — it does not answer what Edward originally intended;
that clarification is **recorded, not resolved.** If a confirmed product
requirement arrives later that says otherwise, `RECIPIENT_VIEW_INCLUDE`
would need to select `assignedDriver` through the same
`driverSummary()`/`publicAvatarUrl()` shape already serialized to the
booking customer, wired into the recipient serializer — confirmed to need
no new capability and no schema change. Until then, requirement 7 is
**satisfied as ruled**: there is nothing pending and nothing to build.

## 8. Expandable maps & A/B/C/D route stops (pre-acceptance)

**Evidence ladder:**
- IMPLEMENTED: yes — `4eac6e8`, `c99a596`, `1161a6f` (shipping), `16e4b4b`
  (marketplace).
- TESTED: yes, named — `apps/web/lib/trip-map.test.ts` (`4eac6e8`,
  `c99a596`), `apps/api/test/shipping-driver.integration.spec.ts`
  (`c99a596`), `apps/web/components/maps/LocationPicker.test.tsx`
  (`1161a6f`'s pin-picker half), and
  `apps/web/app/dashboard/driver/jobs/[id]/page.test.tsx` /
  `apps/web/lib/driver-job.test.ts` (`16e4b4b`), plus the 2026-09-26
  real-browser mobile audit noted below; not independently re-run in
  this pass.
- MERGED: yes — all four an ancestor of `origin/main`.
- DEPLOYED: **yes, the code.** Every one touches only `apps/api` and/or
  `apps/web` — no `apps/admin` — an ancestor of both `apps/api`'s
  (`4936812`) and `apps/web`'s (`5b2b0a9`) live commits.
- PRODUCTION-VERIFIED: **no record.** The 2026-09-26 mobile audit
  (described below) does not state which environment it ran against —
  not named as production, so not counted as one. The touch-drag question
  that audit left open is resolved as of 2026-10-15 (see below) — but by a
  local-stack live walk and a Chrome-DevTools-Protocol touch dispatch,
  neither of which is production, so this rung is unchanged.

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
working on both desktop and a real mobile device. As a marketplace delivery
driver, open a job before the customer has accepted and confirm the
door-end pin is absent, not merely hidden; confirm it appears once
accepted. **Not yet acceptance-testable:** whether a two-stop marketplace
delivery was ever meant to satisfy the A/B/C/D wording — there is no
criterion to write until Edward settles the scope question.

**Note, updated 2026-10-14:** the responsive-layout sweep noted in the
previous pass concluded (MDF-240, done) with no defect reported against
this requirement's screens, so this section's engineering content is
unchanged. **The open item is the scope question above, now carded as
MDF-247 ("was 2-stop marketplace delivery ever meant to satisfy the A/B/C/D
route wording?"), status `blocked`** — on that one owner/Edward scope
reading only, per the owner's own instruction not to interpret an ambiguous
requirement on Edward's behalf. This is IN VERIFICATION, not a code gap —
no outcome is pre-written here; whichever way it resolves, this document
records it when it lands, not before.

**Update, 2026-10-15 — the real-phone touch-drag question (the other open
item from the 2026-09-26 audit, separate from the MDF-247 scope question
above) is resolved, not merely re-asserted:**

- MDF-247's own working pass (QA/Dwight) confirmed structurally that this
  is a **TESTING gap, not a functional one**: the only two places a Leaflet
  map is constructed in this codebase — `apps/web/components/maps/MapPreview.tsx:90-99`
  and `apps/web/components/maps/LocationPicker.tsx:271-275` — pass option
  objects with no `dragging`, `touchZoom`, or `tap` override at all, so both
  inherit Leaflet's unmodified defaults (`dragging: true`, `touchZoom: true`
  on any touch-capable browser). There is no conditional, feature flag, or
  device-detection branch in either file that could make touch input take a
  different path from mouse input — there is no code slot for a missing
  touch-drag feature to occupy.
- The diagnostic for why the 2026-09-26 audit could not confirm it: that
  audit saw the *same* map pan correctly under synthetic mouse-drag events,
  and a *different* map on the identical Leaflet defaults pan correctly
  under synthetic touch events on desktop. A missing or disabled handler
  fails the same way in every context; behaviour that changes with the
  harness and not with the code is a harness artifact, not a product defect.
- Ryan then dispatched real touch events through the Chrome DevTools
  Protocol (a lower-level, more faithful touch simulation than the original
  DOM-synthetic events) against both maps and **observed touch panning
  actually work**. This is not literally a physical-phone check — that
  remains, strictly, not done — but it is accepted on this floor as closing
  the testing gap, consistent with the structural finding above that there
  is no touch-specific code path left to fail.
- One unrelated finding surfaced by the same touch-dispatch pass: a
  one-finger page-scroll trap on `LocationPicker` (checkout) and
  `MapPreview`, where the existing `touch-action: pan-y` CSS never prevented
  it (Leaflet pans in its own JavaScript, which `touch-action` does not
  govern). **This is not a requirement-8 matter** and is tracked on its own
  card, noted here only so a reader does not mistake it for part of this
  requirement's gap.

## 9. Saved addresses — label, CRUD, default, delete-safety

**Evidence ladder:**
- IMPLEMENTED: yes — `c4b9f2b` (web CRUD wiring over pre-existing API),
  `444a1ec` (manage-addresses page), `9ec6764` (un-default-without-delete).
- TESTED: yes, named — `apps/api/test/addresses.integration.spec.ts`
  (extended by `9ec6764`); the cross-user negative test and duplicate-
  detection behaviour are described in this document's body but not
  independently named here.
- MERGED: yes — all three an ancestor of `origin/main`.
- DEPLOYED: **yes, the code.** `c4b9f2b` and `9ec6764` touch only
  `apps/api`/`apps/web`; `444a1ec` touches only `apps/web` — no
  `apps/admin` in any of them — an ancestor of both `apps/api`'s
  (`4936812`) and `apps/web`'s (`5b2b0a9`) live commits.
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

**Evidence ladder — now covers all three pieces; failed delivery gained a
ladder of its own once `e4b4be7` shipped (see below), after this section's
previous `effc63e` anchor:**
- IMPLEMENTED: yes, for custody/cancellation (pre-existing,
  `ShipmentService.cancel()`), for return-to-sender/reroute as fixed
  (`f8f89dd` then `0efd970`), and now for a failed-delivery trigger — API
  only, no web UI (`e4b4be7`, PR #365; see below).
- TESTED: yes, named —
  `apps/api/test/bmpl-376-wallet-authorization-redteam.integration.spec.ts`
  (`3ea4fa1`, retitled passing by `5b7dd1a`),
  `apps/api/test/bmpl-378-escrow-sink-boundary.integration.spec.ts`
  (`302a84c`),
  `apps/api/test/shipment-acceptance-and-tracking.integration.spec.ts`
  (`d5b1dec`), and for the failed-delivery trigger,
  `apps/api/test/shipping-driver.integration.spec.ts` and
  `apps/api/test/shipping-notifications.integration.spec.ts` (both
  `e4b4be7`); not independently re-run in this pass.
- MERGED: yes — `f8f89dd`, `0efd970`, `3ea4fa1`, `302a84c`, `e72da60`,
  `5fe37cf`, `5b7dd1a`, `d5b1dec`, `e4b4be7` all ancestors of `origin/main`.
- DEPLOYED: **yes, all of it, staff panel included — the code.**
  `f8f89dd`/`0efd970`/`e4b4be7`/test commits touch only `apps/api` (plus
  `packages/*`), an ancestor of `apps/api`'s live commit `4936812`;
  `e72da60`'s confirmation surface touches only `apps/web`, an ancestor
  of `apps/web`'s live commit `5b2b0a9`; `5fe37cf`'s staff panel touches
  only `apps/admin` — `apps/admin/health` answers `commit: effc63e`
  (build identity), and `5fe37cf` is an ancestor of `effc63e` (checked
  directly). The `20261104250000_shipment_routing_proposal` migration
  (from `0efd970`) is, separately, a confirmed ancestor of `apps/api`'s
  live commit — **application is expected but unverified** (see the
  methodology section above; stated again in the body below) — a schema
  migration is not something the admin build's own commit identity can
  answer. `e4b4be7` carries no migration of its own (no new `AuditAction`,
  no new notification event, no schema change). **CORRECTED 2026-10-14:**
  ~~Deployed code is not the same claim as reachable product: grep-confirmed
  directly, zero files under `apps/web` or `apps/admin` reference the
  failed-delivery endpoint or its service method — the code is live, but no
  screen calls it.~~ As of PR #393 (`9f5c3c8`), a screen does call it — see
  the correction block below. Re-anchored to this pass's live commits:
  `apps/api` is `1fec2bb` (incl. `e4b4be7`), `apps/web` is `68d7ff0` (incl.
  `9f5c3c8`/`e9eb27a`/`ecb83d5`), `apps/admin` is `015d665` (incl.
  `5fe37cf`) — all confirmed ancestors (or, for web, equal to `origin/main`
  itself) directly, not carried forward from the prior anchors unchecked.
- PRODUCTION-VERIFIED: **no record**, for any of the four (cancel, return,
  reroute, failed-delivery self-report/lockout-flag) — unchanged by the
  screen shipping; DEPLOYED and PRODUCTION-VERIFIED remain two different
  claims.

**Status, corrected again 2026-10-14: the failed-delivery piece now has
BOTH a trigger and a screen, with two disclosed limitations and one
decision still open.** PR #365 (`e4b4be7`) shipped the API trigger; PR #393
(`9f5c3c8`) shipped the screen that calls it — see the correction block
below for both. The staff-alone charge defect under
[Ruling 1](./OWNER-RULINGS.md#ruling-1--a-courier-accepting-a-job-is-not-custody)
(tracked BMPL-375) is fixed on main. What remains open: the reload-state
limitation disclosed in #393 itself, and the owner's fuller decision memo
(Ruling 14) on the broader workflow, now possibly narrower in scope since
#393 shipped one concrete answer. The custody boundary itself — a
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
carrying the same title as the closed PR #292) are on main too. The migration
is a confirmed ancestor of the live API commit — **application is expected
but unverified** (see the methodology section above).

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

Failed delivery gained a real API trigger as of **`e4b4be7` (PR #365,
MDF-96)** — merged after this document's own `effc63e` anchor, which is
why the status above read "entirely unbuilt" until this correction. It
reuses the existing `EXCEPTION`/`flagException` machinery rather than
duplicating it, exactly as this row previously said it should:

- A courier can self-report their own leg's failed delivery attempt —
  `POST /driver/shipping-jobs/:id/report-issue`
  (`DriverShippingController.reportIssue`'s route,
  `apps/api/src/shipping/driver-shipping.controller.ts:91`) →
  `ShipmentDriverService.reportIssue`
  (`apps/api/src/shipping/shipment-driver.service.ts:351`), gated by the
  same `ownedLeg()` check every other driver route uses, once the courier
  actually holds the parcel (`PICKUP_CONFIRMED` through `ARRIVING`).
- The shipping handoff-PIN lockout (5 wrong codes) now also auto-flags the
  leg exception, attributed to the system (`actorId: null`, since no
  person caused it) — inside `ShipmentService.verifyHandoffPin`
  (`apps/api/src/shipping/shipment.service.ts:1766`). It used to just
  throw a 403 at the driver and go no further, unlike marketplace
  delivery's identical lockout, which already pages an admin.
- No new `AuditAction`, no new notification event, no schema change: both
  paths share `flagException`'s existing `SHIPMENT_LEG_EXCEPTION` audit
  action and `SHIPMENT_EXCEPTION` admin alert, distinguished only by
  `actorId` (driver vs. null).
- No automatic charge, refund or re-delivery fee anywhere in this change —
  reaching `EXCEPTION` still only gets a human's attention, same as a
  staff-flagged one; what happens to money from there remains an explicit
  owner decision this PR does not touch.

**CORRECTED 2026-10-14 — the sentence below is now false and is kept, struck,
rather than deleted, per this document's own anchor-vs-prose rule: a citation
staying anchored does not mean the sentence beside it stays true.** ~~What is
still missing is the screen, not the trigger. Grep-confirmed directly against
`apps/web` and `apps/admin`: no file references the endpoint path or
`reportIssue` — a real courier has no button, link or form anywhere in the
product that calls it.~~ **PR #393 (`9f5c3c8`) shipped exactly that screen**:
`apps/web/app/dashboard/driver/shipping/[id]/page.tsx` now has a real "Report
an issue" button, gated to the same statuses the server accepts
(`PICKUP_CONFIRMED`/`IN_TRANSIT`/`ARRIVING`), that calls
`apiPost('/driver/shipping-jobs/:id/report-issue', { reason })` — confirmed
directly from the PR's own diff, not from its title. Named tests exist in
`page.test.tsx`'s "report an issue (MDF-96)" describe block, read directly
this pass. `9f5c3c8` is a confirmed ancestor of `apps/web`'s live commit
(`68d7ff0`) — DEPLOYED. **Two things this PR discloses about itself, carried
forward rather than smoothed over:** (1) the "Issue reported" confirmation
shown after a successful report is client-side only — it does not survive a
page reload, because `ShipmentDriverService#serialize` returns only
`courierStatus`, never the leg's own `status`/`exceptionReason`/`exceptionAt`
fields `flagException` actually writes, so there is currently no field this
screen could read back to reconstruct "already reported" state after a
reload; (2) PR #398/#401 (`e9eb27a`/`ecb83d5`) separately established that an
open EXCEPTION blocks further courier progression, and a follow-up
reconciliation (dated 2026-10-14 inside #393's own diff) confirmed the Report
an issue button is itself one of the controls that rule correctly hides
once a leg is already EXCEPTION — report-issue calls `flagException`, which
`isLegActionable` refuses on an already-EXCEPTION leg, so the button
disappearing there is the server's own rule surfacing, not a second,
untested rule invented in the UI. **PRODUCTION-VERIFIED still has no
record** — a merged, deployed, tested screen is not the same claim as
someone having watched a real courier use it. The separate marketplace-side
fact from before is unchanged and is not this row's gap: `DeliveryStatus`
(a different enum, for marketplace delivery, not shipping) still has no
`FAILED` value, and its own locked-PIN path
(`deliveryVerificationStatus` `FAILED`, with an `ADMIN_FAILED_DELIVERY`
notification, `driver-jobs.service.ts`) records wrong PIN codes only, not
a failed delivery attempt.

**Jim's MDF-238 live walk — the full story, including his own retracted
finding, named not omitted (2026-10-15):**

1. **Original live walk (2026-10-13), a real finding.** Clicked "Report an
   issue" as a real courier, confirmed `shipment_legs.status` flipped to
   `EXCEPTION` in Postgres with the real reason text. Went further than the
   known reload-confirmation gap already disclosed above: on the stale
   post-reload screen, clicked "Start the trip" anyway — it worked. Reading
   the live API response and a raw Postgres row at the same instant: the API
   said `status: 'IN_TRANSIT'`, the database said
   `shipment_legs.status: 'EXCEPTION'`, same row. The courier status machine
   had no check against `EXCEPTION` at all, and the screen's own
   confirmation copy claimed a hold ("this delivery is on hold") the backend
   did not enforce. Reported as a live-proven defect — the same-instant
   API-and-DB read rules out a stale-cache explanation.
2. **Real fix shipped the same window.** PR #398/#401 (`e9eb27a`/`ecb83d5`,
   merged 2026-10-13) established that an open `EXCEPTION` blocks further
   courier progression, and PR #393's own branch corrected the "on hold"
   copy to what `flagException` actually guarantees.
3. **A separate, later mistaken re-finding (2026-10-14/15), named rather
   than hidden.** On a later, unrelated task — reading code only, to verify
   #385's release conditions, not a live walk and not authorized to run the
   integration suite for that job — Jim read `markInTransit`/`markArriving`
   (`simpleTransition`, `shipment-driver.service.ts:306-330`) in isolation
   and concluded they checked only `assertAction` against the courier-facing
   `DeliveryStatus` enum (which has no `EXCEPTION` value) and never touched
   `leg.status` — the same shape as the original gap, apparently regressed.
   He reported this as a functional gap. **It was wrong:** `simpleTransition`
   on current `main` calls `this.assertNotException(leg)` immediately after
   `assertAction`, one line past where his own read stopped. God
   independently made the identical mistake reading the same function with a
   line-range window that happened to end one line short of the same guard.
   Both retracted it once the full function boundary was read. **Standing
   lesson:** an absence can only be established by reading a function's
   whole boundary, never a line-range window; a correct structural read of
   one mechanism (the enum has no `EXCEPTION` value) does not prove the
   absence of a second, independent guard in the same call path.
4. **What survived from the mistaken re-finding.** No existing test had
   exercised the courier-self-report path specifically — only the
   staff-flagged path had a named test. That testing gap was real. PR #428
   (`8d84c59`) closed it with a historical red-before-green-after proof:
   cutting a throwaway branch from the commit immediately before `ecb83d5`,
   cherry-picking only the new test, confirming it failed with the exact
   false-success shape (`in-transit` returning `201` while the leg sat in
   `EXCEPTION`), then confirming it passes on current `main`.

**Current net state of requirement 10, per the same pass:** both the
trigger (#365) and the screen (#393) are merged and deployed; the
`EXCEPTION`-blocks-progression guard is real and on `main` (#401); the
courier-reason-exposure concern is clean — `ShipmentDriverService#serialize`
has no `exceptionReason` field anywhere in its shape. The separate,
already-escalated **customer**-facing `exceptionReason` leak
(`shipment.service.ts`, `ShipmentJourney.tsx`) was Pam's MDF-243 — not this
requirement's gap — and has since merged as `35caa61` (PR #425,
2026-10-15): raw staff-entered exception reasons no longer reach a customer,
recipient or courier; staff keep the complete internal record through the
same audience-gate precedent `carrierBookingRef`/`courierStatus` already
used. **Not independently re-verified by this document for this pass** —
cited from the merged PR and the kanban record, consistent with this
document's rule that a merge is MERGED, not yet re-read as a fact here; §10
above still correctly says PRODUCTION-VERIFIED has no record for any of this.

`MDF-96` asked whether the owner expects the courier themselves to report
a failed attempt, or whether the existing staff-exception workflow is what
he meant.
[Ruling 14](./OWNER-RULINGS.md#ruling-14--failed-delivery-finish-it-dont-leave-it-indefinitely-blocked)
(2026-10-10) moved the decision onto the owner himself and asked for the
exact workflow choices and a recommendation. `e4b4be7` shipped one
concrete answer — courier self-report — before that memo landed, so the
memo's remaining scope may now be narrower (whether self-report alone is
sufficient, or a staff/UI path is still wanted) rather than starting from
zero. A decision memo is still **in progress** (Pam producing the
workflow options); whether it still needs to cover ground `e4b4be7`
already answers is the owner's call, not this document's to decide.

**Acceptance criteria:** confirm `ShipmentService.cancel()` refuses once any
leg reaches `IN_PROGRESS` and succeeds before. For return-to-sender: as the
shipment's own customer, confirm staff "preparing" a return or reroute
creates a `ShipmentRoutingProposal` and charges nothing; confirm only the
shipment's own customer can confirm it (any other account gets 404);
confirm confirming is the only step that executes the charge, at a price
recomputed fresh rather than trusted from the earlier preview. Confirm the
same two behaviours for reroute. Confirm a marketplace (non-courier)
shipment is refused outright for both. As the assigned courier on a leg
you currently hold (`PICKUP_CONFIRMED` through `ARRIVING`), call
`POST /driver/shipping-jobs/:id/report-issue` directly and confirm the leg
reaches `EXCEPTION` and staff are alerted. Exhaust the handoff-PIN lockout
(5 wrong codes) and confirm the leg auto-flags to `EXCEPTION` with
`actorId: null`, not just a bare 403. **Updated 2026-10-14 — the
self-report path now IS acceptance-testable through the product:** as a
courier holding the parcel, open the shipping job screen and confirm a
"Report an issue" button is visible, that declining the prompt or entering
under 4 characters calls nothing, that a real reason posts to
`/driver/shipping-jobs/:id/report-issue` and shows a confirmation without
inventing a refund/fee/timeframe, and that the button disappears once the
leg is already `EXCEPTION`. **Still not acceptance-testable through the
product:** that the confirmation survives a page reload — it does not,
disclosed by #393 itself, and there is no field to check this against
after a reload. The PIN-lockout auto-flag path still has no screen of its
own and remains API-only.

## 11. Recipient availability windows & updates

**Evidence ladder:**
- IMPLEMENTED: yes — `056b709`/`e498765` (sender windows, API),
  `c2d1b0a` (sender UI), `42d658f` (customer travel date),
  `a6f81bb` (recipient self-service).
- TESTED: yes for three of the four —
  `apps/api/test/shipment-availability-windows.integration.spec.ts`
  (`056b709`, extended by `a6f81bb` for the recipient half),
  `apps/api/test/shipment-availability-windows-dispatch.integration.spec.ts`/
  `packages/shared/src/availability-windows.test.ts` (`e498765`), and
  `apps/api/test/route-schedule-wiring.integration.spec.ts`/
  `packages/shared/src/belize-time.test.ts` (`42d658f`); not
  independently re-run in this pass. **CORRECTED 2026-10-14 — the gap below
  is closed:** ~~`c2d1b0a` (the sender-UI piece) has no behavioural test:
  its own commit message says the add/save/edit/locked-role/clear behaviour
  was "verified live against the real API and a throwaway account," not by
  an automated test. `apps/web/components/shipping/AvailabilityWindows.test.tsx`
  exists on `origin/main` today, but it was added three weeks later by an
  unrelated PR (`#287`, deploy-skew crash fixes) and covers only a
  missing-field crash-safety case, not the add/save/edit/locked-role
  behaviour this requirement actually describes — naming it here would
  look like proof without being any.~~ **PR #416 (`7151c95`) adds the real
  behavioural tests this gap was waiting for**, to that same file — read
  directly from the diff, not the title: `describe('AvailabilityWindows —
  BMPL-288 (add)')`, `(edit)`, `(save)` and `(locked role)`, covering
  exactly add/edit/save/locked-role/clear, the behaviour `c2d1b0a`'s commit
  message had only described as manually verified. `7151c95` is a confirmed
  ancestor of `apps/web`'s live commit (`68d7ff0`) — DEPLOYED.
- **New piece found this pass: #403 (`817bf5c`)** — `setAvailabilityWindows`
  (both the sender's own PUT and the linked recipient's own PUT) previously
  called neither of `noticeEtaChange()`'s two existing callers, even though
  `estimateShipmentEta` anchors `LAST_MILE`/`DIRECT` legs to that same
  stored window — a window change could silently move the real ETA with no
  baseline update and no notification. Both write surfaces now run the same
  `noticeEtaChange` comparison every other ETA-affecting write already did.
  TESTED: yes, named — `apps/api/test/shipment-availability-windows-eta.integration.spec.ts`
  (two tests: a recipient window moved far from "now" moves the ETA and
  notifies the sender; a sender window that still covers "now" does not).
  MERGED/DEPLOYED: `817bf5c` confirmed an ancestor of `apps/api`'s live
  commit (`1fec2bb`).
- MERGED: yes — all seven (five original plus `7151c95`/`817bf5c`) an
  ancestor of `origin/main`.
- DEPLOYED: **yes, the code**, re-anchored this pass. Every commit touches
  only `apps/api` and/or `apps/web` and/or `packages/*` — no `apps/admin` —
  confirmed an ancestor of both `apps/api`'s (`1fec2bb`) and `apps/web`'s
  (`68d7ff0`, `origin/main`'s own tip) live commits. `056b709` carries its
  own migration (the sender availability-window table, same commit cited in
  requirement 5) and is a confirmed ancestor of the live API commit —
  **application is expected but unverified** (see the methodology section
  above), same as there.
- PRODUCTION-VERIFIED: **no record.**

**Status: done, and as of this pass the one remaining test gap (the
sender-UI piece) is also closed.**

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
  TESTED: yes, named — `apps/api/test/shipment-eta.integration.spec.ts`
  and `packages/shared/src/shipment-eta.test.ts`. **The
  gap this phase left, found to have no commit SHA in this document at
  all, now has one:** `git log --all --grep=BMPL-346` found `e56c425`
  (PR #267, `apps/api`/`packages/database`/`packages/shared`/
  `packages/validation`, tested in
  `apps/api/test/carrier-org-access.integration.spec.ts` and an extension
  of `transport-leg-operations.integration.spec.ts`). Ancestor of
  `origin/main`, no `apps/admin` file — DEPLOYED yes, the code, an
  ancestor of `apps/api`'s live commit (`4936812`, re-anchored this pass to
  `1fec2bb`, still an ancestor). `e56c425` carries its
  own migration (a new `AuditAction` enum value), also a confirmed
  ancestor of that live commit — **application is expected but
  unverified** (see the methodology section above).
  **New this pass — #403 (`817bf5c`):** `setAvailabilityWindows` had been
  the one ETA-affecting write that did not trigger a recompute; see
  requirement 11's own section for the full finding — it belongs to both
  requirements at once, since `estimateShipmentEta` is what requirement 12
  calls and an availability window is what requirement 11 writes. TESTED:
  `apps/api/test/shipment-availability-windows-eta.integration.spec.ts`.
  DEPLOYED: `817bf5c` confirmed an ancestor of `apps/api`'s live commit
  (`1fec2bb`).
- **ETA-change notice** (`e7ef2ed`): IMPLEMENTED/MERGED yes, ancestor of
  `origin/main`; touches `apps/api`/`packages/database`/`packages/shared`
  only — DEPLOYED yes. TESTED: yes, named —
  `apps/api/test/shipment-eta-notification.integration.spec.ts`.
  PRODUCTION-VERIFIED: no record. Its own
  migration (`etaBaselineAt`) was held pending review before merge per
  the card's own instruction (PR #274's body: "holding per this card's
  own instruction"); that review is the same PR-review-then-merge gate
  every migration in this document goes through, and it has already
  happened — the PR is merged. The migration is a confirmed ancestor of
  `apps/api`'s live commit — **application is expected but unverified**,
  the same claim as every other migration-bearing row here, not a
  separate held-back state.
- **Terminal hold/reroute** (`7ff34a1` API; `5fe37cf` staff screen):
  IMPLEMENTED/MERGED yes, both ancestors of `origin/main`. DEPLOYED:
  **yes, all of it, admin included — the code.** The non-admin files in
  `7ff34a1` are `apps/api`/`packages/*`, an ancestor of `apps/api`'s live
  commit `4936812`; `5fe37cf` and the admin portion of `7ff34a1` are
  ancestors of `effc63e`, `apps/admin`'s build identity (checked
  directly — same commit as requirement 10's staff panel). `7ff34a1`
  carries three migrations of its own, each a confirmed ancestor of the
  live API commit — **application is expected but unverified** (see the
  methodology section above). TESTED: yes, named —
  `apps/api/test/shipment-reroute.integration.spec.ts` and
  `apps/api/test/shipment-return-to-sender.integration.spec.ts`
  (`7ff34a1`, API) and `apps/admin/components/logistics/ExceptionResolution.test.tsx`/
  `apps/admin/lib/exception-resolution.test.ts` (`5fe37cf`, staff
  screen).
- **Carrier schedule exceptions** (`fcc3592`, BMPL-186): IMPLEMENTED/
  MERGED yes, ancestor of `origin/main`. DEPLOYED: **yes, all of it,
  admin included — the code.** The API portion is an ancestor of
  `apps/api`'s live commit `4936812`; the admin portion is an ancestor of
  `effc63e`, `apps/admin`'s build identity (checked directly). `fcc3592`
  carries its own migration, also a confirmed ancestor of the live API
  commit — **application is expected but unverified** (see the
  methodology section above).
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
  additive; the card's own instruction was to hold it pending review
  before applying locally (PR #274's body: "holding per this card's own
  instruction") — that review is the PR-review-then-merge gate every
  migration here goes through, and merging satisfied it. Application
  against the production database is expected but unverified, same as
  every other migration-bearing commit in this document — see the
  methodology section at the top, and the Evidence ladder above.
  **Jim's MDF-238 live walk (2026-10-15) found a real gap on this exact
  path and then closed it live, same pass:** a recipient's own
  availability-window change moved the real ETA but fired no notification
  at all, since the trigger only lived on leg-transition/`scheduleLeg` —
  reported as a finding-plus-product-question, not fixed by him; **closed
  once #403 (`817bf5c`) added the window-change trigger**, which he then
  walked live himself — moved a recipient's window, watched a real
  `SHIPMENT_ETA_CHANGED` notification fire with the exact before/after ETA
  in its body, matching his own independent before/after reads.
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
  logistics page (`flagException` in
  `apps/admin/app/dashboard/logistics/[reference]/page.tsx`). **Verified
  this pass that the button does what the requirement asks.** It posts to
  the admin exception route (`ShippingController.exception` in
  `apps/api/src/shipping/shipping.controller.ts`), which calls
  `ShipmentService.flagException`
  (`apps/api/src/shipping/shipment.service.ts`): inside the leg
  transition it notifies admins — staff. The shared `transition()` helper
  (`apps/api/src/shipping/shipment.service.ts`) unconditionally calls
  `notifyCustomer` (`apps/api/src/shipping/shipment.service.ts`) on
  every call, reaching the sender. After the transition resolves,
  `ShipmentService.flagException` separately notifies `recipientUserId`
  when one exists (cited at the containing method, not its own branch —
  `apps/api/src/shipping/shipment.service.ts`), reaching the
  recipient. Staff, sender and recipient are all notified, exactly what
  Ruling 1 and this requirement ask for. Adjacent to
  requirement 10 but proactive (before dispatch reaches
  the recipient) rather than reactive (after a failed delivery attempt).
  Tracked as BMPL-343. **Jim's MDF-238 live walk (2026-10-15), closing an
  item he had originally time-boxed on an earlier pass:** `flagException`
  correctly notifies the recipient, not just staff/sender, confirmed live;
  separately, the reroute/return "only prepares" claim above was walked
  live end to end — staff's call creates a `ShipmentRoutingProposal` row and
  no new shipment, and the shipment's own customer's confirm call is what
  actually creates the new shipment and payment, matching Ruling 1 exactly,
  amount matching to the minor unit.
- **Date-specific carrier schedule exceptions.** **The one slice that is
  done** — `RouteOperatingDay` + `RouteScheduleException` (BMPL-186, merged
  `fcc3592`) already provide the weekly default and date-specific overrides,
  found by audit rather than built again. It shipped and is documented under
  BMPL-184 because that is the card the audit was run against — a card
  boundary, not a requirement boundary; it belongs here on the owner's own
  list. **Jim's MDF-238 live walk (2026-10-15), closing the other item he
  had originally time-boxed:** a route-schedule exception entered for
  today's date correctly refuses departure with the staff-entered reason,
  the leg's status provably untouched in the database, and a no-exception
  baseline on the same route departs cleanly first, isolating the refusal
  to the exception itself.

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
checked against each app's own live commit as of this pass — `apps/api`
`4936812`, `apps/web` `5b2b0a9`, `apps/admin` `effc63e` — three different
values, independent of each other and of `origin/main` (`4cf5dce`), since
each app redeploys only when its own affected paths change. `apps/api`'s
is a live per-request read (`uptime`/`startedAt` vary call to call);
`apps/web` and `apps/admin`'s are the build each is currently serving,
confirmed un-cache-bustable, not a liveness signal. Any of the three
is only as current as the moment it was checked, and changes with that
app's next deploy — re-checking is cheap (`git merge-base
--is-ancestor <commit> <live-commit>`, or hitting that app's own
`/health`) and should be done again before trusting an old DEPLOYED
rung, not assumed to still hold. Separately, and for every migration
cited above: nothing external to this repository observes whether a
migration has actually run against the production database
(`/health/ready`'s own check is a bare `SELECT 1`) — a DEPLOYED rung on
a migration-bearing commit proves the code is live, never that its
migration has executed.

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

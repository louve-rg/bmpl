# Visual-regression baseline — exit criterion and run log

Priority 6 remediation (owner directive, 2026-10-16). Written while the
suite is new and cheap to gate, per god's explicit instruction — "later,
once it's stable" is rejected on purpose: this floor has hit the
never-actually-a-gate shape three times in one week (a route checker that
logged but never failed, a contrast harness scoring 16/16 past a
non-rendering element, a CI wait reporting "complete" over an empty check
set). Every one passed. Every one measured nothing.

## The rule

The new "Visual regression baseline" CI job starts, and stays,
`continue-on-error: true` until **all four** of the following are true:

1. **The suite has been proven able to fail for a real reason at least
   once** — a deliberate, reverted visual regression introduced in a
   scratch worktree, confirmed red for the expected reason, then reverted
   and confirmed green again. Same causal-break discipline already standing
   on this floor (MDF-317; the RoleSwitcher mutation tests, PR #457). A
   suite that has never been watched going red for a true positive has not
   earned trust in its green.
2. **10 consecutive green runs on `main`** (not PR branches — a PR run
   varies too much in what it touches to be the right sample), **spanning
   at least 5 calendar days** — the point is surviving day-to-day CI-image
   and timing variance, not a same-afternoon burst of pushes.
3. **Zero flakes in that same window, counted honestly.** A run that goes
   red and is then re-run on the *identical* commit to green is a flake,
   not a pass. It resets the streak in row 2 to zero and gets its own row
   below (commit, failing test, suspected cause if known) — it does not
   just quietly not count.
4. Whoever removes `continue-on-error` cites the exact run IDs and dates
   satisfying 2 and 3, and the mutation-test commit satisfying 1, in that
   PR's own description — not "it's been stable for a while."

10 runs / 5 days was chosen deliberately closer to this floor's existing
flake history (one proven 30s `locator.click` flake already on record for
the plain e2e suite, BMPL-217/213) than to a token minimum of 1 or 2.

**Clause 3 precedent, from the integration suite rather than this one** —
proof the rule describes a real event, not a hypothetical. On 2026-10-16,
PR #459's integration run (unrelated 47-file presentation-only diff, zero
`apps/api` files touched) went red on
`test/dispatch-engine.integration.spec.ts:789` (MDF-18 driver-claim-fallback
race) and was reverified green on a rerun of the *identical* commit. That is
exactly clause 3's red-then-rerun-to-green: it would reset this suite's own
streak to zero and earn its own row, not be waved through as "the PR must
have fixed itself." Carded as MDF-18 follow-up (god → Jim, not fixed on the
spot per explicit instruction); cheap git-log precedent found the same
over-specified-loser-assertion shape was already fixed once in a sibling
file (`717aa58`, 2026-10-12, `apps/api/test/dispatch.integration.spec.ts`,
measured 4-of-9 runs landing on the "wrong" status code before its fix).

## Requirement 7 contrast check — a second, narrower exit criterion

The `Contrast check -- requirement 7 (web)`/`(admin)` steps and the
`Enforce contrast check result` step that blocks on them (same CI job,
`.github/workflows/ci.yml`) got their own `continue-on-error: true` on
2026-10-21, separately from the job-level rule above and for a different
reason: this is a different instrument (detects WRONGNESS against a real
WCAG ratio, not CHANGE from a prior screenshot) and it was built to block
from its first run, not to earn trust in a green over time like the pixel
baselines.

**What happened:** a widened sweep the same night (2026-10-20/21) scanned
1,792 nodes and found 544 failing under 4.5:1, split into 147 near-
invisible (<2.0:1) and 394 sub-AA (2.0-4.5:1). The 147 tier was fixed that
night; **the 394 tier was deliberately deferred as its own accessibility
pass (req 9), not forgotten and not out of scope — just not tonight's
work.** The first live run of the four MDF-376 regression specs (below)
against `contrast-known-violations.json` still empty surfaced exactly that
deferred tier, on real production routes, for the first time. Every one
of the 30 nodes found is in the 2.3-4.5:1 band — the deferred tier's own
range, not the <2.0:1 band already fixed, and not the sampler-artifact
shape documented separately in `apps/web/e2e/support/contrast.ts`'s
`clusterAt` comment (the two Cluster F elements, ratios 1.17 and 3.75,
stay un-allowlisted too — nothing here suppresses those either).

**Nothing is allowlisted, suppressed, or threshold-adjusted to reach this.**
`contrast-known-violations.json` stays empty. Every real violation —
the 394-tier debt below, the two Cluster F artifacts, anything else this
check finds — is still measured and still reported, as a failure, on every
single run. The only thing `continue-on-error` defers is whether a
first-ever check blocks the merge queue on debt it just discovered the
same night it was deliberately deferred.

### The rule

This step's `continue-on-error` comes off when:

1. **The 394-node sub-AA tier (2.0-4.5:1) reaches zero** against a live,
   full sweep — each node fixed, or individually confirmed not a violation
   and documented as such here. Allowlisting a node to make the count read
   zero does not satisfy this; the count is only honest if every
   undischarged node still shows up as a reported failure until it is
   actually resolved.
2. Whoever removes it cites the exact sweep run that reaches zero, the
   same way row 4 of the job-level rule above requires exact run IDs rather
   than "it's been a while."

### First documented slice of the 394 (2026-10-21)

Found by the first live run of `apps/web/e2e/contrast/store.spec.ts`,
`apps/web/e2e/contrast/settlements.spec.ts`,
`apps/admin/e2e/contrast/notifications.spec.ts` and
`apps/admin/e2e/contrast/logistics-hubs.spec.ts` — run `39562144657`, head
`2165da2`. Each spec's own originally-targeted belize-navy defect (store's
"Store: CLOSED", settlements' figures, notifications' "Unread only",
logistics-hubs' five courier-fee nodes) is confirmed fixed by #482/#483/
#487 and is **not** in this list — these 30 are the other elements the
same four routes surfaced once the check had something real to run
against. All measured at 320px only; the other 8 viewports in
`CONTRAST_VIEWPORTS` were not individually inspected tonight, per the
owner's reactive-coverage-only directive — root cause was not investigated
on any of these, only the ratio and the element.

| Route | Element | Ratio | Count |
| --- | --- | --- | --- |
| /dashboard/store | "Drivers navigate to the pin you drop here. Without one they only get the written address, and the delivery distance we e…" | 3.86 | 1 |
| /dashboard/store | "Sunday" / "Monday" / "Tuesday" / "Wednesday" / "Thursday" / "Friday" / "Saturday" (business-hours day picker) | 2.43 | 7 |
| /dashboard/settlements | "Pending settlement" | 3.46 | 1 |
| /dashboard/settlements | "Calculated, not yet posted to your wallet." | 3.59 | 1 |
| /dashboard/settlements | "Posted to wallet" | 3.77 | 1 |
| /dashboard/settlements | "Expand a row to see the full calculation for that order." | 3.77 | 1 |
| /dashboard/settlements | "Net earnings credited to your wallet." | 3.8 | 1 |
| /dashboard/logistics/hubs (OPS_LIMITED) | "Belize City, BELIZE · warehouse · LAND" | 3.6 | 1 |
| /dashboard/logistics/hubs (OPS_LIMITED) | "Belmopan, CAYO · warehouse · LAND" | 3.79 | 1 |
| /dashboard/notifications (SUPER_ADMIN) | "Mark all read" (button) | 1.5 | 1 |
| /dashboard/notifications (SUPER_ADMIN) | "7m ago" (timestamp, repeated per row) | 2.36 | 7 |
| /dashboard/notifications (SUPER_ADMIN) | "A passenger provider application was submitted and needs review." | 4.37 | 1 |
| /dashboard/notifications (SUPER_ADMIN) | "A passenger driver application was submitted and needs review." | 4.37 | 1 |
| /dashboard/notifications (SUPER_ADMIN) | "\"UAT Walkthrough Store\" submitted their storefront for review." | 4.37 | 1 |
| /dashboard/notifications (SUPER_ADMIN) | "A vendor application was submitted and needs review." | 4.37 | 1 |
| /dashboard/notifications (SUPER_ADMIN) | "A delivery driver application was submitted and needs review." | 4.37 | 1 |
| /dashboard/notifications (SUPER_ADMIN) | "An admin permission set was changed. Check the audit log for the before/after and who made the change." | 4.37 | 2 |

30 nodes total (8 + 5 + 2 + 15). 364 of the 394 remain unlocated — this
slice is a byproduct of four narrowly-scoped regression specs, not a
sweep of the deferred tier; req 9 owns actually finding and clearing the
rest.

### Current authoritative count, post-merge (2026-10-21, run `39566595024`)

Owner reopened the sweep (god → Jim, MDF-376, same thread) for a defensible
before/after number. This is that number, measured today against `main` at
`499af25` itself — the first push-to-main run after #469 merged, not a PR
run and not last night's pre-merge number quoted from memory.

**Re-run command** (reuses #469's harness exactly; no new instrument):

```
pnpm --filter @bmpl/web test:contrast
pnpm --filter @bmpl/admin test:contrast
```

In CI this is the existing `Contrast check -- requirement 7 (web)`/`(admin)`
steps inside the "Visual regression baseline (Priority 6)" job — any push to
`main` or PR into it re-runs both automatically. No local infra needed to
re-derive the count: pull the job's log and count.

**One-line result format** — every failing reading throws one
`assertRatchet` line containing the literal string `If this is real, fix
it`, one per (route, role, viewport) failure, because
`contrast-known-violations.json` is `[]` in both apps:

```
gh run view <run-id> --log --job <contrast-job-id> | grep -c "If this is real, fix it"
```

**Today's result: 493** failing readings (485 text + 8 icon) across the 90
route×role×viewport combinations the ten existing `e2e/contrast/*.spec.ts`
files cover (6 web specs + 4 admin specs × 9 `CONTRAST_VIEWPORTS` each).
Deduplicated by (route, accessible role, accessible name) that is **85
unique failing elements**, which split cleanly into two very different
things:

- **58 of the 85 are the Cluster F sampler artifact** already documented in
  both apps' `contrast.ts` (`clusterAt` samples the topmost painted pixel,
  not the element's own background) — every main-nav link (ratio ~1.0-1.3)
  and every `/products` category link (ratio ~2.4/3.75) on `/products` and
  `/vendors`. Known, not real, deliberately left un-allowlisted; counted
  here for honesty, not mistaken for debt.
- **27 are real** — the same four routes' debt already named above, now
  seen across all 9 viewports instead of only 320px, plus one not
  previously listed (`/dashboard/store`'s "Approval:" label, ratio
  2.04-2.24, visible at 8 of 9 widths) and the relative timestamps split
  into "6m ago"/"7m ago" (both render, depending on exact run time).

**This 27/493 is not the same measurement as last night's 394.** It is
real, current, and re-derivable — but it is scoped to only the ten routes
the existing contrast specs already visit, not a sweep of the whole app.
Last night's 394 claimed a wider scope ("1,792 nodes") that this harness,
run as-is, does not reach. Until something sweeps every route (req 9's
job), **this is the authoritative number for the ten instrumented routes,
not a refresh of the full-app 394.** Whoever quotes a before/after figure
in the completion report should say which of the two they mean.

### Reconciled against Oscar's 355 (2026-10-21, same thread)

The owner independently accepted Oscar's dedup of the original raw sweep:
422 raw rows -> **355 unique**, keyed on `(route, matchedClass, tag, text)`,
filtered to ratio `[2.0, 4.5)`. Reproduced exactly from Oscar's own
`widened-*.json` files (`hive/agents/bmpl-qa-mtmcz0m1/MDF-376-prod-verify/`,
23 files, 1,894 raw rows before any filter) — 422 in-band, 355 unique under
all three boundary interpretations tried (`[2,4.5)`, `[2,4.5]`, `(2,4.5)`),
so the 2.0/4.5 boundary is not the source of any gap.

**My 27 (live, #469 harness) and his 355 (static CSS-class scan of an older
snapshot) do not disagree about the underlying defects — they disagree in
scope and in method, and both are explainable:**

1. **Scope: 285 of his 355 (80%) are on 53 routes my ten contrast specs
   never visit at all.** Not comparable without wider spec coverage —
   that is new work (req 9), not a discrepancy in either count.
2. **Dedup granularity goes the other way than you'd expect.** On the 6
   routes we both cover, his text-exact key produces 70 "unique" rows that
   collapse to only **14 distinct (route, CSS-class, tag) defect classes**
   once you group by class instead of by exact text — most of the 70 are
   the same class rendering different message bodies (notification feed
   items, hub names). My 27 is already element-level, closer to his
   14-class figure than to his 70-row figure for the same ground.
3. **CORRECTION (2026-10-21 — the original version of this point was
   wrong):** `/dashboard/logistics/hubs`'s "Courier rate BZ$X.XX" rows
   (ratio 2.43, `admin_ops_limited`/`hubs_ops_limited` only) were **not**
   fixed at `499af25`. Verified directly against source
   (`hubs/page.tsx:307-311`): the dollar-figure span next to the label is
   `--bmpl-text` (fixed earlier tonight), but the "Courier rate" LABEL
   itself is a separate `<p>`, still `text-slate-600`, unchanged at
   `499af25`. It was fixed afterward, in a later batch — after this entry
   was first written, not before. The original claim ("my live run does
   not have them, confirmed fixed") stated a possibility as a fact: my
   live run not finding them is evidence my run didn't see them, not
   evidence they were already gone, and that gap is exactly where the bug
   in my reasoning lived.
   **The node is real, at approximately 2.4:1, and absent from the live
   sweep — an instrument gap, not a pass.** Ran, not skipped: both
   `main @ 499af25` (run `39566595024`) and `chore/contrast-sweep-mdf376`
   (PR #490, run `39653113575`) show this spec failing, not skipping, with
   real `assertRatchet` violation text at every viewport. Hub list
   populated, not empty: both runs measure two real hub rows
   (`Belize City, BELIZE · warehouse · LAND`, `Belmopan, CAYO · warehouse ·
   LAND`) — if `hubs` were `[]` there would be nothing to report at all.
   Card confirmed dark glass, not light: `AdminShell.tsx:161` sets
   `data-theme="glass"` on the whole admin console, and the arithmetic for
   `text-slate-500`/`text-slate-600` against that glass card's actual
   composited background (`rgba(10,20,38,0.56)` over the `#0a1526` mural)
   reproduces the two *other* violations reported on this same card to one
   decimal place (`text-slate-500` -> ~3.6/~3.79, matching the
   `3.6`-`3.79` measured above for the hub description text) — and the
   same arithmetic for `text-slate-600` lands at ~2.4, matching Oscar's
   2.43 for this exact label. Label confirmed rendering, not gated off:
   `hubs/page.tsx:94`, `setCanManage((me.adminPermissions ?? []).includes(
   'logistics.manage'))` — `OPS_LIMITED` does not hold that permission, so
   `canManage` is `false` and the `!canManage` paragraph (the one
   containing "Courier rate") is the one that renders.
   So: Oscar's 2.43 was correct, and my live sweep under-reported this
   node — **the 27-real figure is a floor, not a total.** Mechanism for
   the miss is unconfirmed; one candidate, named as a candidate only and
   not investigated further: the paragraph is mixed content, `Courier
   rate <span>BZ$...</span>`, and the span is already `--bmpl-text` and
   passing — a sampler that resolves one color per element could be
   attributing the parent to its (passing) child's color instead of its
   own. If that is the mechanism it would not be unique to this node:
   `Label <span>value</span>` is a common shape in this codebase, which is
   why it is recorded even unconfirmed.
4. **Two of his 14 classes are role/app scope gaps on my side, not
   methodology noise.** `/dashboard/notifications`'s `A.text-belize-blue`
   "Preferences" link and `/dashboard/settlements`'s `P.text-slate-400`
   "Default X.00%" rows exist only on a *different role's page* at the
   same URL path — `web_customer`'s notification preferences and the
   admin settlement-config view — neither of which any of the four
   existing MDF-376 regression specs log into. Named, not silently
   dropped: worth a new spec if the owner wants that page covered, not
   something to invent coverage for here.
5. **The remaining 11 of his 14 classes converge with mine within
   measurement-method tolerance** (his static CSS-declared-color
   calculation vs my live composited-pixel sample): 3.87 (his) vs
   3.3-3.9 (mine) on the settlements/store/hubs prose classes, 2.43 vs
   2.43 on the day-picker and hub courier-rate classes, 2.36 vs 2.36 on
   the relative-timestamp class, ~2.1 vs 1.34-1.62 on "Mark all read"
   (the largest single delta — plausibly the glass/backdrop-blur
   difference #469's live sampler exists to catch and a static
   class-color calculation cannot).
6. **One of my 27 has no counterpart in his 355 at all:**
   `/dashboard/store`'s "Approval:" label (ratio 2.04-2.24). Not stale,
   not a scope gap I can name — flagged honestly as unreconciled rather
   than assumed either way. Possibly state-gated (a pending-approval
   vendor state his sweep's fixture wasn't in); root cause not
   investigated, same discipline as the rest of this list.

**The generalizable finding (worth more than the three nodes in point 3
above): the two sweeps have opposite blind spots, and each one's clean
result can mean "fixed" or can mean "never reached the gate" — the
instrument cannot tell you which.** My live sweep missed the hubs
courier-rate label because a gated render path kept it from ever being
discovered, not because it was absent. Oscar's static sweep separately
missed `/dashboard/store`'s "Approval:" label (point 6) because its
fixture never reached the data state that renders it. A role gate defeats a live probe that logs in as the wrong account. A
data-state gate defeats a static sweep that never produces that state. And
per point 3, a live probe can also under-report a node that is real,
rendering, on the correct account, for a reason that is neither of those —
an element-level sampler meeting a sub-element reality (mixed content,
`Label <span>value</span>`, candidate only, unconfirmed). **Absence from
either sweep is not evidence of absence; it is evidence of where that
sweep did not look, or of how it looked.** A route or route+role reporting
zero findings is a claim about what was measured, never a claim about what
exists — true of the 355, true of my 27/493, and true of the contrast
gate itself once anyone starts treating a green run as proof nothing is
wrong rather than proof nothing *measured* was wrong.

**Conclusion: no rounding either way, and my own count is a floor, not a
total.** Where the two methods measure the same ground, they mostly agree,
and where they don't, point 3 shows my live sweep is the one that
under-counts, not Oscar's that over-counts. The headline gap (493/85/27 vs
355) is explained by scope (1, mostly), dedup granularity (2), and — per
the point above — by each method's own blind spots, not by either count
being simply wrong. `contrast-known-violations.json` stays `[]` in both
apps; nothing here is an allowlist entry or a baseline edit.

**Reporting cadence as Oscar's batches land:** this document's own count
(27 real elements / 493 readings, ten routes) is the one this harness can
re-derive after each batch with the command above. The full 355 is scoped
to ~89 routes this harness does not sweep — it moves only when Oscar
re-sweeps and re-dedupes his own data, not when this harness re-runs. Each
per-batch report should say which of the two it's reporting against.

| Route | Element | Ratio range | Viewports failing (of 9) |
| --- | --- | --- | --- |
| /dashboard/store | "Approval:" | 2.04-2.24 | 8 |
| /dashboard/store | "Drivers navigate to the pin you drop here..." | 3.86 | 9 |
| /dashboard/store | "Sunday"/"Monday"/"Tuesday"/"Wednesday"/"Thursday"/"Friday"/"Saturday" | 2.43 | 9 each |
| /dashboard/settlements | "Pending settlement" | 3.46-3.63 | 5 |
| /dashboard/settlements | "Calculated, not yet posted to your wallet." | 3.53-3.73 | 8 |
| /dashboard/settlements | "Posted to wallet" | 3.3-3.77 | 6 |
| /dashboard/settlements | "Expand a row to see the full calculation for that order." | 3.76-3.8 | 9 |
| /dashboard/settlements | "Net earnings credited to your wallet." | 3.41-3.8 | 9 |
| /dashboard/logistics/hubs (OPS_LIMITED) | "Belize City, BELIZE · warehouse · LAND" | 3.41-3.67 | 9 |
| /dashboard/logistics/hubs (OPS_LIMITED) | "Belmopan, CAYO · warehouse · LAND" | 3.73-3.79 | 9 |
| /dashboard/notifications (SUPER_ADMIN) | "Mark all read" (button) | 1.34-1.62 | 9 |
| /dashboard/notifications (SUPER_ADMIN) | "6m ago" / "7m ago" (timestamp) | 2.36 | 5 each |
| /dashboard/notifications (SUPER_ADMIN) | five application-review toast lines + "An admin permission set was changed..." | 4.37 | 9 each |
| /dashboard/store/preview (VENDOR) | "Rated 0.0 out of 5 from 0 reviews" (icon) | 1.01-1.3 | 8 |
| /products | "Category" (filter label) | 2.56 | 5 |

Not root-caused here, same as last night's slice — counted and located
only. Regression cover: the four MDF-376 specs (`store`, `settlements`,
`notifications`, `logistics-hubs`) re-run on every push/PR automatically as
part of this same job; a fix landing for any named element above will show
up as that element dropping out of the next run's "If this is real" count
without anyone needing to re-derive the baseline by hand.

**Cluster F guard, verified by CI (2026-10-21, PR #490, run `39653113575`,
head sha matches commit `39101d6` on `chore/contrast-sweep-mdf376`):** this
is the first CI run to include `isInsideClosedDetails` (commit `6525883`).
Before (run `39566595024`, pre-guard, `main @ 499af25`): 493 failing
readings / 85 unique `(route, role, name)` elements. After: 283 failing
readings / 26 unique elements.

The guard removed **exactly 58** unique elements — all `link`-role, all on
`/products` (45) or `/vendors` (13), the full Cluster F set: the desktop nav
dropdown's category links (Header.tsx) and the mobile category disclosure's
links (CategoryNav.tsx), both closed `<details>` at sweep time. Named in
full: Accessories, Automotive, Baby Gear, Become a Marketplace Vendor,
Beverages, Cameras, Camping & Hiking, Car Care, Cosmetics, Cycling, Drive
Ride or Deliver, Fashion & Apparel, Find Work, Fitness, Food & Grocery,
Fresh Produce, Furniture, Garden & Outdoor, Health & Beauty, Home & Garden,
Home Decor, Kids' Clothing, Kitchen & Dining, Marketplace, Men's Clothing,
Orders, Pantry Staples, Parts & Accessories, Passenger Service, Personal
Care, Post Jobs, Rent, Sale, Shipping & Delivery, Shoes, Skincare, Snacks,
Sports & Outdoors, Supplements, Toys & Games, Toys Kids & Baby, Upload
Resume & Skills, Vendors, View Cart, Women's Clothing (on `/products`); and
Become a Marketplace Vendor, Drive Ride or Deliver, Find Work, Marketplace,
Orders, Passenger Service, Post Jobs, Rent, Sale, Shipping & Delivery,
Upload Resume & Skills, Vendors, View Cart (on `/vendors`, same shared nav,
separate route).

A separate, unrelated 3-element churn landed in the same diff: two
`/dashboard/notifications` relative timestamps present in the baseline
("6m ago", "7m ago") are absent here, and one not in the baseline ("5m ago")
appears instead — the underlying defect (ratio 2.36, role `(none)`) is
unchanged; only the elapsed wall-clock time between notification creation
and test run shifted the label between the two runs. Not a fix, not
attributable to the guard. Net real tier: 27 -> 26 (27 - 2 relabeled +
1 relabeled), same defects, one relabeled by clock drift — the 26 remaining
elements otherwise match the 27 named in the table above one-for-one.

No allowlist entry, no threshold or baseline edit, anywhere — this is the
harness measuring fewer elements because fewer are discovered as
non-painted, not because any entry was suppressed.

**27 is a floor, not a total.** The hubs "Courier rate" label (point 3,
above) is a confirmed real ~2.4:1 violation that this harness does not
discover at all — an instrument gap, not a defect that was fixed or that
never existed. The true count of real debt on these ten routes is at least
27 (26 after the clock-drift relabel above); it is not known to be exactly
that, because this harness can miss a node the way it missed this one.

### Foreground-alpha bug — a defect in the gate itself (2026-10-21/22, #503)

Oscar found it measuring a real node; god confirmed it reached CI.
`parseRgb` (`contrast.ts`) and `parseRgbLocal` (`contrast-sweep.ts`), all
four copies across both apps, discarded a foreground color string's alpha
channel — a translucent foreground like `text-white/80` was scored as if
fully opaque. The error runs in only one direction: compositing is a convex
combination, so the composited foreground can never cross past the
background, which means discarding alpha can only overstate a ratio, never
understate it — a gate that can silently PASS a real FAIL.

Fixed in `fix/contrast-foreground-alpha` (branched fresh off `main @
2e87093`, `chore/contrast-sweep-mdf376` being dead — see below). All four
parsers now return `{rgb, alpha}`; one exported `compositeOver(fg, alpha,
bg)` in `contrast.ts` is imported by both `contrast-sweep.ts` copies rather
than reimplemented, so the sweep and the gate share one formula.
`foreground` fields now report the post-composite color actually used for
the ratio, so a failure's reported ratio is reproducible by hand from the
two colors it prints — not true before this fix.

**Before/after, same commit pinned on both sides, auditable:** before =
run `39707392238` on `main @ 2e87093` (broken gate, the exact commit the
fix branched from). After = run `39708563032` on PR #503 (`51288a0`, the
fix, same commit plus only this change). Both: 84 failing readings on the
ten existing regression routes.

- **Raw flip count (nodes the corrected gate newly fails that the broken
  gate passed): 0.** Diffed every `(route, role, name, viewport)` ratio
  individually, not just the unique-element count — 22 keys appear as
  failing in both runs, and every one of the 22 has the byte-identical
  ratio in both (e.g. `/dashboard/store/preview` icon "Rated 0.0 out of 5
  from 0 reviews" stays at the same ratios at every viewport). 0 nodes
  changed ratio while keeping the same verdict, on these ten routes.
- **Any PASS this effort relied on invalidated? None, measured, not
  assumed.** The only non-identical unique-element-count change (4 unique
  before -> 5 after) is the same clock-drift artifact documented earlier in
  this file: `/dashboard/notifications`'s relative timestamp reads "6m ago"
  in the before run and "5m ago" in the after run, same underlying node,
  same ratio (`1.02` in both, exactly) — wall-clock drift between
  notification creation and test run, nothing to do with alpha.
- **Translucent text on these ten routes: none detected.** The "ratio
  changed but verdict same" count god asked for (a proxy for how much
  translucent text exists) is 0 here too, for the same reason as the flip
  count — every failing node on these routes has an opaque foreground.
  This bounds what these ten routes can tell us about the bug's reach, not
  the app overall — see the coverage gap below.
- **Calibration, checked analytically against the fix's own formulas**
  (`relativeLuminance`/`contrastRatioOf`/`compositeOver`, run standalone,
  not from a live page): `--bmpl-oncolor-light-text-muted` (`#475569`) on
  `#ffffff` computes to `7.5777`, matching the cited `7.579` to within
  rounding — opaque nodes are unaffected, as the no-op-at-alpha-1 branch
  guarantees by construction. `text-white/70` on `rgb(52,83,183)`
  (`bg-belize-blue`) computes to `4.26` (fails 4.5) under the corrected
  formula, against `6.85` under the broken one (alpha discarded) — matching
  the broken gate's own cited `6.85:1` misreading exactly. `text-white/80`
  on the same background computes to `5.03`, matching the cited post-#501
  target exactly.
- **Coverage gap, stated rather than guessed:** the message-bubble node
  itself (`#501`'s subject) is not on any of the ten routes these
  regression specs cover — confirmed by searching this run's full log;
  every "message" match is a sidebar nav link's accessible name
  ("Messages"), not the chat bubble. This harness cannot report that
  node's live verdict; the calibration above is this fix's formula checked
  against the cited numbers in isolation, not a live measurement of that
  specific element.

No allowlist entry, no threshold or baseline edit; `continue-on-error`
untouched; both apps' `contrast-known-violations.json` stay `[]`.

## Review-before-update workflow (the same document records this because the
same failure shape applies — the easy path must be the safe one)

The short version is below; the full step-by-step runbook — what to run,
what to review, who approves, and the one open mechanical gap (no CI
update-mode trigger exists yet) — is
[`docs/visual-baseline-update-procedure.md`](visual-baseline-update-procedure.md).

- The main run command (`pnpm test:visual`, and the CI job) never carries
  `--update-snapshots`. A mismatch always fails loud, never silently heals.
- A failure uploads Playwright's own expected/actual/diff triptych as a CI
  artifact (`visual-diff-report-web` / `visual-diff-report-admin`) —
  reviewing a failure is "open one artifact," not "clone the repo and diff
  PNGs by hand."
- Updating a baseline is a separate, explicit, name-scoped command:
  `pnpm test:visual:update -- -g "<exact test name>"`. Scoped by name on
  purpose — **this is a different hazard class from the `-t` filter warning
  in root CLAUDE.md §10.** That warning is about the *integration* suite,
  where tests in one file share `let`-scoped state and a name filter can
  silently skip past state another test set up. Visual-baseline tests are
  independent per route/role/viewport with nothing shared across tests, so
  a name-scoped update here is safe in a way it explicitly is not there.
  Said here, not just in the command's own comment, so the two don't get
  conflated by a future reader pattern-matching "name filter = dangerous."
- The resulting PNG change is its own commit, with its own one-line entry
  in the log below (date, test, reason, who approved), reviewed through the
  same PR+review+merge path as any other change — never bundled silently
  inside an unrelated feature PR.

## Run log

| Date | Run ID | Result | Notes |
| --- | --- | --- | --- |
| _(empty — the CI job does not exist on `main` yet; Phase 1 is infra only, no baselines, nothing to log)_ | | | |

## Baseline-update changelog

| Date | Test | Reason | Approved by |
| --- | --- | --- | --- |
| _(empty — no baseline has been captured yet)_ | | | |

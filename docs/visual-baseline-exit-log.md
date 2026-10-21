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

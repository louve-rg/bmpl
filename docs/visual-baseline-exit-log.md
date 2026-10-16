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

# Updating a visual baseline

Priority 6 remediation (owner directive, 2026-10-16). This is the piece most
pixel-baseline suites skip, and why most of them get deleted six months
later: a baseline nobody knows how to update correctly becomes a permanently
red check that everyone learns to ignore. This document is the thing the
next person runs, reviews, and gets approved — not a comment buried in a
config file.

Read this **before** your first baseline update, not after you're already
staring at a red diff. See also
[`docs/visual-baseline-exit-log.md`](visual-baseline-exit-log.md) for the
written exit criterion governing when this suite is even allowed to start
blocking a merge — that document's own "Review-before-update workflow"
section is the short version of what follows here.

## 1. When does a baseline need updating?

Only when **a UI change is intentional and you want the suite to stop
flagging it.** Two situations, told apart up front because they are handled
completely differently:

- **You just changed the UI on purpose** (a redesign, a copy change, a new
  component) and the suite correctly caught it. This is the case this
  document covers.
- **The suite is red and you do not believe the UI actually changed** (a
  flaky diff, a font-loading race, an animation that didn't settle). This is
  **not** a baseline-update situation — it's a determinism bug in the spec
  or in `support/visual.ts`. Fix the determinism, don't update the baseline
  to paper over it. If you're not sure which case you're in, you're in this
  one — stop and investigate before touching a PNG.

## 2. Baselines are captured in CI, never on a laptop

`apps/{web,admin}/playwright.visual.config.ts` says this in its own header,
and it's worth restating here because it's the first thing anyone will want
to skip: **Playwright's screenshot output is not guaranteed pixel-identical
across operating systems or font-rendering stacks.** A baseline captured on
a developer's own machine (Windows, macOS, a different Linux font package)
will fail for every other reviewer and for CI itself, forever — not
flakily, every single time. `pnpm test:visual:update` exists as a command
but running it on your own machine and committing the result is the exact
mistake this whole procedure exists to prevent.

**Baselines are captured only on `ubuntu-latest`, inside the same CI job
that verifies them** (`.github/workflows/ci.yml`, "Visual regression
baseline"). Everything below assumes that constraint.

## 3. The actual steps

1. **Make your real UI change first, on its own branch, and get it merged
   (or at least reviewed) on its own merits** — a baseline update is never
   bundled into the same commit as the change that caused it. If you bundle
   them, a reviewer cannot tell "is this diff correct because the new UI is
   correct" from "did they just silently update the baseline without
   looking."
2. **Run the normal verify command against your change and read the
   failure.** Either locally with a local API/DB (if you have one — see
   `docs/visual-baseline-exit-log.md` for why CI remains the authority even
   so), or by pushing a branch and letting `ci.yml`'s job run in its normal,
   non-update mode. It will fail exactly where your change moved pixels.
   **Read the failure before doing anything else** — the artifact
   (`visual-diff-report-web` / `visual-diff-report-admin`, uploaded only on
   failure) contains Playwright's own expected/actual/diff triptych for
   every mismatched test. Open it. Confirm every single failing test is a
   pixel you *meant* to move, not a surprise. A baseline update that also
   silently absorbs an unrelated regression is worse than the regression
   alone, because it deletes the evidence.
3. **Run the update command, scoped by name, from the same CI job —
   not locally.** This is the one mechanical step this document cannot yet
   give you a copy-pasteable trigger for: as of this writing, `ci.yml` has
   no `workflow_dispatch` or other manual-trigger path that runs the visual
   job in update mode. Until that exists, the practical options are (a) ask
   whoever owns `ci.yml` changes to add a scoped, manually-triggered
   update job when the first real update is needed, or (b) run
   `pnpm --filter @bmpl/web test:visual:update -- -g "<exact test name>"`
   (or `@bmpl/admin`) inside a throwaway `ubuntu-latest` environment that
   matches the CI job's own services/seed/API setup exactly — never on a
   developer machine, per §2. Flagging this now rather than inventing a
   trigger mechanism myself: **building that trigger is a `ci.yml` change
   and needs the same review-before-merge any other `ci.yml` change does**,
   not something to improvise the first time someone needs it.
   The `-g "<exact test name>"` scoping is deliberate and **safe here in a
   way it is not for the integration suite**: root `CLAUDE.md` §10 warns
   that a `-t`/`-g` name filter against the integration suite can silently
   skip past `let`-scoped state another test in the same file set up.
   Visual-baseline tests are independent per route/role/viewport with
   nothing shared across tests, so scoping an update by name here cannot
   produce that failure mode. Said here as well as in the exit-log doc so
   the two don't get conflated by a future reader pattern-matching "name
   filter = dangerous" without checking which suite they're in.
4. **Download the updated PNG(s) from that CI run and look at them
   yourself**, side by side with the diff from step 2. Confirm the new PNG
   shows what you intended and nothing else — no stray console error
   banner, no loading spinner caught mid-frame, no unrelated element that
   happened to also move. This is a human looking at an image, not a tool
   decision.
5. **Commit the PNG(s) as their own, clearly-labelled commit** — never
   mixed into an unrelated feature commit, per `visual-baseline-exit-log.md`.
   The commit message names the test(s) and the reason in one line (e.g.
   "test(visual): update VendorStorefront/desktop baseline — new banner
   layout per #NNN").
6. **Add a row to the Baseline-update changelog table in
   `docs/visual-baseline-exit-log.md`** — date, test name, reason, who
   approved. That table is the permanent record of every intentional pixel
   change this suite has ever accepted; it is what makes a six-month-old
   baseline legible instead of a mystery.
7. **Get the commit reviewed and merged through the normal PR path** —
   same review as any other change, never self-merged, never fast-tracked
   because "it's just a PNG."

## 4. Who approves

The same person who would approve the UI change itself. A baseline update
is not a separate lower-bar decision — it is the formal record that "yes,
this new render is the correct one," and should get exactly the scrutiny a
reviewer would give the screenshot if they saw it any other way. If the UI
change already went through review on its own branch (step 1), the baseline
update's approval can be lighter — "does this PNG match the change we
already approved" — but it is never zero-review.

## 5. What this procedure deliberately does not cover yet

- **No automated "update mode" trigger exists in `ci.yml` yet** (§3, step
  3). The first real baseline update will need to either add one (as its
  own reviewed `ci.yml` change) or run the update command in a manually
  matched `ubuntu-latest` environment. Whoever does this first should fold
  the trigger they built back into this document.
- **This procedure governs updating an *existing* baseline.** Capturing the
  *first* baseline for a new route/role/viewport is covered by the Phase 2
  harness build, not this document — see
  `hive/agents/jim-mv09alb5/priority6-visual-baseline-approach-2026-10-16.md`.
- **No baseline PNGs exist yet as of this writing.** This procedure is
  written ahead of the first capture, deliberately — see
  `docs/visual-baseline-exit-log.md`'s opening paragraph for why "write it
  once it's needed" was rejected on purpose for this suite.

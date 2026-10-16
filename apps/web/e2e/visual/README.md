# Pixel-baseline visual-regression specs

Phase 1 (infra only — Priority 6, owner directive 2026-10-16) ships exactly
one spec here, `smoke.spec.ts`, and it is not a baseline: no
`toHaveScreenshot`, no committed PNG. It proves the new CI job's chain
actually works end to end (seed → live API → dev server on 3177 under Linux
→ browser → login) rather than just "the steps executed" — see its own
header comment. Delete it once Phase 2 adds a real baseline spec that
exercises the same login path with an actual screenshot assertion.

Baseline PNGs committed under this directory are never captured locally —
see `../support/visual.ts` and `docs/visual-baseline-exit-log.md` for the
determinism design and the review-before-update workflow before adding a
spec here.

Phase 2 excludes, until the relevant fix lands: navigation / account panel /
role switcher, the booking form (`shipments/new`), and
`components/marketing/AnalyticsPanel.tsx` and its call sites (live P1,
2026-10-16).

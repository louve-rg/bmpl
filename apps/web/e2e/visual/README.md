# Pixel-baseline visual-regression specs

Intentionally empty in Phase 1 (infra only — Priority 6, owner directive
2026-10-16). `pnpm test:visual` will report "no tests found" and exit
non-zero until Phase 2 adds the first spec here — that is expected, not a
finding; see the CI job comment in `.github/workflows/ci.yml` for why this
step is `continue-on-error` during this phase regardless.

Baseline PNGs committed under this directory are never captured locally —
see `../support/visual.ts` and `docs/visual-baseline-exit-log.md` for the
determinism design and the review-before-update workflow before adding a
spec here.

Phase 2 excludes, until the relevant fix lands: navigation / account panel /
role switcher, the booking form (`shipments/new`), and
`components/marketing/AnalyticsPanel.tsx` and its call sites (live P1,
2026-10-16).

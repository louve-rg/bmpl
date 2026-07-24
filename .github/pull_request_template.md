# Summary

<!-- What does this PR change and why? -->

## Phase / scope

- [ ] This PR does **not** introduce Phase 2 domain features (marketplace,
      products, cart, orders, delivery, passenger, jobs, real estate, marketing,
      live wallet transfers).

## Checklist

- [ ] `pnpm install --frozen-lockfile` succeeds
- [ ] `pnpm -w typecheck` passes
- [ ] Unit tests pass (`pnpm -w test`)
- [ ] Integration tests pass locally (`pnpm --filter @bmpl/api test:integration` with infra up)
- [ ] Prisma schema changes include a **migration** (no `db push`)
- [ ] No secrets committed; `.env` changes are reflected in `.env.example` (placeholders only)
- [ ] Security-sensitive changes (auth, CSRF, rate limits, storage, cookies) are covered by tests
- [ ] Docs updated where relevant (`README`, `docs/`, env matrix)

## Screenshots / notes

<!-- Optional -->

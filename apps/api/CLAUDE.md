# CLAUDE.md — `apps/api`

Read the [root `CLAUDE.md`](../../CLAUDE.md) first. This file covers what is
specific to the API.

NestJS 10. **This is the only application in the monorepo that talks to the
database, and the only place authorization is enforced.** 40 modules, 57
controllers, ~549 routes, 77 services.

---

## 1. The guard chain

Registered globally in `src/app.module.ts` as `APP_GUARD`s, and they run in
this order:

```
BmplThrottlerGuard  ->  CsrfGuard  ->  JwtAuthGuard  ->  RolesGuard  ->  PermissionsGuard
```

**Every route is authenticated by default.** The decorators
(`src/common/decorators.ts`):

| Decorator | Meaning |
| --- | --- |
| `@Public()` | No authentication. Every use is a deliberate, reviewable decision. |
| `@Roles(...codes)` | Caller must hold **at least one** of these roles as `APPROVED`. |
| `@RequirePermission(...perms)` | Caller must hold **all** of these admin permissions. |
| `@CurrentUser()` | Injects the authenticated `AuthContext`. Throws if used on an unguarded route. |
| `@StrictThrottle()` | Tight per-IP rate limit. Use on auth, upload, signed-URL and funding routes. |

Rules:

- **Never** add `@Public()` to reach data that belongs to somebody.
- **Never** reorder, disable or bypass a guard to make a test pass. If a test
  needs a session, build one — see `test/helpers.ts`.
- CSRF applies to browser cookie mutations. Mobile `Bearer` requests are exempt
  by design; do not extend that exemption to cookie auth.

## 2. Authorize on the user id, not the active role

A person holds many roles simultaneously. `AuthContext` carries both the
underlying `userId` and the active role. **Ownership and conflict-of-interest
checks must use `userId`.**

This is the single most-regressed invariant in this codebase: a customer was
once dispatched their own delivery to drive, because the check compared active
roles. It covers automatic dispatch, the available-jobs feed, direct lookup,
direct accept, admin assignment and admin reassignment, for both marketplace
deliveries and shipping courier legs.

If you touch `src/dispatch`, `src/driver`, `src/delivery` or `src/shipping`,
run:

```bash
pnpm --filter @bmpl/api test:integration -- self-delivery self-courier
```

## 3. Controller naming convention

The prefix tells you the audience, and therefore the guard you should expect:

| Pattern | Audience | Typical guard |
| --- | --- | --- |
| `<domain>-public.controller.ts` | Anonymous browse/search | `@Public()` |
| `<domain>.controller.ts` | The signed-in owner of the data | `@Roles(...)`, self-scoped queries |
| `vendor-<domain>.controller.ts` | Approved vendor, own store only | `@Roles('VENDOR')` + ownership check |
| `driver-<domain>.controller.ts` | Approved driver | `@Roles('DELIVERY_DRIVER')` |
| `admin-<domain>.controller.ts` | Admin console | `@RequirePermission(...)` |

A self-scoped read must filter by `user.userId` in the query — never fetch then
compare in application code, and never trust an id from the request body.

## 4. Validation

Request bodies are validated with Zod schemas from `@bmpl/validation`, applied
through `ZodBody(schema)` (`src/common/zod-validation.pipe.ts`).

**Do not write a validation rule inline in a controller if the browser also
needs it.** It belongs in `packages/validation`, imported by both. A rule stated
twice is a rule that will eventually disagree with itself — that is exactly how
the pin-only address defect happened: the form accepted a dropped pin and the
API schema then demanded a typed street.

## 5. Money

See root `CLAUDE.md` §4 — all of it applies. API-specific:

- All ledger movement goes through `WalletService`. Nothing else writes
  `WalletAccount` balances, and balances are derived, not stored-and-updated.
- Amounts are `BigInt` minor units. Do not convert to `number`.
- `isTest` is read from the account or escrow inside the service. **Never accept
  it from a request body**, and never pass it through a DTO.
- Wallet writes take row locks and unique transaction references; checkout uses
  idempotency keys. Preserve both — a wallet was once overspendable by
  concurrent requests.
- `src/payments`, `src/settlement` and `src/wallet` deliberately have **no**
  capture, refund, payout or withdrawal endpoints. Do not add one.

## 6. Audit

Privileged and money-touching actions are recorded through `AuditService.record()`,
which accepts an optional Prisma transaction client:

```ts
await this.audit.record({ action, actorId, targetUserId, previousValue, newValue, reason }, tx);
```

- Pass `tx` when the audit must land atomically with the change it describes.
- `actorId: null` means "no signed-in person did this" — record that truthfully
  rather than attributing a system action to a user.
- New audit actions are added to the `AuditAction` enum via a migration (see
  `packages/database/CLAUDE.md`).
- **Never delete or rewrite an audit record.**

## 7. Tests

Two suites, two configs:

```bash
pnpm --filter @bmpl/api test              # vitest, unit, no infrastructure
pnpm --filter @bmpl/api test:integration  # vitest.integration.config.ts
```

The integration suite (**691 tests across 55 spec files**) runs against **real
Postgres, Redis and MinIO**. It requires `TEST_DATABASE_URL` and fails loudly
without it; `globalSetup` runs `prisma migrate deploy` against that database.

Use `test/helpers.ts` rather than rolling your own setup — it provides
`bootApp()`, `resetDb()`, `seedRoles()`, `seedSuperAdmin()`, `seedLimitedAdmin()`,
`seedJobCategories()`, `cookiesOf()`, `cookieValue()` and `putToPresigned()`.

**A behavioral change lands with a test.** Money, authorization, dispatch,
routing and validation changes land with an *integration* test.

`typecheck` covers both source and tests:
`tsc --noEmit && tsc --noEmit -p tsconfig.test.json`.

## 8. Configuration

Environment is parsed and validated once by a Zod schema in `src/config/env.ts`
and injected as `ENV`. **Never read `process.env` directly in a service** — add
the variable to the schema, with a safe default, and inject it.

A blank or malformed value once stopped the API booting (`9f6697a`); the schema
is where that gets caught. Optional flags must be safe when absent, and
security-relevant flags must default to **off** when absent.

Dev-only modules (`src/dev`) are excluded at runtime when `NODE_ENV=production`.
Keep it that way.

## 9. Deployment

Railway, from `apps/api/Dockerfile`, configured by the root `railway.json`.

- `preDeployCommand` runs `prisma migrate deploy`, so a failed migration fails
  the deploy rather than half-applying it.
- Health: `/api/health` (reports the commit being served);
  readiness: `/api/health/ready` (probes database, redis, storage).
  **`/api/health/live` does not exist** — do not look for it or add a caller.
- Deployment happens on merge to `main`. That requires human approval (root
  `CLAUDE.md` §11).

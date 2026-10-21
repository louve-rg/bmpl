# Phase 1.5A — Local Integration Verification Report

**Objective:** prove that authentication, role approval, role switching, audit
logging, notifications, storage, and administration work end-to-end against
**real** PostgreSQL, Redis, and MinIO. No production/deploy preparation.

**Result: ✅ GO** for deployment preparation. Every workflow below was executed
against real infrastructure; all automated tests pass.

---

## 1. Runtime

| | Version | Notes |
|---|---|---|
| Node.js | **v24.12.0** | Node 24 is current Active LTS ("Krypton"). Pinned in `.nvmrc` / `.node-version`. `engines` = `>=22 <25` (Node 22 or 24 LTS). |
| pnpm | **9.15.9** | `packageManager` + `engines.pnpm` = `>=9 <10`. |
| argon2 | 0.41.1 | Installs + compiles under Node 24; verified a real `argon2id` hash + verify at runtime. |

## 2. Infrastructure status

No container runtime was available (no Docker/Podman/WSL), so infrastructure was
provisioned from **portable binaries** (scripted in `scripts/dev-infra/`).
`docker-compose.yml` remains the preferred path where Docker exists.

| Service | Port | Health |
|---|---|---|
| PostgreSQL 16.4 | 5432 | ✅ `bmpl` + `bmpl_test` databases created; credentials match `.env` |
| Redis (5.0.14) | 6379 | ✅ `PING → PONG`; wired into API readiness |
| MinIO | 9000 / 9001 | ✅ private bucket `bmpl-documents` auto-created; reachable |

Live readiness probe from the running API:
`GET /api/health/ready → 200 {"status":"ready","checks":{"database":true,"redis":true,"storage":true}}`
— the API is bound to real infra, not mocks/in-memory.

## 3. Migration

- **Name / location:** `packages/database/prisma/migrations/20260723233020_init/migration.sql`
- Created with `prisma migrate dev`; verified to apply to a **completely clean**
  database with `prisma migrate deploy` (on `bmpl_test`).
- **Objects:** 16 tables, 14 enums, 47 indexes (Prisma renders `@@unique` as
  unique indexes), 18 foreign keys.
- **FK integrity (key rules):**
  - `audit_logs.actorId` / `targetUserId` → **SET NULL** — deleting a user
    **preserves** audit history.
  - `wallet_ledger_entries.accountId` → **RESTRICT**, and
    `wallet_ledger_entries.transactionId` → **RESTRICT** (hardened from CASCADE)
    — ledger entries cannot be silently removed via ordinary relationships.
  - `role_application_reviews.reviewerId` → SET NULL — review history survives.
- **Money:** `BIGINT` minor units (`amountMinor`, `cachedBalanceMinor`).
- **Timestamps:** `TIMESTAMP(3)`, normalized to UTC by Prisma (consistent).
- `prisma db push` was **not** used.

## 4. Seed idempotency

`pnpm db:seed` run twice against `bmpl`; row counts **identical** on both runs
(second run correctly skipped demo-application creation):

```
roles=14  users=3  user_roles=6  admin_permission_grants=12
role_applications=1  role_application_reviews=1  wallet_accounts=7  (diff: none)
```

Demo password is now env-driven (`SEED_DEMO_PASSWORD`); demo data is skipped when
`NODE_ENV=production`; the dev super-admin password is clearly labeled unsafe.

## 5. Workflows executed (against real Postgres + MinIO)

Executed as the **36-test integration suite** plus live `curl` against the
running server.

- **Auth:** register → auto CUSTOMER role → **argon2id** hash in DB; duplicate
  email rejected; invalid data rejected; **mass-assignment** ignored (injected
  `status`/`roles` had no effect); email verification via dev inbox token;
  verification-token reuse rejected; login; **refresh rotation**; **refresh
  reuse rejected**; logout → **session revoked** (previously-valid access token
  now 401); password reset → old password fails, new works.
- **Role application + storage:** presign → **real upload to MinIO** → submit;
  DB stored **real** `contentType=application/pdf` + real byte size (not the old
  hardcoded `octet-stream`/`0`); VENDOR shows PENDING + not selectable; duplicate
  application rejected; **unsupported type** rejected; **oversized** rejected;
  **foreign-namespace key** rejected.
- **Admin:** signed document URL works and returns exact bytes; the same object
  **unsigned → 403** (private); a customer requesting the URL → 403; request more
  info → review record + customer notification; customer provides info; approve →
  `UserRole=APPROVED`; full approval history retained (`SUBMITTED →
  MORE_INFO_REQUESTED → INFO_PROVIDED → APPROVED`); **audit row written**; no API
  route to delete/modify audit (DELETE → 404).
- **Role switching:** CUSTOMER + VENDOR selectable; switch persists; **suspend →
  not selectable + active role falls back to CUSTOMER + direct API switch 403**;
  restore → selectable; revoke → 403; invalid enum → 400; not-held role → 404.
- **Account suspension:** suspend → **sessions revoked + login blocked**; restore
  → login works; both audited.

## 6. Security / abuse tests executed

All rejected as required: customer → admin endpoint (403); unauthenticated →
protected route (401); **admin approving own application (self-approval) → 403**;
admin **without** `role_applications.review` → 403; unapproved-role activation →
403; revoked/expired session token → 401; unsupported/oversized upload → 400;
foreign document namespace → 400; invalid enum → 400; **disallowed CORS origin →
no `Access-Control-Allow-Origin`** (allowed origin echoed).

## 7. Defects discovered & fixed (each with a regression test)

| # | Defect (root cause) | Fix | Regression coverage |
|---|---|---|---|
| 1 | **API crashed on boot** — `main.ts` installed the global class-validator `ValidationPipe`, but the project validates with Zod and `class-validator` isn't a dependency. | Removed the dead pipe (Zod `ZodValidationPipe` per route). | Live server boot + `mass-assignment` integration test. |
| 2 | Document metadata **hardcoded** (`octet-stream`/`0`), **no MIME allow-list**, **no ownership check** on client-supplied keys. | Presign allow-list + size; `HEAD` real metadata after upload; owner-namespaced key guard. | `role application + storage` tests (real upload, metadata assert, type/size/namespace rejection). |
| 3 | Avatar upload accepted any content type. | Image allow-list + namespace + `HEAD` validation on confirm. | Covered by shared validation + storage guards. |
| 4 | **No readiness probe** (only a static `{status:ok}`); couldn't tell if the API was really bound to infra. | `/api/health` (liveness) + `/api/health/ready` (DB + Redis + storage). | `health & readiness` test + live curl. |
| 5 | **Redis** referenced in docs/compose/env but **unused** in code. | Wired a `RedisService` into the readiness probe; documented as health-only for Phase 1. | readiness test asserts `redis:true`. |
| 6 | Bucket required **manual** console creation. | `StorageService.ensureBucket` auto-creates the private bucket on startup. | storage tests rely on it; live boot log shows creation. |
| 7 | Integration suite **silently skipped** without `TEST_DATABASE_URL`. | `globalSetup` + per-worker setup **throw** a clear error; dedicated `test:integration` script. | Verified: missing var → exit 1 with explicit message. |
| 8 | Prisma & API **did not load the root `.env`** (would fail outside a pre-exported shell). | `dotenv-cli` for db scripts; `dotenv` load in `main.ts`. | migrate/seed/live-server all run from `.env`. |
| 9 | Ledger FK `transaction → entries` was **CASCADE** (silent ledger-entry deletion risk). | Changed to **RESTRICT**. | migration SQL asserts `ON DELETE RESTRICT`. |
| 10 | **Test harness only:** Nest DI failed under vitest (esbuild drops decorator metadata; `reflect-metadata` not loaded). | `unplugin-swc` transform + `reflect-metadata` in setup. | Whole suite now runs (36 pass). |

## 8. Test totals (all executed)

| Suite | Command | Result |
|---|---|---|
| Unit — wallet ledger | `pnpm --filter @bmpl/wallet test` | ✅ 7 |
| Unit — authorization | `pnpm --filter @bmpl/authorization test` | ✅ 5 |
| Unit — API (Zod pipe) | `pnpm --filter @bmpl/api test` | ✅ 3 |
| **Integration** (real PG + MinIO + Redis) | `pnpm --filter @bmpl/api test:integration` | ✅ **36** (auth 9, workflows 26, seed 1) |
| **Total** | | **✅ 51 passing** |

## 9. Build / typecheck (all executed)

| Step | Result |
|---|---|
| `pnpm install` | ✅ (argon2 native build OK on Node 24) |
| Prisma generate | ✅ |
| Migration on clean DB (`migrate deploy`) | ✅ |
| Packages build (8) | ✅ |
| API build (`nest build` → `dist/main.js`) | ✅ |
| Web build (Next, 12 routes) | ✅ |
| Admin build (Next, 9 routes) | ✅ |
| Typecheck web / admin / mobile / api | ✅ exit 0 each |
| Live API server + health/readiness/login/authz | ✅ |

## 10. Exact reproduction commands

```bash
# 0. Node 24 LTS + pnpm 9
node -v            # v24.12.x
pnpm -v            # 9.15.x

# 1. Infrastructure (Docker path)
pnpm infra:up
#    …or without Docker:
pwsh scripts/dev-infra/start-infra.ps1

# 2. Env (already git-ignored; TEST_DATABASE_URL points at bmpl_test)
cp .env.example .env   # then set strong secrets

# 3. Build packages + client, migrate, seed
pnpm db:generate
pnpm -r --filter "./packages/*" build
pnpm db:migrate         # applies migrations/20260723233020_init
pnpm db:seed            # idempotent

# 4. Unit + integration tests
pnpm --filter @bmpl/wallet --filter @bmpl/authorization test
pnpm --filter @bmpl/api test
pnpm --filter @bmpl/api test:integration     # fails loudly w/o TEST_DATABASE_URL

# 5. Builds
pnpm --filter @bmpl/api build
pnpm --filter @bmpl/web exec next build
pnpm --filter @bmpl/admin exec next build

# 6. Run the API and probe it
pnpm --filter @bmpl/api start                # node dist/main.js
curl -s localhost:4000/api/health
curl -s localhost:4000/api/health/ready
```

## 11. Remaining Phase-1 risks (not blockers for deploy *preparation*)

- **No rate limiting / brute-force lockout** yet (Redis client is wired; add
  `@nestjs/throttler`).
- **Email is console/dev-outbox only** — a real provider (SES/Resend/SMTP) is
  required before external users.
- **CSRF** relies on `SameSite=Strict` + CORS allow-list; add a double-submit
  token for defense-in-depth.
- **Refresh reuse is rejected but not "family-revoked"** on detection.
- **Local infra is unmanaged portable binaries** (no Docker on this host); CI and
  deploy targets should use managed Postgres/Redis/object storage.
- **timestamptz** not used (UTC `timestamp(3)` is consistent but implicit).

## 12. Recommendation

**GO** to begin deployment preparation. The Phase 1 platform is verified working
end-to-end on real PostgreSQL, Redis, and MinIO: authentication, multi-role
approval, role switching, audit, notifications, private document storage, and the
admin workflow all pass, and the backend enforces authorization on every path.
Address the rate-limiting and real-email items early in the deployment phase.

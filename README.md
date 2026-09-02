# Belize Marketplace & Logistics (BMPL)

A modern, multi-role commerce & logistics platform for Belize — built from scratch.
**This repository shares no code, database, or architecture with the existing
bzemarketplace.com site;** that site was used only as visual reference for the
public landing page.

> **Status: Phase 1 — Foundation.** Authentication, multi-role accounts, role
> applications & admin approvals, audit logging, notifications foundation, the
> public landing page, a customer dashboard shell, an admin console, and the
> mobile app foundation. Domain features (marketplace, deliveries, rides, jobs,
> real estate, ads) and real-money wallet transactions are **intentionally not
> built yet** — see [`REMAINING_WORK.md`](./REMAINING_WORK.md).

---

## What's in the box

One account, many roles. A user is always a **Customer** and can additionally
apply to become a Vendor, Delivery Driver, Shipping Provider, Passenger Driver,
Passenger-Service Provider, Job Seeker, Employer, Real-Estate Agent, Property
Owner, or Marketing Client. **Each role has its own independent status**
(`PENDING · MORE_INFO_REQUIRED · APPROVED · REJECTED · SUSPENDED · REVOKED`) and
is approved by an administrator. Approved roles appear in a **role switcher** on
web and mobile.

## Monorepo layout

```
apps/
  web/     Next.js 14 — public landing page + customer dashboard
  admin/   Next.js 14 — separate, secured admin console
  mobile/  Expo (React Native) — foundation with secure-token auth
  api/     NestJS — the ONE backend; all authorization enforced here
packages/
  database/       Prisma schema, migrations, seed, client
  authentication/ argon2 hashing, token + JWT helpers
  authorization/  pure role/permission logic (used by API guards)
  shared/         enums, role catalog, districts, brand tokens
  validation/     Zod schemas + inferred types (used everywhere)
  notifications/  channel-agnostic dispatcher (email/push/in-app)
  wallet/         double-entry ledger primitives (architecture only)
  ui/             shared design tokens
```

## Tech stack

TypeScript · Next.js 14 (App Router) · NestJS 10 · Expo/React Native ·
PostgreSQL 16 · Prisma 5 · Redis 7 · S3-compatible storage (MinIO in dev;
Cloudflare R2 / Amazon S3 / Supabase in prod) · argon2id · JWT access +
rotating opaque refresh sessions · pnpm workspaces + Turborepo.

---

## Quick start

**Prerequisites:** Node ≥ 20 (22+ recommended), pnpm ≥ 9, Docker (for Postgres +
Redis + MinIO).

```bash
# 1. Install dependencies
pnpm install

# 2. Create your local env file (dev placeholders are provided)
cp .env.example .env
#    …then generate real auth secrets and paste them into .env:
node -e "console.log('JWT_ACCESS_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('COOKIE_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"

# 3. Start infrastructure (Postgres 5432, Redis 6379, MinIO 9000/9001)
pnpm infra:up

# 4. Build shared packages + generate the Prisma client
pnpm db:generate
pnpm -r --filter "./packages/*" build

# 5. Run the migration and seed development data
pnpm db:migrate      # creates the schema (name it e.g. "init")
pnpm db:seed         # roles, system wallet accounts, a super-admin, demo users

# 6. Run everything
pnpm dev
```

Or run the bundled convenience script (does steps 1, 4, 3, 5):

```bash
pnpm setup
```

### App URLs (dev)

| App    | URL                     | Notes                                   |
| ------ | ----------------------- | --------------------------------------- |
| Web    | http://localhost:3000   | Landing page + customer dashboard       |
| Admin  | http://localhost:3001   | Sign in with the seeded super-admin     |
| API    | http://localhost:4000   | Routes under `/api`; liveness `/api/health`, readiness `/api/health/ready` |
| Mobile | Expo dev server         | `pnpm --filter @bmpl/mobile dev`        |

The **readiness** probe (`/api/health/ready`) actually contacts PostgreSQL,
Redis, and object storage and returns `503` if any dependency is down — the API
never reports ready while silently degraded.

### Seeded accounts (dev only — change before any shared deploy)

| Role        | Email                          | Password            |
| ----------- | ------------------------------ | ------------------- |
| Super-admin | `admin@bzemarketplace.com`     | `ChangeMe!Admin123` |
| Customer    | `maya.customer@example.bz`     | `DemoPass123`       |
| Vendor (pending application) | `deshawn.vendor@example.bz` | `DemoPass123` |

The vendor account has a **pending VENDOR application** so the admin approval
queue has something to review immediately.

### Object storage bucket

The private `bmpl-documents` bucket is **created automatically** by the API on
startup (`StorageService.ensureBucket`) — no manual console step. Uploaded
documents are private and only ever served through short-lived signed URLs, and
their content type/size are validated server-side (allow-list) after upload.

### Running without Docker (portable binaries)

If Docker is unavailable, `scripts/dev-infra/` starts PostgreSQL, Redis, and
MinIO from portable binaries and creates the databases + bucket. See
`scripts/dev-infra/README.md`. `docker-compose.yml` remains the preferred path
where Docker is available.

---

## Useful scripts

| Command               | What it does                                    |
| --------------------- | ----------------------------------------------- |
| `pnpm dev`            | Run all apps in watch mode (Turborepo)          |
| `pnpm build`          | Build packages + apps in dependency order       |
| `pnpm test`           | Run unit tests across the workspace             |
| `pnpm typecheck`      | Type-check everything                           |
| `pnpm db:migrate`     | Create/apply a dev migration                    |
| `pnpm db:studio`      | Open Prisma Studio                              |
| `pnpm db:reset`       | Drop + recreate + re-seed the dev database      |
| `pnpm infra:up/down`  | Start/stop Postgres + Redis + MinIO             |

The **integration suite** (auth, role application + storage, admin approval,
role switching, account suspension, authorization/abuse — 36 tests) runs against
real PostgreSQL + MinIO. It **fails loudly** if `TEST_DATABASE_URL` is not set —
it is never silently skipped:

```bash
# TEST_DATABASE_URL is read from .env; ensure infra is up (pnpm infra:up), then:
pnpm --filter @bmpl/api test:integration
```

**Runtime:** Node 24 LTS (pinned in `.nvmrc` / `.node-version`; `engines` allows
Node 22 or 24 LTS), pnpm 9.

---

## Architecture notes

- **Sessions are server-side and revocable.** Access = short-lived JWT; refresh =
  opaque token whose hash is stored in a `Session` row and **rotated on every
  use**. Logout, password reset, and account suspension revoke sessions
  immediately.
- **Web vs mobile transport.** Web/admin receive HTTP-only, Secure,
  SameSite=Strict cookies; mobile receives tokens in the JSON body and stores
  them in `expo-secure-store`. Same identity, same rotation.
- **Two authorization axes.** Customer-facing **roles** (what a user can do) are
  separate from **admin permissions** (what staff can do). A customer role never
  grants an admin capability.
- **Everything privileged is audited.** Every approval, rejection, suspension,
  permission change, etc. writes an `AuditLog` row (actor, action, target,
  before/after, reason, IP/session) in the **same transaction** as the change.
- **Wallet is a double-entry ledger.** Balances are always derived from ledger
  entries; there is no editable balance field as the source of truth. Real-money
  movement is hard-disabled (`WALLET_MONEY_MOVEMENT_ENABLED = false`) until the
  payment/regulatory design lands.

- **Rate limiting.** Redis-backed distributed throttling (works across API
  instances); strict per-IP limits on auth, upload, and signed-URL routes.
- **CSRF.** Cookie (browser) mutations require an allowed `Origin` **and** a
  double-submit token; native mobile (Bearer) is exempt; non-browser callers rely
  on SameSite + auth.
- **Health/readiness.** `/api/health` (liveness) and `/api/health/ready` (probes
  Postgres, Redis, storage) — the API never reports ready while degraded.

See [`SECURITY.md`](./SECURITY.md) for how each stated security rule is enforced,
and [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the data model.

## Where the project stands

Start at [`docs/PROJECT_STATUS.md`](./docs/PROJECT_STATUS.md). It is the single
handoff document: what is built, the invariants that must not regress, which
feature flags are live, what is simulation data and what is real, and what is
deliberately out of scope. It is kept current as work lands, so a new session on
a new machine can read it plus the repository and know where things are.

## Cloud deployment (Phase 1.5B — preparation only, nothing deployed)

Target: GitHub Actions CI → **Vercel** (web + admin) · **Railway** (API + Postgres
+ Redis) · **Cloudflare R2** (storage) · **Expo EAS** (mobile) · Resend/Postmark
(email) · Sentry (errors). See:

- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — step-by-step runbook (GitHub,
  Railway, R2, Vercel, DNS, migrations, bootstrap, verify, rollback, teardown)
- [`docs/DEPLOYMENT-ARCHITECTURE.md`](./docs/DEPLOYMENT-ARCHITECTURE.md) — diagram + trust boundaries
- [`docs/ENVIRONMENT.md`](./docs/ENVIRONMENT.md) — full environment-variable matrix
- [`docs/MONITORING.md`](./docs/MONITORING.md) — logging + Sentry setup
- API container: [`apps/api/Dockerfile`](./apps/api/Dockerfile) · [`railway.json`](./railway.json)
- Cloud admin bootstrap (never the dev seed): `pnpm --filter @bmpl/database bootstrap`

## Landing page & brand

The landing page was rebuilt from scratch (no markup reused). It preserves the
brand name, the circular glowing logo treatment, the Belize palette, the
navy→blue hero gradient, the six service cards + Wallet, and the existing brand
voice — so it reads as a polished evolution. No fake statistics, testimonials, or
partner logos are used; unfilled items (app-store links, official logo image) are
clearly marked placeholders. Drop the real logo at `apps/web/public/logo.png`.

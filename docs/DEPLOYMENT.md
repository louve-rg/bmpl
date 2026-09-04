# Deployment Guide — Development Cloud (Phase 1.5C)

> **Phase 1.5B does not deploy anything.** This guide is the runbook for the next
> phase. Every step that needs provider credentials is flagged **[needs creds]**.
> Architecture + trust boundaries: [`DEPLOYMENT-ARCHITECTURE.md`](./DEPLOYMENT-ARCHITECTURE.md).
> Variables: [`ENVIRONMENT.md`](./ENVIRONMENT.md).

Runtime baseline: **Node 24 LTS**, **pnpm 9**, Prisma migrations via
`prisma migrate deploy` (never `db push`).

---

## 1. GitHub repository

1. Create a private repo (e.g. `bzemarketplace/bmpl`). **[needs creds]**
2. Push the existing local history:
   `git remote add origin <url> && git push -u origin main`.
3. Replace `@bmpl-owners` in `.github/CODEOWNERS` with real handles/teams.
4. **Branch protection on `main`** (recommended): require PRs, require the `CI`
   check (build-and-test + integration + secret-scan) to pass, require ≥1
   review, dismiss stale approvals, require branches up to date, disallow force
   pushes. CI is defined in `.github/workflows/ci.yml`.
5. Add repo secrets only if used by CI (none required for the current workflow;
   gitleaks uses the default `GITHUB_TOKEN`).

## 2. Railway — project + API service

1. Create a Railway project `bmpl-dev`. **[needs creds]**
2. Add a service from the repo. Build = **Dockerfile** (`apps/api/Dockerfile`,
   context = repo root). `railway.json` at the repo root already declares this
   plus the health-check path.
3. Service settings:
   - **Root directory:** repo root (the Dockerfile references the whole workspace).
   - **Build:** Dockerfile (multi-stage; installs, generates Prisma, builds).
   - **Start command:** `node apps/api/dist/main.js` (also the image CMD).
   - **Health check path:** `/api/health` · Readiness: `/api/health/ready`.
   - **Port:** Railway injects `PORT`; the app binds `0.0.0.0:$PORT`.
4. Set env vars (see ENVIRONMENT.md → API/Auth/Storage/Email/Monitoring). Generate
   strong secrets: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.

### 2a. Watch patterns — what triggers an API deployment

The API service only rebuilds when a pushed commit touches a **watch pattern**. The
list is kept in two places that must agree — `railway.json` (`build.watchPatterns`,
versioned and reviewable) and the service's **Settings → Build → Watch Paths** in the
Railway dashboard, which is the one that actually gates the trigger (see below):

| Pattern | Why the API build needs it |
| --- | --- |
| `apps/api/**` | the API source, plus `apps/api/Dockerfile` itself |
| `packages/shared/**` | `@bmpl/shared` — compiled into the API bundle |
| `packages/validation/**` | `@bmpl/validation` — every request schema |
| `packages/database/**` | `@bmpl/database` — Prisma client, schema **and migrations** (`prisma migrate deploy` runs pre-deploy) |
| `packages/authentication/**` | `@bmpl/authentication` — password/token handling |
| `packages/authorization/**` | `@bmpl/authorization` — permission checks |
| `packages/wallet/**` | `@bmpl/wallet` — ledger maths |
| `packages/notifications/**` | `@bmpl/notifications` — delivery channels |
| `pnpm-lock.yaml` | the exact dependency tree `pnpm install --frozen-lockfile` resolves |
| `pnpm-workspace.yaml` | which packages exist in the workspace |
| `package.json` | root scripts + pinned toolchain (`packageManager`, engines) |
| `turbo.json` | build-task graph used to build the packages |
| `tsconfig.base.json` | compiler options every package inherits |
| `tsconfig.lib.json` | compiler options the buildable packages inherit |
| `.npmrc` | pnpm resolution settings (hoisting, peer handling) |
| `railway.json` | the build/deploy config itself |

Those are exactly the seven `@bmpl/*` packages `apps/api/package.json` depends on
(their transitive closure adds nothing new), plus exactly the root files
`apps/api/Dockerfile` copies in its build stage:
`pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc turbo.json tsconfig.base.json tsconfig.lib.json`.

Deliberately **absent**: `apps/web/**`, `apps/admin/**`, `apps/mobile/**`,
`packages/ui/**`, `docs/**`, `scripts/**`. `@bmpl/ui` is web-only — the API does not
import it, so a UI change must not redeploy the API. (The Dockerfile does still build
it, so a UI change that breaks compilation surfaces on the next API deploy rather
than immediately.) A dependency change in any app still edits `pnpm-lock.yaml`, which
is watched on purpose: it changes the tree the API image installs.

> **The `packages/*` entries matter most.** The API compiles those packages into its
> bundle, so a change confined to `packages/` alters the deployed API even though
> nothing under `apps/api/` was touched. Without them the API silently keeps serving
> stale code and nothing anywhere reports an error.

**Dashboard vs. repository — the dashboard wins for the trigger.** Railway's
config-as-code reference says *"Configuration defined in code will always override
values from the dashboard"*, and that is true for a deployment that has **started**.
The decision of *whether to start one* is made by Railway's GitHub webhook **before
the repo is cloned**, so `railway.json` has not been read yet and cannot influence
it. Proof: skipped deployments record the dashboard's watch patterns and
`builder: RAILPACK`, while successful ones record `builder: DOCKERFILE` from
`railway.json`. Keep both in sync; if they ever disagree, the dashboard decides
whether a build happens.

Patterns are written **without a leading slash**, matching Railway's own documented
example (`"watchPatterns": ["src/**"]`). The previous value `/apps/api/**` matched
**nothing** — commit `4814015` changed five files under `apps/api/src/` and was still
`SKIPPED`, leaving the API frozen on `e2a46c1` while Vercel kept deploying.

To read or change the live value without the dashboard:

```bash
railway api 'query($s:String!,$e:String!){ serviceInstance(serviceId:$s, environmentId:$e){ watchPatterns } }' \
  --raw-var s=<serviceId> --raw-var e=<environmentId>
```

`serviceInstanceUpdate(serviceId, environmentId, input)` writes it; passing only
`watchPatterns` leaves the builder, start command, health check, pre-deploy hook and
variables untouched.

### 2b. Deployment sequencing — changes that span API and web

The API (Railway, Docker build) deploys in minutes; the web app (Vercel) deploys in
about a minute. A change that spans both therefore has a window in which the new web
build is live against the old API. If the web build calls an endpoint the API has not
shipped yet, users get `Cannot POST /api/...` — a hard 404, not a graceful failure.

Rules, in order:

1. **Deploy and verify the API first.** Confirm with
   `curl -sI https://www.bzemarketplace.com/api/health` → the `X-BMPL-Api-Commit`
   header must show the intended commit. `X-BMPL-Commit` is the web build's commit;
   the two are independent and routinely differ.
2. **Only then deploy the web app** that depends on the new endpoint.
3. **For breaking API changes, keep the old path working** for the length of the
   transition — add the new endpoint alongside the old one and remove the old one in a
   later release, or gate the new client path behind a feature flag. The faster Vercel
   deployment must never be able to call something that is not live yet.

## 3. Railway PostgreSQL

1. Add a **PostgreSQL** plugin/service to the project. **[needs creds]**
2. Copy its connection string into `DATABASE_URL` **and** `DIRECT_URL` on the API
   service (Railway PG is a single instance; use the same URL for both).
3. This is a **dev-only** database, isolated from any future production DB.

## 4. Railway Redis

1. Add a **Redis** service. **[needs creds]**
2. Set `REDIS_URL` on the API. Railway Redis uses `rediss://` (TLS) — ioredis
   detects that automatically. If a plain `redis://` URL is issued, also set
   `REDIS_TLS=true`.

## 5. Cloudflare R2 (object storage)  — R2 SETUP GUIDE

1. In Cloudflare, create an **R2** bucket set for dev: **[needs creds]**
   - `bmpl-dev-documents` — **PRIVATE** (verification documents, admin attachments).
   - `bmpl-dev-public` — public assets (future; no public objects in Phase 1).
2. Create an **R2 API token** (Account → R2 → Manage API Tokens) with
   Object Read & Write scoped to these buckets → get **Access Key ID** + **Secret**.
3. Find your **Account ID** (R2 overview). Endpoint format:
   `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
4. Set API env:
   ```
   STORAGE_PROVIDER=r2
   STORAGE_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   STORAGE_REGION=auto
   STORAGE_BUCKET=bmpl-dev-documents
   STORAGE_PUBLIC_BUCKET=bmpl-dev-public
   STORAGE_ACCESS_KEY_ID=<r2 key id>          # secret
   STORAGE_SECRET_ACCESS_KEY=<r2 secret>      # secret
   STORAGE_FORCE_PATH_STYLE=true
   STORAGE_SIGNED_URL_TTL=300
   ```
5. **CORS policy (R2 bucket):** only needed if the browser uploads directly to R2
   via presigned URLs. Allow the web/admin origins, methods `PUT,GET`, headers
   `content-type`, short max-age. Private documents are never listed publicly.
6. **Custom domain** (optional, public bucket only): map a domain (e.g.
   `cdn-dev.bzemarketplace.com`) to `bmpl-dev-public` and set
   `STORAGE_PUBLIC_BASE_URL`. The **private** bucket must NOT get a public domain.

**R2 handling requirements already enforced in code** (`apps/api/src/storage`):
private bucket, signed URLs generated only by the API, short expiry, ownership +
namespace checks before signing, MIME allow-list, size validation, randomized
keys, no user-controlled raw paths, real metadata verified via `HEAD`.
**Object deletion & retention** policies are documented as follow-ups in
[`SECURITY.md`](../SECURITY.md) under current known limitations (add lifecycle
rules + an authenticated delete path).

## 6–7. Vercel — web and admin (two separate projects)

For **each** app (`apps/web`, `apps/admin`): **[needs creds]**
1. Import the repo as a Vercel project; **Root Directory** = `apps/web` (and a
   second project with `apps/admin`).
2. Build settings come from each app's `vercel.json` (monorepo-aware:
   `pnpm turbo run build --filter=@bmpl/web|@bmpl/admin`, output `.next`).
3. Env vars:
   - web: `NEXT_PUBLIC_API_URL=https://api-dev.bzemarketplace.com`,
     `NEXT_PUBLIC_SITE_URL=https://dev.bzemarketplace.com` (+ optional Sentry/asset host).
   - admin: `ADMIN_PUBLIC_API_URL=https://api-dev.bzemarketplace.com`,
     `ADMIN_SITE_URL=https://admin-dev.bzemarketplace.com`.
4. Security headers ship from each app's `next.config.mjs`. A strict CSP is
   planned (see §16) and intentionally not yet enforced.
5. **Preview deployments** get per-deploy URLs. Because auth cookies are
   host-only/first-party via the proxy, preview URLs authenticate against
   whatever `*_API_URL` they point to — keep previews pointed at the dev API and
   add preview origins to the API `CORS_ORIGINS` if a preview must call the API
   cross-origin. Prefer the same-origin proxy to avoid preview cookie issues.

## 8–9. Development domains & DNS  **[needs creds]**

| Host | Points to | Record |
|---|---|---|
| `dev.bzemarketplace.com` | Vercel (web) | CNAME → Vercel |
| `admin-dev.bzemarketplace.com` | Vercel (admin) | CNAME → Vercel |
| `api-dev.bzemarketplace.com` | Railway (api) | CNAME → Railway domain |
| `cdn-dev.bzemarketplace.com` | R2 public bucket (optional) | CNAME → R2 |

After DNS resolves, set the API `CORS_ORIGINS` to the exact web + admin HTTPS origins.

## 10. Environment variables

Fill every ✅ value from [`ENVIRONMENT.md`](./ENVIRONMENT.md) in Railway (API) and
Vercel (web/admin). Never place secrets in `NEXT_PUBLIC_`/`EXPO_PUBLIC_` vars.

## 11. Database migration  — MIGRATION STRATEGY

> **REQUIRED PROCESS (all future DB migrations).** Every production schema change
> ships as a committed Prisma migration and is applied **only** by the Railway
> `deploy.preDeployCommand` hook below — never by a hand-run command against a
> production `DATABASE_URL`. Author the migration locally, commit it, and push;
> the hook applies it before the new code serves traffic. Do not add code that
> depends on a schema change without the migration in the same (or an earlier)
> deploy, and keep breaking changes expand→migrate→contract so the running code
> tolerates both shapes during rollout.

- **Command (always):** `prisma migrate deploy` (never `db push` in cloud).
- **Wired as a Railway pre-deploy hook (as of M9):** `railway.json` →
  `deploy.preDeployCommand` runs
  `sh -c 'DIRECT_URL=${DIRECT_URL:-$DATABASE_URL} pnpm --filter @bmpl/database exec prisma migrate deploy'`
  **inside the built image, before the new deployment serves traffic.** This
  guarantees schema changes land **before** the code that depends on them, on
  every deploy, with **no production credential leaving Railway** (the internal
  `DATABASE_URL` is injected into the hook). A failed migration **halts the
  deploy** — the previous version keeps serving.
- **Future migrations:** author locally with `pnpm db:migrate` (dev), commit the
  generated folder, push — the pre-deploy hook applies it automatically. No manual
  step and no direct DB URL needed. (Out-of-band fallback: `migrate deploy` against
  the Railway Postgres **public proxy URL**.)
- **Migration failure:** `migrate deploy` is transactional per migration and
  stops on error, leaving prior migrations applied. Fix forward with a new
  migration; investigate `_prisma_migrations`. Do not hand-edit applied migrations.
- **Rollback limitations:** Prisma has no auto down-migrations. Roll back by (a)
  restoring a DB backup, or (b) shipping a corrective forward migration. Plan
  expand→migrate→contract for breaking changes.
- **Backups:** enable Railway PostgreSQL backups; take a manual snapshot before
  each migration in cloud dev.
- **Zero-downtime:** use additive (expand) migrations first, deploy code that
  tolerates both shapes, then contract in a later migration.
- **Data migrations:** write as explicit, idempotent scripts (a follow-up `tsx`
  script), not inside schema migrations.
- **Seed restrictions:** the development `seed` is **never** run in cloud. Use the
  bootstrap below.

## 12. Initial administrator bootstrap (cloud-safe)

Instead of the dev seed, run the guarded bootstrap **once**:
```
BOOTSTRAP_ADMIN_EMAIL=ops@bzemarketplace.com \
BOOTSTRAP_ADMIN_PASSWORD='<strong temp, ≥12, symbol>' \
  pnpm --filter @bmpl/database bootstrap
# In production add: BOOTSTRAP_ALLOW_PRODUCTION=true
```
It seeds the role catalog + system wallet accounts, creates one SUPER_ADMIN,
rejects weak/known-dev passwords, is idempotent, and refuses to run in production
without explicit authorization. Rotate the temporary password after first login.

## 13. Cloud verification

- `GET https://api-dev.bzemarketplace.com/api/health` → `{"status":"ok"}`.
- `GET .../api/health/ready` → `{"status":"ready","checks":{"database":true,"redis":true,"storage":true}}`.
- Web loads at `dev.…`; register/login sets HttpOnly cookies; dashboard renders.
- Admin loads at `admin-dev.…`; sign in as the bootstrap admin; the applications
  queue is reachable; a document signed URL opens and the object is 403 when unsigned.
- Confirm rate limiting (repeated bad logins → 429) and CSRF (cross-origin
  mutation → 403) on the real domains.

## 14. Rollback

- **API (Railway):** redeploy the previous image/commit (Railway keeps prior
  deploys → "Rollback"). If a migration caused it, restore the DB snapshot taken
  in §11 or ship a corrective migration.
- **Web/Admin (Vercel):** "Promote" a previous production deployment (instant).
- **Storage:** objects are immutable keys; no rollback needed for R2.

## 15. Log access

- **API:** structured JSON logs (set `LOG_FORMAT=json`) in Railway's log viewer —
  each request logs id/method/route/status/duration/userId/role. Secrets, tokens,
  cookies, and signed URLs are **never** logged. Retention: use Railway's
  retention or forward to a log sink; see [`MONITORING.md`](./MONITORING.md).
- **Web/Admin:** Vercel function/build logs.

## 16. Error monitoring & CSP

- Sentry setup for API/web/admin/mobile: [`MONITORING.md`](./MONITORING.md).
  No DSNs are committed; the API is a no-op without `SENTRY_DSN`.
- **CSP plan:** enforce a nonce-based `Content-Security-Policy` once the exact
  script/style/inline surface is finalized (Next requires nonces for its runtime).
  Start in `Content-Security-Policy-Report-Only` with a report endpoint, then
  enforce. Baseline security headers already ship from `next.config.mjs`.

## 17. Stopping / removing the environment

- **Vercel:** delete the web + admin projects (or pause deployments).
- **Railway:** delete the API, PostgreSQL, and Redis services (this destroys the
  dev database — snapshot first if needed), then the project.
- **Cloudflare R2:** empty and delete the dev buckets and revoke the R2 API token.
- **Email/Sentry:** revoke the API key / disable the project.
- Rotate any secret that was ever set, even in dev.

# Marketplace — Deployment Guide

Production topology: **API** on Railway (Docker), **web** + **admin** on Vercel
(Next.js, Git-connected to `louve-rg/bmpl`), **Postgres** + **Redis** on Railway.
See also `docs/DEPLOYMENT.md` (Phase 1) and `ENVIRONMENT-REFERENCE.md`.

## Production URLs
- API: `https://bmplapi-production.up.railway.app`
- Web: `https://bmpl-web.vercel.app`
- Admin: `https://bmpl-admin.vercel.app`

## Deploy flow (per change)
1. `git push origin main` → **GitHub Actions CI** (build + integration + secret scan).
2. **Railway** builds `apps/api/Dockerfile` and deploys the API **after CI passes**
   (CI-gated); healthcheck `/api/health`.
3. **Vercel** builds `bmpl-web` and `bmpl-admin` from the push (root dirs `apps/web`,
   `apps/admin`; `apps/*/vercel.json` runs the monorepo turbo build).

## Database migrations
Migrations run **automatically on every Railway deploy**, via the
`deploy.preDeployCommand` in `railway.json`:
```jsonc
"preDeployCommand": "sh -c 'DIRECT_URL=${DIRECT_URL:-$DATABASE_URL} pnpm --filter @bmpl/database exec prisma migrate deploy'"
```
Railway runs this **inside the freshly built image, in the project's environment
(internal `DATABASE_URL` injected), after build and before the new deployment
receives traffic** — so schema changes are always applied **before** the code that
depends on them serves requests, and a failing migration **halts the deploy**
(the old version keeps serving). `prisma migrate deploy` is idempotent (applies
only pending migrations) and additive-only here. `DIRECT_URL` falls back to
`DATABASE_URL` because the runtime service sets only `DATABASE_URL` (a direct,
non-pooled Railway Postgres connection); the schema's `directUrl` needs a value at
migrate time. No production credential is ever exposed outside Railway.

**Manual fallback** (only if a migration must be applied out-of-band — e.g. a
hotfix without a redeploy): run against the Railway Postgres **public proxy URL**
```bash
DATABASE_URL="<railway public proxy url>" DIRECT_URL="<same>" \
  pnpm --filter @bmpl/database exec prisma migrate deploy
```
The `add_product_search` migration installs `pg_trgm` + the tsvector trigger + GIN
indexes. The Prisma client is generated at image build; migrations ship in the
image (dev deps + `packages/database/prisma/migrations` are retained on purpose).

## Vercel project config (already set)
Each project: framework **Next.js**, **Root Directory** = `apps/web` / `apps/admin`,
Git-connected to `louve-rg/bmpl` (branch `main`), env `NEXT_PUBLIC_API_URL` /
`ADMIN_PUBLIC_API_URL` = the Railway API. The Next `rewrites` proxy is hardened to
default to the prod API even if the env var is unset.

## Cloudflare R2 (image storage) — pending
Product/vendor image uploads return **503** until R2 is configured. To enable
(env-only, no code change):
1. Create R2 buckets **`bmpl-public`** and **`bmpl-private`**; create an R2 API
   token (Object Read & Write).
2. On the Railway `@bmpl/api` service set: `STORAGE_PROVIDER=r2`,
   `STORAGE_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`,
   `STORAGE_REGION=auto`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`,
   `STORAGE_PUBLIC_BUCKET=bmpl-public`, `STORAGE_BUCKET=bmpl-private`,
   `STORAGE_PUBLIC_BASE_URL=<r2.dev or custom domain>` (optional).
3. Redeploy the API, then verify a real upload round-trip + public accessibility.

## Verification checklist
- `GET /api/health` → 200; `GET /api/health/ready` → 200 (db/redis/storage).
- `GET /api/marketplace/products` / `…/vendors` / `…/categories` → 200.
- Web `/products`, `/vendors` → 200; admin `/dashboard/*` → 307 → login.
- Railway shows only `@bmpl/api`, `Postgres`, `Redis` (the Phase-1 leftover
  `@bmpl/web|admin|mobile` services were deleted).

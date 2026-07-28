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
Migrations are **not** auto-run by the API container. Apply them explicitly against
the Railway Postgres (public proxy URL) **before/with** the code that needs them:
```bash
DATABASE_URL="<railway public url>" DIRECT_URL="<same>" \
  pnpm --filter @bmpl/database exec prisma migrate deploy
```
Additive-only; safe to apply before the new code rolls. The `add_product_search`
migration installs `pg_trgm` + the tsvector trigger + GIN indexes.

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

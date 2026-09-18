# Phase 1.5C — Operator Deployment Checklist

This began as the runbook that took the Phase 1 platform to the cloud. **The
platform has been live in production since September 2026** (see "How a deploy
actually happens today", below — that section is what you need on a normal
day). The numbered bring-up steps are kept because they are the recipe for
standing up a fresh environment; steps marked **[YOU]** require an account,
credential, interactive login, or DNS change that the automation environment
does not have.

> Never commit real secrets. Generate them with `node scripts/gen-secrets.mjs`.
> Counts and facts in this document were re-verified against the repository at
> `5c9c253` on 2026-09-18; earlier revisions carried Phase 1 numbers.

## How a deploy actually happens today (production)

- **Merging to `main` is the deploy trigger.** There is no manual deploy step.
  API → Railway; web + admin → Vercel (two projects). Merging requires human
  approval (root `CLAUDE.md` §11).
- **Railway rebuilds the API only when the merge touches
  `railway.json` `build.watchPatterns`** (apps/api, the seven runtime
  packages, lockfile/workspace/tsconfig files). A web-only or docs-only merge
  deploys nothing to Railway — that is correct, not a stall.
- **Railway waits for the GitHub check suite before deploying. A red — or
  absent — check suite silently blocks the API deploy.** This is Railway
  dashboard behaviour, not visible in this repository; it was established
  live on 2026-09-18 (BMPL-131), when a GitHub Actions billing block meant no
  check suites were created and the API deploy froze for two days with no
  error anywhere. **Vercel does not wait** — web and admin kept deploying the
  whole time. If the API will not deploy, check Actions first.
- **Migrations apply during the deploy**, not by hand: `railway.json`
  `deploy.preDeployCommand` runs `prisma migrate deploy`, so a failed
  migration fails the deploy rather than half-applying (81 migrations as of
  2026-09-18). Health check: `/api/health` (reports the commit being served);
  readiness: `/api/health/ready`. `/api/health/live` does not exist.
- **`pnpm deploy:status` answers "is production current?"** by comparing the
  commit `/api/health` reports against `origin/main` read live:
  **CURRENT** (exit 0) · **NOTHING_TO_DELIVER** (0 — main moved, but only in
  paths Railway does not watch) · **BEHIND** (1) · **UNKNOWN** (2 —
  unreachable is not the same as behind) · **DIVERGED** (3). `--web` also
  measures the deployed web build (ancestry verdicts only — Vercel's rebuild
  rules are not in this repo, so NOTHING_TO_DELIVER is never claimed for
  web); `--web-route <path>` probes one route; `--assume-production <commit>`
  is a what-if lever that classifies a hypothetical production commit without
  asking production.
- **Live hosts:** `www.bzemarketplace.com` (web, and `/api/*` proxy to the
  API), `bmpl-admin.vercel.app` (admin), `bmplapi-production.up.railway.app`
  (API). The `*-dev` subdomains planned below were never created (step 13).

## 0. Accounts required (create/authorize once) — [YOU]
- GitHub org/repo (public since 2026-09-18 — see step 1) · Railway · Vercel · Cloudflare (R2) · Resend (or
  Postmark) · Sentry · Expo (EAS). Access to DNS for `bzemarketplace.com`
  (only the `*-dev` subdomains are touched).

## 1. GitHub — push the repo — [YOU]
*(Done: the remote is `louve-rg/bmpl`, made **public** on 2026-09-18 so
Actions runs on GitHub-hosted runners — private-repo minutes had run out,
which is what triggered the BMPL-131 deploy freeze.)* For a fresh remote:
```bash
git remote add origin git@github.com:<org>/bmpl.git
git push -u origin main            # do NOT force-push
git ls-remote origin -h refs/heads/main   # verify the commit landed
```
Then in GitHub: set branch protection on `main` (require the `CI` checks +
review); replace `@bmpl-owners` in `.github/CODEOWNERS`.

## 2. CI runs automatically on push
CI runs on pushes to `main` and on pull requests into `main` — pushing a
feature branch alone runs nothing. Watch **Actions → CI**. Expect 3 jobs
green: **Build, typecheck & unit tests**, **Integration tests (Postgres +
Redis + MinIO)**, **secret-scan**. Local equivalents as of 2026-09-18:
**563 unit tests** (all seven test-bearing packages) + **852 integration
tests across 66 spec files**, all builds. Remember: a missing check suite
does not just skip CI — it blocks the Railway deploy (see the deploy section
above).

## 3. Railway — project + Postgres + Redis + API — [YOU]
```bash
# after: railway login
railway init                       # project: bmpl-development
# Add plugins in the dashboard: PostgreSQL (bmpl-postgres-dev), Redis (bmpl-redis-dev)
```
API service: connect the GitHub repo, builder = **Dockerfile**
(`apps/api/Dockerfile`), root = repo root. `railway.json` already sets the
health path. Keep PG/Redis on the private network (not public).

## 4. Generate + set API env — [YOU]
```bash
node scripts/gen-secrets.mjs       # prints JWT/COOKIE secrets + a bootstrap password (NOT committed)
```
Set every ✅ variable from [`ENVIRONMENT.md`](./ENVIRONMENT.md) on the API
service. Minimum: `NODE_ENV=production`, `DATABASE_URL`+`DIRECT_URL` (Railway PG),
`REDIS_URL` (Railway Redis, `rediss://`), the 3 secrets, `COOKIE_DOMAIN=` (empty,
host-only) or `.bzemarketplace.com`, `CORS_ORIGINS` (the real Vercel URLs),
`STORAGE_*` (R2, step 6), `EMAIL_PROVIDER`, `LOG_FORMAT=json`, `APP_VERSION`.

## 5. Migrate the database (never `db push`) — [YOU]
On the live service this happens automatically on every deploy
(`railway.json` `preDeployCommand`). The manual form is for standing up a
fresh environment before its first deploy:
```bash
railway run pnpm --filter @bmpl/database migrate:deploy   # applies all pending (81 migrations as of 2026-09-18)
```
Verify `prisma migrate status` reports no pending migrations. (The original
Phase 1 counts — 16 tables, 14 enums — are history; the schema has grown far
past them. Audit FKs = SET NULL, ledger FKs = RESTRICT still hold.)

## 6. Cloudflare R2 — [YOU]
Create buckets `bmpl-dev-documents` (PRIVATE) + `bmpl-dev-public`; create a
scoped R2 API token. Set on the API: `STORAGE_PROVIDER=r2`,
`STORAGE_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`,
`STORAGE_REGION=auto`, buckets, `STORAGE_ACCESS_KEY_ID`/`SECRET`,
`STORAGE_FORCE_PATH_STYLE=true`. **Verify (Step 7 of the phase):**
```bash
# with the R2 env exported locally, run the same smoke that passed 9/9 on MinIO:
pnpm --filter @bmpl/api build
STORAGE_PROVIDER=r2 STORAGE_ENDPOINT=... STORAGE_BUCKET=bmpl-dev-documents \
STORAGE_ACCESS_KEY_ID=... STORAGE_SECRET_ACCESS_KEY=... STORAGE_REGION=auto \
STORAGE_FORCE_PATH_STYLE=true STORAGE_SIGNED_URL_TTL=5 \
  pnpm --filter @bmpl/api smoke:storage
# Expect: upload / HEAD / namespace-guard / signed-200 / unsigned-403 / expiry-403 / cleanup
```

## 7. Deploy + verify the API — [YOU trigger, then verify]
```bash
curl https://<railway-api-domain>/api/health           # {"status":"ok"}
curl https://<railway-api-domain>/api/health/ready      # database/redis/storage all true
curl https://<railway-api-domain>/api/dev/emails/latest # expect 404 (dev module excluded in prod)
```
Confirm JSON logs with request ids and no secrets (already verified in local
production-mode boot).

## 8. Bootstrap the cloud admin (NOT the dev seed) — [YOU]
```bash
railway run \
  -e BOOTSTRAP_ADMIN_EMAIL=ops@bzemarketplace.com \
  -e BOOTSTRAP_ADMIN_PASSWORD='<strong from gen-secrets>' \
  pnpm --filter @bmpl/database bootstrap
# idempotent · rejects weak/dev passwords · prod needs BOOTSTRAP_ALLOW_PRODUCTION=true
```
Remove `BOOTSTRAP_*` vars afterward; rotate the password after first login.

## 9. Email (Resend) — [YOU]
Set `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + `EMAIL_FROM` (verified sender) +
`NEXT_PUBLIC_SITE_URL`. Verify a real verification + reset email; confirm links
point to `dev.bzemarketplace.com` and no tokens appear in logs. If no key:
leave `EMAIL_PROVIDER=console` and report email as **unverified** (do not bypass).

## 10. Sentry — [YOU]
Set `SENTRY_DSN` (+ `SENTRY_ENVIRONMENT=cloud-dev`) on the API; add
`NEXT_PUBLIC_SENTRY_DSN` on Vercel and follow [`MONITORING.md`](./MONITORING.md)
to add `@sentry/nextjs`. Trigger one test error; confirm it lands scrubbed. If no
DSN: Sentry stays a no-op — report as **pending**.

## 11–12. Vercel — web + admin (two projects) — [YOU]
Import repo twice; root dirs `apps/web` and `apps/admin` (build settings come
from each `vercel.json`). Web env: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`.
Admin env: `ADMIN_PUBLIC_API_URL`, `ADMIN_SITE_URL`. No secrets in `NEXT_PUBLIC_`.

## 13. DNS — [YOU]
CNAME `dev`/`admin-dev` → Vercel, `api-dev` → Railway. Then update the API
`CORS_ORIGINS` to the exact HTTPS origins and redeploy.
*(Reality note, 2026-09-09: this step was never carried out. The live hosts are
`www.bzemarketplace.com` (web, and `/api/*` proxy to the API),
`bmpl-admin.vercel.app` (admin) and `bmplapi-production.up.railway.app` (API);
`api-dev.bzemarketplace.com` is dead — Vercel `DEPLOYMENT_NOT_FOUND`.)*

## 14. Browser deployment gate (Step 15/17–21 of the phase) — [YOU]
In a real browser against the deployed URLs, verify: login → refresh page →
token refresh (refresh cookie sent to `/api/auth` path) → logout revokes →
CSRF (valid token succeeds, altered/missing token 403, disallowed origin 403) →
mobile Bearer path unaffected → register/duplicate/verify/reset → role apply +
R2 upload → admin approve (signed doc opens, unsigned 403) → role switch/suspend/
revoke → account suspend/restore → 429 on excessive logins. These mirror the
auth/role integration specs (a slice of the 852-test suite), now over real
cookies/domains.

## 15. Expo EAS (dev build only) — [YOU]
```bash
eas login && eas init                # sets EAS_PROJECT_ID
eas build --profile development --platform android   # or ios
```
`eas.json` sets `EXPO_PUBLIC_API_URL` per profile. Do NOT submit to stores.

---
### Fast local re-verification (no cloud needed)
```bash
pnpm infra:up                          # docker compose: Postgres, Redis, MinIO
pnpm install --frozen-lockfile && pnpm -r --filter "./packages/*" build
pnpm --filter @bmpl/api build
pnpm test:unit                         # 563 as of 2026-09-18, all seven packages
pnpm --filter @bmpl/api test:integration   # 852 tests / 66 files, ~12 min (real PG+MinIO+Redis;
                                           # a local run auto-isolates to a per-worktree database)
pnpm --filter @bmpl/api smoke:storage      # 9/9 (S3 path)
```

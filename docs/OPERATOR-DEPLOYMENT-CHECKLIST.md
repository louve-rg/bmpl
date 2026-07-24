# Phase 1.5C — Operator Deployment Checklist

This is the exact, ordered runbook to take the **already-prepared and locally
verified** Phase 1 platform live in a development cloud. Steps marked **[YOU]**
require an account, credential, interactive login, or DNS change that the
automation environment does not have — do those, then the remaining automated
verification (smoke scripts + CI) can run.

> **Nothing here has been executed against a real cloud** — no credentials were
> available. Local artifact verification is complete (see the Phase 1.5C report).
> Never commit real secrets. Generate them with `node scripts/gen-secrets.mjs`.

## 0. Accounts required (create/authorize once) — [YOU]
- GitHub org/repo (private) · Railway · Vercel · Cloudflare (R2) · Resend (or
  Postmark) · Sentry · Expo (EAS). Access to DNS for `bzemarketplace.com`
  (only the `*-dev` subdomains are touched).

## 1. GitHub — push the repo — [YOU]
The repo is committed locally (`main` @ current commit; 3 phase commits; clean
tree; no secrets tracked). Create the remote and push:
```bash
git remote add origin git@github.com:<org>/bmpl.git
git push -u origin main            # do NOT force-push
git ls-remote origin -h refs/heads/main   # verify the commit landed
```
Then in GitHub: set branch protection on `main` (require the `CI` checks +
review); replace `@bmpl-owners` in `.github/CODEOWNERS`.

## 2. CI runs automatically on push
Watch **Actions → CI**. Expect 3 jobs green: `build-and-test`,
`integration` (Postgres+Redis services + MinIO container), `secret-scan`.
Locally these are already green: **15 unit + 42 integration** tests, all builds.

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
```bash
railway run pnpm --filter @bmpl/database migrate:deploy   # applies 20260723233020_init
```
Verify tables/enums/indexes/FKs exist (16 tables, 14 enums, 47 indexes, 18 FKs;
audit FKs = SET NULL, ledger FKs = RESTRICT).

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

## 14. Browser deployment gate (Step 15/17–21 of the phase) — [YOU]
In a real browser against the deployed URLs, verify: login → refresh page →
token refresh (refresh cookie sent to `/api/auth` path) → logout revokes →
CSRF (valid token succeeds, altered/missing token 403, disallowed origin 403) →
mobile Bearer path unaffected → register/duplicate/verify/reset → role apply +
R2 upload → admin approve (signed doc opens, unsigned 403) → role switch/suspend/
revoke → account suspend/restore → 429 on excessive logins. These mirror the 42
passing integration tests, now over real cookies/domains.

## 15. Expo EAS (dev build only) — [YOU]
```bash
eas login && eas init                # sets EAS_PROJECT_ID
eas build --profile development --platform android   # or ios
```
`eas.json` sets `EXPO_PUBLIC_API_URL` per profile. Do NOT submit to stores.

---
### Fast local re-verification (no cloud needed)
```bash
pwsh scripts/dev-infra/start-infra.ps1
pnpm install --frozen-lockfile && pnpm -r --filter "./packages/*" build
pnpm --filter @bmpl/api build
pnpm test:unit                         # 15
pnpm --filter @bmpl/api test:integration   # 42 (real PG+MinIO+Redis)
pnpm --filter @bmpl/api smoke:storage      # 9/9 (S3 path)
```

# Environment Variable Matrix

Legend — **App**: api / web / admin / mobile / ci / db(migrations & bootstrap).
**Secret?**: 🔒 secret (never `NEXT_PUBLIC_`/`EXPO_PUBLIC_`, never committed) · 🌐 public.
**Req?**: ✅ required · ⭕ optional (has a safe default).
Placeholders below are **examples only** — never commit real secrets.

> Source of truth for the API is `apps/api/src/config/env.ts` (Zod-validated; the
> API refuses to boot on invalid config and refuses dev placeholder secrets in
> production).

## API — core

| Name | App | Req? | Secret? | Purpose | Example |
|---|---|---|---|---|---|
| `NODE_ENV` | api,ci,db | ✅ | 🌐 | Runtime mode | `production` |
| `PORT` | api | ⭕ | 🌐 | PaaS-injected listen port (wins over API_PORT) | `4000` |
| `API_PORT` | api | ⭕ | 🌐 | Local listen port fallback | `4000` |
| `API_URL` | api | ⭕ | 🌐 | Canonical API URL (logs/links) | `https://bmplapi-production.up.railway.app` |
| `APP_VERSION` | api | ⭕ | 🌐 | Release id in logs/Sentry | `0.1.0` |
| `LOG_FORMAT` | api | ⭕ | 🌐 | `pretty` (dev) / `json` (cloud) | `json` |
| `CORS_ORIGINS` | api | ✅ | 🌐 | Comma-sep allow-list (CORS + CSRF origin) | `https://www.bzemarketplace.com,https://bmpl-admin.vercel.app` |

## Database (Railway PostgreSQL)

| Name | App | Req? | Secret? | Purpose | Example |
|---|---|---|---|---|---|
| `DATABASE_URL` | api,db | ✅ | 🔒 | Pooled connection string | `postgresql://user:pass@host:5432/bmpl?schema=public` |
| `DIRECT_URL` | db | ✅ | 🔒 | Direct (unpooled) URL for `migrate deploy` | `postgresql://user:pass@host:5432/bmpl?schema=public` |
| `TEST_DATABASE_URL` | ci | ✅(ci) | 🔒 | Disposable DB for the integration suite | `postgresql://bmpl:pass@localhost:5432/bmpl_test?schema=public` |

## Redis (Railway Redis)

| Name | App | Req? | Secret? | Purpose | Example |
|---|---|---|---|---|---|
| `REDIS_URL` | api | ✅ | 🔒 | Rate-limit store (readiness ping) | `rediss://default:pass@host:6379` |
| `REDIS_TLS` | api | ⭕ | 🌐 | Force TLS for a `redis://` URL | `true` |

## Authentication & cookies

| Name | App | Req? | Secret? | Purpose | Example |
|---|---|---|---|---|---|
| `JWT_ACCESS_SECRET` | api | ✅ | 🔒 | Signs 15-min access JWTs (≥16 chars) | `«48-byte base64url»` |
| `JWT_REFRESH_SECRET` | api | ✅ | 🔒 | Refresh signing/entropy (≥16 chars) | `«48-byte base64url»` |
| `JWT_ACCESS_TTL` | api | ⭕ | 🌐 | Access token lifetime (session survives reload; DB session still re-checked every request, so revocation stays immediate) | `2h` |
| `JWT_REFRESH_TTL` | api | ⭕ | 🌐 | Refresh token lifetime | `30d` |
| `COOKIE_SECRET` | api | ✅ | 🔒 | Cookie signing (≥16 chars) | `«48-byte base64url»` |
| `COOKIE_DOMAIN` | api | ⭕ | 🌐 | Empty = host-only (proxy); `.bzemarketplace.com` for cross-subdomain | `` (empty) |
| `COOKIE_SAMESITE` | api | ⭕ | 🌐 | `strict`/`lax`/`none` | `strict` |
| `COOKIE_SECURE` | api | ⭕ | 🌐 | Force Secure cookies behind TLS | `true` |

## CSRF & rate limiting

| Name | App | Req? | Secret? | Purpose | Example |
|---|---|---|---|---|---|
| `CSRF_ENABLED` | api | ⭕ | 🌐 | Toggle CSRF guard | `true` |
| `THROTTLE_TTL_SECONDS` | api | ⭕ | 🌐 | Rate-limit window | `60` |
| `THROTTLE_LIMIT` | api | ⭕ | 🌐 | General per-IP limit / window | `300` |
| `THROTTLE_AUTH_LIMIT` | api | ⭕ | 🌐 | Strict limit for auth/upload/sign routes | `10` |
| `THROTTLE_TEST_ENABLED` | ci | ⭕ | 🌐 | Enable throttling under test | `false` |

## Storage (MinIO local / Cloudflare R2 cloud)

| Name | App | Req? | Secret? | Purpose | Example |
|---|---|---|---|---|---|
| `STORAGE_PROVIDER` | api | ✅ | 🌐 | `minio` or `r2` | `r2` |
| `STORAGE_ENDPOINT` | api | ✅ | 🌐 | S3 endpoint | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `STORAGE_REGION` | api | ⭕ | 🌐 | `auto` for R2 | `auto` |
| `STORAGE_BUCKET` | api | ✅ | 🌐 | **Private** documents bucket | `bmpl-dev-documents` |
| `STORAGE_PUBLIC_BUCKET` | api | ⭕ | 🌐 | Public assets bucket (future) | `bmpl-dev-public` |
| `STORAGE_PUBLIC_BASE_URL` | api | ⭕ | 🌐 | CDN/custom domain for public objects | `https://cdn-dev.bzemarketplace.com` |
| `STORAGE_ACCESS_KEY_ID` | api | ✅ | 🔒 | R2 access key id | `«r2 key id»` |
| `STORAGE_SECRET_ACCESS_KEY` | api | ✅ | 🔒 | R2 secret access key | `«r2 secret»` |
| `STORAGE_FORCE_PATH_STYLE` | api | ⭕ | 🌐 | `true` for MinIO/R2 | `true` |
| `STORAGE_SIGNED_URL_TTL` | api | ⭕ | 🌐 | Signed-URL lifetime (seconds) | `300` |

## Profile-picture face check

Verifies that an uploaded profile picture is a photo of a person. **Optional** —
with no provider configured the feature still works end to end: every upload is
queued for an admin in **Admin → Profile Photos** instead of being auto-approved.
Setting a provider turns on automatic approval and rejection.

| Name | App | Req? | Secret? | Purpose | Example |
|---|---|---|---|---|---|
| `AVATAR_VISION_PROVIDER` | api | ⭕ | 🌐 | `none` (admin queue only) or `google` | `google` |
| `GOOGLE_VISION_API_KEY` | api | ⭕* | 🔒 | Required when provider=`google`. Cloud Vision API key with `FACE_DETECTION` + `SAFE_SEARCH_DETECTION` enabled | `AIza«key»` |
| `AVATAR_VISION_TIMEOUT_MS` | api | ⭕ | 🌐 | Give-up time for the check; on timeout the picture falls back to the admin queue | `8000` |

> **What this proves.** The check confirms the image *contains* one clear human
> face and safe content. It cannot confirm the face is the account holder's —
> anyone can upload a stranger's photo. Binding a face to an identity requires
> liveness capture matched against an ID document (KYC), which is separate work.

## Email

| Name | App | Req? | Secret? | Purpose | Example |
|---|---|---|---|---|---|
| `EMAIL_PROVIDER` | api | ⭕ | 🌐 | `console`/`resend`/`smtp` | `resend` |
| `EMAIL_FROM` | api | ⭕ | 🌐 | From header | `Belize Marketplace <no-reply@bzemarketplace.com>` |
| `RESEND_API_KEY` | api | ⭕* | 🔒 | Required when provider=resend | `re_«token»` |
| `SMTP_URL` | api | ⭕ | 🔒 | Reserved (SMTP transport) | `smtp://user:pass@host:587` |

## Web (Vercel — apps/web)

| Name | App | Req? | Secret? | Purpose | Example |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | web | ✅ | 🌐 | Proxy target for `/api/*` | `https://bmplapi-production.up.railway.app` |
| `NEXT_PUBLIC_SITE_URL` | web,api | ⭕ | 🌐 | Canonical site URL (email links) | `https://www.bzemarketplace.com` |
| `NEXT_PUBLIC_PUBLIC_ASSET_HOST` | web | ⭕ | 🌐 | Allowed image host | `cdn-dev.bzemarketplace.com` |
| `NEXT_PUBLIC_SENTRY_DSN` | web | ⭕ | 🌐 | Browser Sentry DSN (public by design) | `https://«key»@o0.ingest.sentry.io/0` |

## Admin (Vercel — apps/admin)

| Name | App | Req? | Secret? | Purpose | Example |
|---|---|---|---|---|---|
| `ADMIN_PUBLIC_API_URL` | admin | ✅ | 🌐 | Proxy target for `/api/*` | `https://bmplapi-production.up.railway.app` |
| `ADMIN_SITE_URL` | admin,api | ⭕ | 🌐 | Canonical admin URL | `https://bmpl-admin.vercel.app` |
| `NEXT_PUBLIC_SENTRY_DSN` | admin | ⭕ | 🌐 | Browser Sentry DSN | `https://«key»@o0.ingest.sentry.io/0` |

## Mobile (Expo EAS — apps/mobile)

| Name | App | Req? | Secret? | Purpose | Example |
|---|---|---|---|---|---|
| `EXPO_PUBLIC_API_URL` | mobile | ✅ | 🌐 | API base (set per EAS build profile) | `https://bmplapi-production.up.railway.app` |
| `EXPO_PUBLIC_SENTRY_DSN` | mobile | ⭕ | 🌐 | Mobile Sentry DSN | `https://«key»@o0.ingest.sentry.io/0` |
| `EAS_PROJECT_ID` | mobile | ⭕ | 🌐 | EAS project id | `«uuid»` |

## Monitoring (Sentry — API)

| Name | App | Req? | Secret? | Purpose | Example |
|---|---|---|---|---|---|
| `SENTRY_DSN` | api | ⭕ | 🔒 | API Sentry DSN (disabled if unset) | `https://«key»@o0.ingest.sentry.io/0` |
| `SENTRY_ENVIRONMENT` | api | ⭕ | 🌐 | Sentry env tag | `cloud-dev` |
| `SENTRY_TRACES_SAMPLE_RATE` | api | ⭕ | 🌐 | 0–1 tracing sample | `0.1` |

## Seed / bootstrap (db)

| Name | App | Req? | Secret? | Purpose | Example |
|---|---|---|---|---|---|
| `SEED_SUPER_ADMIN_EMAIL` | db | ⭕ | 🌐 | **Dev seed only** admin email | `admin@bzemarketplace.com` |
| `SEED_SUPER_ADMIN_PASSWORD` | db | ⭕ | 🔒 | **Dev seed only** (UNSAFE default) | `«dev only»` |
| `SEED_DEMO_PASSWORD` | db | ⭕ | 🔒 | **Dev seed only** demo users | `«dev only»` |
| `BOOTSTRAP_ADMIN_EMAIL` | db | ✅(cloud) | 🌐 | Cloud initial admin email | `ops@bzemarketplace.com` |
| `BOOTSTRAP_ADMIN_PASSWORD` | db | ✅(cloud) | 🔒 | Strong temp password (rotate after 1st login) | `«strong, ≥12, symbol»` |
| `BOOTSTRAP_ALLOW_PRODUCTION` | db | ⭕ | 🌐 | Required `true` to bootstrap when NODE_ENV=production | `true` |

## Per-environment requirements (summary)

- **Local**: `.env` at repo root (see `.env.example`) — MinIO/local PG/Redis defaults.
- **CI**: `TEST_DATABASE_URL`, `DATABASE_URL`, `REDIS_URL`, `STORAGE_*` (MinIO container), test JWT/cookie secrets — all set in `.github/workflows/ci.yml` (non-secret CI values).
- **Cloud dev / staging / production**: everything marked ✅ plus real secrets from Railway/Vercel/Cloudflare/Sentry provider dashboards. Production additionally rejects dev-placeholder secrets at boot.

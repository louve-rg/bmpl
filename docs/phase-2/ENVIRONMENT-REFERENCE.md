# Environment Variable Reference

Validated at API boot by `apps/api/src/config/env.ts` (Zod). The API refuses to
start on invalid/missing required config or dev-placeholder secrets in production.
See also the Phase 1 `docs/ENVIRONMENT.md`.

## Required (production)
| Var | Notes |
|---|---|
| `DATABASE_URL` / `DIRECT_URL` | PostgreSQL connection (pooled / direct for migrations) |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | ≥ 32 chars, unique, non-placeholder |
| `COOKIE_SECRET` | ≥ 32 chars |

## Core / networking
| Var | Default | Notes |
|---|---|---|
| `NODE_ENV` | development | |
| `PORT` / `API_PORT` | 8080 / 4000 | PaaS `PORT` wins |
| `CORS_ORIGINS` | localhost:3000,3001 | comma-separated browser origins (CORS + CSRF allow-list). Include the web + admin Vercel origins in prod |
| `COOKIE_DOMAIN` | "" | empty = host-only (correct behind the same-origin proxy) |
| `COOKIE_SAMESITE` / `COOKIE_SECURE` | strict / (prod=true) | |
| `CSRF_ENABLED` | true | |
| `THROTTLE_TTL_SECONDS` / `THROTTLE_LIMIT` / `THROTTLE_AUTH_LIMIT` | 60 / 300 / 10 | general + strict (auth/presign) limits |
| `REDIS_URL` / `REDIS_TLS` | localhost:6379 / false | rate-limit store (use `false` for Railway private `redis://`) |

## Object storage (marketplace images)
| Var | Local (MinIO) | Cloud (Cloudflare R2) |
|---|---|---|
| `STORAGE_PROVIDER` | `minio` | **`r2`** |
| `STORAGE_ENDPOINT` | `http://localhost:9000` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `STORAGE_REGION` | `us-east-1` | `auto` |
| `STORAGE_PUBLIC_BUCKET` | `bmpl-public` | `bmpl-public` |
| `STORAGE_BUCKET` (private) | `bmpl-documents` | `bmpl-private` |
| `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | dev creds | R2 API token keys |
| `STORAGE_PUBLIC_BASE_URL` | — | R2 public/custom domain (else signed URLs) |
| `STORAGE_FORCE_PATH_STYLE` / `STORAGE_SIGNED_URL_TTL` | true / 300 | true / 300 |

`storageEnabled()`: `none` → disabled; `minio` → enabled only outside production;
`r2` → enabled. When disabled, upload/presign endpoints return **503** (the app still
runs). **R2 is currently unconfigured in production → product/vendor image uploads
return 503 until the R2 vars above are set** (env-only; no code change).

## Frontend (Next.js) & mobile
| Var | Notes |
|---|---|
| `NEXT_PUBLIC_API_URL` (web) / `ADMIN_PUBLIC_API_URL` (admin) | API base for the `/api` proxy; both normalize to the prod API if unset |
| `NEXT_PUBLIC_SITE_URL` / `ADMIN_SITE_URL` | canonical site URLs |
| `EXPO_PUBLIC_API_URL` (mobile) | API base for the Expo app |

## Email / monitoring (optional)
`EMAIL_PROVIDER` (console/resend/smtp), `EMAIL_FROM`, `RESEND_API_KEY`, `SMTP_URL`,
`SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`.

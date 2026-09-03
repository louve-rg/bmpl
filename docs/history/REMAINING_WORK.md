# Remaining Work

Phase 1 is the foundation. This is what remains, grouped by priority.

## Done in Phase 1.5A (local integration verification)

- [x] **Migration generated + committed** — `packages/database/prisma/migrations/20260723233020_init/`,
      verified to apply to a completely clean database (`prisma migrate deploy`).
- [x] **Server-side upload validation** — MIME allow-list + size limit at presign,
      real content-type/size read via `HEAD` after upload, owner-namespaced keys.
- [x] **Object-storage bucket auto-bootstrap** on API startup.
- [x] **Health + readiness endpoints** (`/api/health`, `/api/health/ready`) that
      probe Postgres, Redis, and storage.
- [x] **Integration suite** (36 tests) against real Postgres + MinIO; fails loudly
      without `TEST_DATABASE_URL`.
- [x] **Node runtime standardized** on Node 24 LTS (`.nvmrc` / `.node-version`).

## Done in Phase 1.5B (cloud deployment preparation)

- [x] **Rate limiting** — Redis-backed distributed throttling (`@nestjs/throttler`
      + `@nest-lab/throttler-storage-redis`); strict per-IP limits on auth/upload/
      signed-URL routes; tested (429 after limit).
- [x] **CSRF** — Origin allow-list + double-submit token for browser cookie
      mutations; mobile Bearer exempt; tested.
- [x] **Email provider abstraction** — `EmailService` (console/dev + Resend);
      dev outbox stays dev-only; failures logged and not falsely reported.
- [x] **Structured JSON logging + request correlation IDs**, secret scrubbing.
- [x] **Sentry** (API wired, no-op without DSN, PII scrubbed) + frontend shims.
- [x] **Graceful shutdown**, PaaS `PORT` binding, health/readiness probes.
- [x] **Cloudflare R2** support (provider selection + public/private buckets).
- [x] **API Dockerfile**, Railway config, Vercel configs, Expo `eas.json`, CI.
- [x] **Cloud admin bootstrap** (env-driven, idempotent, prod-guarded).
- [x] **Refresh-cookie path bug** fixed (`/api/auth`, was `/auth`).

## Immediate follow-ups (need provider credentials — Phase 1.5C)

- [ ] Activate a real **email provider** (set `EMAIL_PROVIDER=resend` + `RESEND_API_KEY`).
- [ ] Activate **Sentry** (set DSNs) for API/web/admin/mobile; upload source maps.
- [ ] Enforce a **nonce-based CSP** on web/admin (currently baseline headers only).
- [ ] **Push notifications** via Expo push tokens (schema + dispatcher hook exist).
- [ ] **Antivirus / content scanning** + object **deletion/retention** lifecycle on R2.
- [ ] **Refresh-token reuse *detection*** (reuse is already *rejected*; add session-family revocation).
- [ ] **timestamptz** — timestamps are `timestamp(3)` (UTC, consistent); consider explicit tz.
- [ ] Slim the API image via `turbo prune` + prod-only runtime (documented in DEPLOYMENT.md).
- [ ] Configure **ESLint** so CI lint is enforcing (currently informational).
- [ ] **Structured global exception filter** mapping domain errors → HTTP codes
      consistently; request-id logging.
- [ ] **CI pipeline**: typecheck + lint + unit tests on every PR; e2e against an
      ephemeral Postgres service.
- [ ] Real **logo asset** at `apps/web/public/logo.png`; app-store links; favicon set.
- [ ] Accessibility audit pass (axe) and Lighthouse budget on the landing page.

## Phase 2+ (domain services — deliberately not started)

Each becomes its own module/package following the Phase 1 patterns (Prisma model
+ Zod schemas + Nest module with guards + audited actions + UI):

- [ ] **Marketplace** — products, storefronts, catalog, cart, orders.
- [ ] **Shipping & Delivery** — shipments, delivery jobs, tracking, driver assignment, maps.
- [ ] **Passenger Service** — ride requests, fare estimates, trip lifecycle, maps.
- [ ] **Belize Connect** — job posts, applications, employer/seeker profiles.
- [ ] **Real Estate** — property listings, map/search, agent tools.
- [ ] **Marketing & Advertising** — campaigns, banners, placements, billing.
- [ ] **Wallet real-money layer** — enable ledger postings, payment-provider
      integration, top-ups, payouts, escrow release, fees, withdrawals, KYC, and
      the regulatory/compliance controls. Only then flip
      `WALLET_MONEY_MOVEMENT_ENABLED`.

## Cross-cutting later work

- [ ] Admin: bulk actions, saved filters, CSV export, permission-management UI
      (backend endpoints already exist: `GET/POST /admin/…/permissions`).
- [ ] Notification centre UI (web/mobile) consuming `/notifications`.
- [ ] Internationalization (English/Spanish) and Belize-specific formatting.
- [ ] Observability: metrics, tracing, error reporting.
- [ ] Load/perf testing; DB indexing review as data grows.

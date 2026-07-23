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

## Immediate follow-ups to harden Phase 1

- [ ] **Rate limiting / brute-force protection** on auth routes
      (`@nestjs/throttler` backed by Redis — the Redis client is already wired).
- [ ] **Real email transport** (Resend/SES/SMTP) behind the existing
      `@bmpl/notifications` provider interface; currently a console logger + dev outbox.
- [ ] **Push notifications** via Expo push tokens (schema + dispatcher hook exist;
      wire the provider + token registration).
- [ ] **Antivirus / content scanning** of uploaded documents.
- [ ] **CSRF double-submit token** on cookie-based mutations (SameSite=Strict + CORS
      allow-list are in place; add the token for defense in depth).
- [ ] **Refresh-token reuse *detection*** (reuse is already *rejected*; additionally
      revoke the whole session family on a replayed rotated token).
- [ ] **timestamptz** — timestamps are `timestamp(3)` normalized to UTC by Prisma
      (consistent); consider `@db.Timestamptz` for explicit tz-awareness.
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

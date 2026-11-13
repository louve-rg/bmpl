# Developer Setup Guide

Onboarding a new developer to the BMPL marketplace. Windows/macOS/Linux.

> **Frontend styling:** use the BMPL design system — shared primitives in
> `apps/web/components/ui.tsx` / `apps/admin/components/ui.tsx` (`Card`,
> `PageHeader`, `Button`, `Badge`, `StatusBadge`, `Alert`, `EmptyState`,
> `Field`/`Input`/`Select`/`Textarea`, …), the `bmpl-*` utility classes, and the
> `rounded-bmpl-*` / `shadow-bmpl-*` / `belize-*` Tailwind tokens. Do not
> hardcode ad-hoc colors/shadows. Full reference:
> [docs/design/BMPL-DESIGN-SYSTEM.md](./../design/BMPL-DESIGN-SYSTEM.md).

## Prerequisites
- **Node 24** (`.nvmrc` / `.node-version` = 24.12.0) and **pnpm 9**
  (`corepack enable`).
- **PostgreSQL 16**, **Redis 7**, and an S3-compatible store (**MinIO**) — via
  Docker (`docker-compose.yml`) or native installs. Local defaults expect
  Postgres `:5432`, Redis `:6379`, MinIO `:9000`.

## First-time setup
```bash
pnpm install                      # install workspace deps
cp .env.example .env               # then fill secrets (see ENVIRONMENT-REFERENCE.md)
docker compose up -d               # postgres + redis + minio (or run natives)

# database: apply migrations + generate client + seed
pnpm --filter @bmpl/database exec prisma migrate deploy
pnpm --filter @bmpl/database exec prisma generate
pnpm --filter @bmpl/database run seed        # roles, demo users, categories (dev)

pnpm build                         # build all packages + apps
```

`.env` must define `TEST_DATABASE_URL` (a **disposable** database, e.g.
`bmpl_test`) for the integration suite — it is truncated between runs.

## Running
```bash
pnpm --filter @bmpl/api dev        # API on :4000
pnpm --filter @bmpl/web dev        # web on :3000
pnpm --filter @bmpl/admin dev      # admin on :3001
```

## Is the local API actually running? The log is not a reliable answer

Tonight's QA pass (Dwight, 2026-11-12) cost the floor three round trips
chasing this, so it's recorded here rather than relearned per shift. **Dev
and local stack only — none of this applies to a deployed environment.**

- **A quiet `dev-restored.log` does not mean the process died.** First-hand
  from Dwight: the log stopped recording anything after 5:12:55 PM PST while
  the *same* API process kept running and kept serving real requests — so a
  perfectly healthy process can show total log silence. His working guess is
  that the stdout redirection writing that log detached from the process at
  some point; **record that guess as unverified** — nobody has confirmed the
  mechanism, and the restart/detach cause itself is a separate, parked
  question this document does not attempt to answer.
- **The reliable check is which PID owns the port, and since when — not
  whether a log is still growing.** This is how Dwight proved the process
  was healthy despite the silent log: PID `29532` had held port 4000 stable
  since 5:09:14 PM PST, confirmed directly from the OS rather than inferred
  from any log. Two existing scripts do the "which PID, is it current" half
  of this already — use them instead of re-deriving the check by hand:
  - `node scripts/dev-server-check.mjs <port>` — finds the PID bound to a
    port and, for the API specifically, compares its live `/api/health`
    `commit` field against local `git rev-parse HEAD` (`MATCH` / `MISMATCH`
    / `UNKNOWN`); for `apps/web`/`apps/admin` it instead checks the page's
    own static chunk actually loads (`FRESH` / `STALE`). Neither verdict
    depends on any log file.
  - `node scripts/dispatch-floor-check.mjs` — the broader, whole-host
    version: joins every listening port to its owning process's full command
    line and separately flags a non-listening `nest --watch` supervisor that
    could still respawn a stale child later (root `CLAUDE.md` §10 has the
    full background on why the supervisor itself is the thing to check, not
    just the port).
  - Neither script currently prints the PID's own start time. To corroborate
    *how long* a given PID has held the port — the second half of what
    confirmed `29532` above — read it straight from the OS: on Windows,
    `Get-Process -Id <pid> | Select-Object StartTime`.
- **The dev mailbox silently empties on every API restart — confirmed in
  source, not just observed.** `GET /api/dev/emails/latest`
  (`apps/api/src/dev/dev.controller.ts`) reads `DevMailboxService`
  (`apps/api/src/notifications/dev-mailbox.service.ts:20`), which keeps
  captured emails in a plain in-process array (`private readonly buffer:
  CapturedEmail[] = []`) — there is no persistence behind it. A restart
  clears that array, even though the original `send()` call already
  returned `201` with `delivered: true` at the time it was sent; the send
  was real, only the dev-only capture of it is gone. **This is current
  behaviour being actively fixed, not a permanent limitation**: MDF-728
  (Pam) is open to make the mailbox survive a restart. Until it lands, read
  a captured verification/reset token from this endpoint promptly after the
  send, in the same process lifetime — don't assume it will still be there
  after any restart, deliberate or not.

## Testing
```bash
pnpm test                                   # all unit tests (turbo)
pnpm --filter @bmpl/api test:integration    # integration (real PG + MinIO + Redis)
```
Integration tests fail loudly without `TEST_DATABASE_URL` — never silently skipped.
The suite boots the real Nest app and exercises the full auth/ownership/moderation
matrix. Reset Redis between rapid reruns if the rate-limit spec flakes
(`redis-cli FLUSHALL`).

## Working with the schema
- Edit `packages/database/prisma/schema.prisma`, then
  `pnpm --filter @bmpl/database exec prisma migrate dev --name <change>`.
- **Windows tip:** stop any running API (`node dist/main.js`) before `prisma
  generate` — a running server holds the query-engine DLL and `generate` fails to
  replace it (`EPERM rename`).
- **Search indexes:** the `searchVector` tsvector, its GIN/trigram indexes, and the
  maintenance trigger are raw-SQL managed. Any `migrate dev` will try to `DROP` them
  — re-add `CREATE INDEX IF NOT EXISTS` (see `DATABASE-SCHEMA.md`).

## Conventions
- DTOs are **Zod** schemas in `@bmpl/validation`, applied via `@Body(ZodBody(schema))`.
- Vendor endpoints: `@Roles('VENDOR')` + `OwnershipService`. Admin: `@RequirePermission`.
  Public: `@Public()`.
- Money = integer minor units. New audit codes go in the emitting milestone (Prisma
  enum + `@bmpl/shared` `AUDIT_ACTIONS` mirror together).
- Uploads reuse `StorageService` (presign → PUT → `headObject` verify → persist key).
- **Money movement is gated in code, not by configuration.** (Correction: the
  "global `WALLET_MONEY_MOVEMENT_ENABLED`" this document once described was
  never built — no such variable exists in code.) The gate is the wallet
  package's `assertMoneyMovementEnabled(enabled)`, a per-call boolean passed
  `true` **only** by `WalletService.postTransaction`'s sanctioned internal
  **customer↔escrow** operations (M12). Every posted transaction MUST be balanced (`assertBalanced` — debits ==
  credits, net 0) and carry a **unique `reference`** (ledger-level idempotency).
  Balances are DERIVED from ledger entries; `cachedBalanceMinor` is a maintained
  cache. M11 holds/ledger-refs are metadata (no `WalletLedgerEntry`). Payment state
  changes go through `canTransitionPayment` (`@bmpl/shared`).
- **Idempotent initiation:** `POST /api/checkout` honors an `Idempotency-Key` header
  (unique `IdempotencyKey(userId, scope, key)`); a duplicate replays the original
  order/payment. Add new idempotent initiations under a distinct `scope`.

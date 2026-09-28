# CLAUDE.md — `packages/database`

Read the [root `CLAUDE.md`](../../CLAUDE.md) first.

Prisma 5.19 + PostgreSQL 16. The schema is **4,638 lines and ~140 models**;
there are ~70 applied migrations. This directory owns the shape of every piece
of data BML holds.

**Only `apps/api` consumes this package at runtime.** No frontend imports
`@prisma/client`.

---

## 1. Migrations are applied to production automatically

Railway runs `prisma migrate deploy` as its `preDeployCommand`. **The moment a
migration is merged to `main`, it runs against the production database.** The
container only takes traffic if the migration succeeded, so a bad migration
fails the deploy rather than half-applying — but a *destructive* migration will
apply successfully and destroy data.

Therefore:

- **Never write a migration that loses data** without explicit human approval
  for that specific migration. No `DROP TABLE`, no `DROP COLUMN`, no destructive
  `ALTER TYPE`, no `TRUNCATE`, no un-scoped `UPDATE` or `DELETE`.
- **Prefer loosening to tightening.** Adding a column, dropping a `NOT NULL`,
  adding a table, adding an enum value — these are safe. Adding a `NOT NULL`
  column to a populated table, or removing an enum value that rows may hold, is
  not.
- **A new table ships empty** unless seeding it is the explicit point of the
  change. `courier_lanes` shipped empty on purpose: with no rows the planner
  behaves exactly as before, and real rows are business configuration.
- **Never run any migration command against production yourself.** Deployment is
  the only path, and it needs human approval.

## 2. Writing a migration

```bash
pnpm db:migrate:create   # generate SQL without applying it — then edit it
pnpm db:migrate          # apply to your local dev database
pnpm db:generate         # regenerate the client (required before typecheck)
```

Naming is `YYYYMMDDHHMMSS_snake_case_description`. Keep it consistent with the
existing sequence.

### Explain *why*, in the SQL, in prose

This repository's migrations carry a comment block at the top explaining the
decision — what was wrong, why this is the fix, why the alternatives were
rejected, and what does **not** change. Read
`20261102090000_pin_only_delivery_address` and `20261102093000_courier_lanes`
before writing your first one; match that standard. A migration is the most
permanent thing you will write here and the hardest to reconstruct later.

### Enum values

Add them idempotently so a re-run is safe:

```sql
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COURIER_LANE_CREATED';
```

**Never remove or rename an enum value** that persisted rows may hold — that
renames data. This is why `BMPL_HUB` keeps its name even though the product is
branded BML.

### Where a rule belongs

Prefer enforcing a business rule in `packages/validation`, where it can explain
itself to a customer, over a database `CHECK` constraint, which can only say
"violates constraint". Use the database for **structural** integrity — nullability,
uniqueness, foreign keys, indexes.

The "written down OR pinned" address rule is deliberately *not* a `CHECK`
constraint for exactly this reason. `order_addresses.addressLine1` is nullable;
`city` is not.

## 3. Data conventions

- **Money is `BigInt` minor units (BZD cents).** Never `Float`, never `Decimal`,
  never a bare `Int` for a value that could grow.
- **`isTest` exists on users, vendors, drivers, orders, shipments, hubs, routes,
  courier lanes and wallet transactions.** If you add a model that participates
  in commerce, logistics or money, it almost certainly needs `isTest` too — and
  the two sides must never mix.
- Timestamps are `TIMESTAMP(3)` (UTC, consistent). Migrating to `timestamptz` is
  a known, tracked, repo-wide change — **do not do it piecemeal** in an unrelated
  migration.
- Index what you filter and sort on. Follow the existing composite-index style,
  e.g. `("isTest", "isActive")` where planning loads one side of the simulation
  boundary at a time.

## 4. Seeds

- `prisma/seed.ts` (`pnpm db:seed`) — development and test fixtures.
- `prisma/bootstrap.ts` — idempotent, env-driven, production-guarded admin
  bootstrap.

**Seed data is not production data.** Do not seed hubs, routes, courier lanes,
carriers, rates or drivers — those are business configuration entered through
the admin console (root `CLAUDE.md` §5). Baseline *taxonomy* is different and is
legitimate: job categories ship as an idempotent data migration
(`20260915120000_seed_job_categories`, `ON CONFLICT (slug) DO NOTHING`) and are
mirrored in `seed.ts`. Marketplace `Category` currently has **no** automated
seed — a fresh environment starts empty. That is a known gap, not a licence to
invent categories in an unrelated change.

## 5. Verification

`prisma validate` and `prisma generate` run in CI and resolve `env("DATABASE_URL")`
/ `env("DIRECT_URL")` from dummy URLs that are never connected to.

After any schema change:

```bash
pnpm db:generate
pnpm turbo run typecheck
pnpm --filter @bmpl/api test:integration   # applies your migration to a real database
```

The integration suite's `globalSetup` runs `prisma migrate deploy` against
`TEST_DATABASE_URL`, so **the integration job is where a migration is really
proven** before it reaches production. There is no substitute for running it.

## 6. `migrate diff` / `migrate dev` will propose dropping real indexes — expected, not drift

Migrations here are **hand-written** (§2). Prisma's auto-generated diff —
whether from `prisma migrate dev` while authoring a new migration, or from
`prisma migrate diff` run directly against a fully-migrated database — is a
**draft to read, never a statement to apply as-is.** Against a completely
correct, up-to-date database it will still propose `DROP INDEX`,
`ALTER COLUMN ... DROP DEFAULT` and `RENAME INDEX` statements that must never
be run. This has bitten the floor three times (July, a near-miss while
authoring `20261104170100_hub_operating_hours`/BMPL-262, and a from-scratch
`migrate diff` run for BMPL-264) — including a near-miss that would have
dropped five production indexes — because the reason was written down once,
inside a migration file, where nobody not already reading that file could find
it. It is written here now so the next person checks this section instead of
treating the output as a regression. `migrate diff` against this schema
reports **four** items today, not seven — mechanism (2) below closed in
BMPL-309.

Three separate mechanisms produce this; two remain live, one is closed and
kept here as the record of how:

1. **Objects Prisma's schema language cannot express at all.**
   `products_search_idx` and `products_title_trgm_idx` are hand-written GIN
   trigram indexes (`USING GIN (... gin_trgm_ops)`) on an `Unsupported`
   tsvector column. Prisma cannot see them, so it proposes dropping them on
   *every* diff, forever. This cannot be fixed by editing `schema.prisma` —
   there is no representation for it. Original record:
   `20260730120000_add_checkout_orders`'s own header comment, which named this
   exactly and said the DROPs "are intentionally OMITTED here."
2. **CLOSED (BMPL-309). Objects Prisma could express but nobody declared.**
   `logistics_hubs_isTest_isActive_idx`, `logistics_routes_isTest_isActive_idx`
   and `orders_isTest_idx` were plain btree indexes, created by raw SQL
   directly in a migration, never added to their models as `@@index` — so
   the schema under-declared what every real database, including production,
   already had. That is not cosmetic: the *next* unrelated schema change
   would have run its own `migrate dev` against a diff that also proposed
   dropping these three, and on this repo that migration auto-applies to
   production on merge (§1) — a loaded gun aimed at whoever touched the
   schema next, not a stale comment.
   **This section used to leave an open question here; it is answered now,
   and its own prediction was wrong.** It predicted the fix "almost certainly" needed hand-written
   `CREATE INDEX IF NOT EXISTS` under the exact pre-existing name via `map:`,
   to avoid either a duplicate index or a "relation already exists" error.
   That assumed the raw SQL had used some name Prisma's default naming
   wouldn't reproduce. It hadn't — all three raw `CREATE INDEX` statements
   already used exactly the name `@@index([...])` generates by default
   (`<table>_<col1>_<col2>_idx`), same column order, plain btree, no `WHERE`
   predicate. So the actual fix was three declarations and nothing else: no
   `map:`, no `IF NOT EXISTS`, no migration file at all.
   **How that was known before merging, not assumed** (BMPL-308/309) — this
   is the reusable part, worth more than the specific result, for whoever
   next takes on mechanism (3) below: run `prisma migrate diff` against a
   throwaway shadow database (created and dropped locally, never a shared
   database) twice. First a **control pass against the unmodified schema** —
   it must reproduce the known trap exactly, proving the tool actually
   detects the gap. Only then a **confirming pass** against the candidate
   change — a genuine no-op reports zero DDL for the fixed object(s), not
   merely "the command didn't error." Re-run the confirming pass against the
   real edited file before committing, not just a scratch rehearsal copy —
   they are different files even when the content should be identical.
   `--exit-code` turns both passes into a check a script (or a person) can
   gate on instead of eyeballing output.
3. **A Postgres identifier-length truncation, unrelated to the above.**
   `courier_lanes`'s unique constraint name as written in
   `20261102093000_courier_lanes` is 79 characters; Postgres's identifier
   limit is 63 bytes, so the name actually stored is silently truncated while
   Prisma still expects the name as literally written in the migration file.
   `migrate diff` proposes a `RENAME INDEX` to reconcile them. Same
   "expected, not drift" rule; a different, separate fix (shortening the
   name) than either of the above, not attempted.

## 7. This package declares a `test` script and has no tests

`pnpm turbo run test` therefore reports it as a failure, along with
`@bmpl/authentication` and `@bmpl/notifications`. Pre-existing and tracked; CI
runs `pnpm test:unit`, which excludes them. Do not "fix" it by deleting the
script as a side effect of unrelated work.

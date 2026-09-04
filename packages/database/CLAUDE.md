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

## 6. This package declares a `test` script and has no tests

`pnpm turbo run test` therefore reports it as a failure, along with
`@bmpl/authentication` and `@bmpl/notifications`. Pre-existing and tracked; CI
runs `pnpm test:unit`, which excludes them. Do not "fix" it by deleting the
script as a side effect of unrelated work.

# Developer Setup Guide

Onboarding a new developer to the BMPL marketplace. Windows/macOS/Linux.

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

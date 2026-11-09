# Reusable test accounts — by role and purpose

Every account below is a reproducible fixture: created by a committed seed
script, re-creatable from a fresh database, never a hand-approved account
that happens to exist on one machine. If a role code you need has no entry
here, there is no reproducible fixture for it yet — build the seed script
before writing a spec that assumes the account exists
(`apps/web/e2e/support/auth.ts:71-79`).

**No password value appears in this document, including the already-public
committed defaults in the scripts below.** Each entry names the environment
variable that supplies the password; set it in your own environment, never
read it off this page.

Two separate registries hold these accounts, because the two apps they log
into are separate products with separate login surfaces:

- `apps/web/e2e/support/auth.ts` — customer, vendor, driver and every other
  non-admin role.
- `apps/admin/e2e/support/auth.ts` — the admin console's own two roles
  (`apps/web/e2e/support/auth.ts:81-84` explains why ADMIN has no entry in
  the web registry).

---

## Web app fixtures (`apps/web/e2e/support/auth.ts`)

| Role code | Account | Purpose | Seeded by | Password env var |
| --- | --- | --- | --- | --- |
| CUSTOMER | `uat-customer@bzemarketplace.com` | UAT walkthrough sender: funded test wallet, booked shipments | `seed-uat-logistics.ts` (`USERS.customer`, line 237) | `UAT_SEED_PASSWORD` |
| VENDOR | `uat-vendor@bzemarketplace.com` | Approved VENDOR role fixture for role-coverage specs | `seed-uat-roles.ts` (`USERS.vendor`, line 167) | `UAT_SEED_PASSWORD` |
| DELIVERY_DRIVER | `uat-driver@bzemarketplace.com` | **The only fixture with an approved driver profile** (ONLINE, in-district, approved vehicle) — needed for any driver-only surface; SUPER_ADMIN holds no driver role | `seed-uat-logistics.ts` (`USERS.driver`, line 238) | `UAT_SEED_PASSWORD` |
| JOB_SEEKER | `uat-job-seeker@bzemarketplace.com` | Role-coverage fixture. **Different grant path from every other role on this page**: JOB_SEEKER self-grants on request with no admin approval step (`seed-uat-roles.ts:368`) | `seed-uat-roles.ts` (`USERS.jobSeeker`, line 168) | `UAT_SEED_PASSWORD` |
| PASSENGER_DRIVER | `uat-passenger-driver@bzemarketplace.com` | Role-coverage fixture, approved via the real application + review flow | `seed-uat-roles.ts` (`USERS.passengerDriver`, line 169) | `UAT_SEED_PASSWORD` |
| PASSENGER_PROVIDER | `uat-passenger-provider@bzemarketplace.com` | Role-coverage fixture, approved via the real application + review flow | `seed-uat-roles.ts` (`USERS.passengerProvider`, line 170) | `UAT_SEED_PASSWORD` |
| EMPLOYER | `e2e-fixture.employer-with-profile@example.bz` | Approved employer **with** a saved profile — safe to reuse for anything that needs one. No DELETE endpoint exists for an employer profile, so any profile a test creates against this account is permanent, bounded residue, not cleanup debt. | `seed.ts` → `seedEmployerE2eFixtures()` (`packages/database/prisma/seed.ts:234-253`) | `SEED_DEMO_PASSWORD` |
| SUPER_ADMIN | `admin@bzemarketplace.com` (or `SEED_SUPER_ADMIN_EMAIL`) | Platform administrator | `seed.ts` → `seedSuperAdmin()` (`seed.ts:96-123`) | `SEED_SUPER_ADMIN_PASSWORD` — **no hardcoded fallback** in `auth.ts` (`apps/web/e2e/support/auth.ts:12-22`); a spec must skip, not log in with a guessed value, when it's unset |

**A second EMPLOYER-role account exists outside the table above on purpose,
and it is a landmine by design:** `do-not-create-a-profile.e2e-fixture@example.bz`
(same script, `seed.ts:255-266`, exported as `EMPLOYER_NO_PROFILE_EMAIL` in
`auth.ts`). Its entire value to the empty-state regression test is that it
has **never** had a profile created. There is no endpoint to undo a profile
once one exists, so creating one here — for this test or any future,
unrelated one — permanently and silently breaks the empty-state test it
exists for. **Never call `PUT /employer/profile` for this account.**

**SUPER_ADMIN is not like the rest of this table.** `seed.ts`'s `main()`
(`seed.ts:441-456`) calls `seedSuperAdmin()` unconditionally, in every
environment including production, and only guards `seedDemoData()` — the
function that creates the EMPLOYER fixtures and the unrelated
`maya.customer@example.bz` / `deshawn.vendor@example.bz` demo accounts —
behind `NODE_ENV=production`. The platform administrator account exists in
production by design; the e2e/demo fixtures above it in this table do not.

---

## Admin console fixtures (`apps/admin/e2e/support/auth.ts`)

| Role code | Account | Purpose | Seeded by | Password env var |
| --- | --- | --- | --- | --- |
| ADMIN | `uat-ops-full@bzemarketplace.com` | Full `logistics.read`/`manage`/`operate`/`verify` — the default ADMIN fixture | `seed-uat-logistics.ts` (`USERS.opsFull`, line 235; permissions line 249) | See **finding 1** below |
| ADMIN | `uat-ops-limited@bzemarketplace.com` | `logistics.read`/`operate` only — deliberately missing `logistics.verify`, so the permission split (#12) can be demonstrated rather than asserted | `seed-uat-logistics.ts` (`USERS.opsLimited`, line 236; permissions line 250) | See **finding 1** below |
| SUPER_ADMIN | `admin@bzemarketplace.com` | Same account as the web table above — the admin console is one of the two places it logs into | `seed.ts` → `seedSuperAdmin()` | `SEED_SUPER_ADMIN_PASSWORD`, same no-fallback rule |

---

## Seeding scripts — what runs when

| Script | Run with | Production behavior |
| --- | --- | --- |
| `packages/database/prisma/seed.ts` | `pnpm db:seed` | Always run. `seedSuperAdmin()` runs unconditionally; `seedDemoData()` is skipped when `NODE_ENV=production` (`seed.ts:452-456`). |
| `packages/database/prisma/seed-uat-logistics.ts` | `pnpm --filter @bmpl/database seed:uat` | **Refuses to run at all** — `process.exit(1)` — unless `NODE_ENV!=production` and `DATABASE_URL` points at `localhost`/`127.0.0.1` on a database literally named `bmpl` (`assertDevelopmentEnvironment()`, lines 52-80). A stronger guarantee than `seed.ts`'s simple skip: this script cannot touch production regardless of what calls it. |
| `packages/database/prisma/seed-uat-roles.ts` | `pnpm --filter @bmpl/database seed:uat-roles` | Same refusal guard, same reasoning (lines 44-72). |

---

## Findings — code and documentation disagree

**1. `apps/admin/e2e/support/auth.ts` reads the wrong environment variable
for the OPS fixtures' password, and its own comment doesn't match its own
code.**

- The comment at `apps/admin/e2e/support/auth.ts:3-9` says both OPS accounts
  "share one password: the `UAT_SEED_PASSWORD` env var, or the script's own
  default if unset."
- The code two lines later reads `OPS_PASSWORD = process.env.UAT_OPS_PASSWORD`
  (`apps/admin/e2e/support/auth.ts:13`) — a **different** variable name, with
  **no fallback default**.
- The account itself genuinely is created with the password from
  `UAT_SEED_PASSWORD` (`seed-uat-logistics.ts:233`, used at the login calls on
  lines 334-337 and 377) — the comment is right about the account, wrong
  about which variable reads it in this file.
- Effect: unless an environment happens to also set `UAT_OPS_PASSWORD` (to
  the same value as `UAT_SEED_PASSWORD`), `OPS_PASSWORD` is `undefined`, and
  `loginAsRole('ADMIN')`'s own guard (`apps/admin/e2e/support/auth.ts`, the
  `if (!fixture.password) return false` line) silently reports "this
  environment can't run the spec" — even in an environment where the
  account exists, is seeded correctly, and the real password is known and
  set under the name the seed script actually uses.

This is a documentation-visible code bug, not something this document can
paper over in prose — reported to the owner-facing kanban separately; not
fixed here (no code changes are in scope for this card).

No other fixture in either registry disagreed with its seed script: every
other email, role grant, and password variable named above was verified
against the script that creates it, not assumed from a comment.

# Reusable test accounts — by role and purpose

Every account below is a reproducible fixture: created by a committed seed
script, re-creatable from a fresh database, never a hand-approved account
that happens to exist on one machine. If a role code you need has no entry
here, there is no reproducible fixture for it yet — build the seed script
before writing a spec that assumes the account exists
(`apps/web/e2e/support/auth.ts:85-92`, re-verified 2026-11-12 — line drifted
from `71-79` since this document was first written; the comment's content is
unchanged, only its position in the file moved).

**No password value appears in this document, including the already-public
committed defaults in the scripts below.** Each entry names the environment
variable that supplies the password; set it in your own environment, never
read it off this page.

Two separate registries hold these accounts, because the two apps they log
into are separate products with separate login surfaces:

- `apps/web/e2e/support/auth.ts` — customer, vendor, driver and every other
  non-admin role.
- `apps/admin/e2e/support/auth.ts` — the admin console's own two roles
  (`apps/web/e2e/support/auth.ts:94-97` explains why ADMIN has no entry in
  the web registry).

**A third kind of account exists on top of these: hand-created through a
real signup/invite flow for a specific one-off test, not from a seed
script.** Those are not reproducible fixtures in the sense above — nobody
should assume they still exist on a fresh database — but the owner has asked
for them recorded too, so the floor stops re-creating the same role by
accident. See **"Manually created accounts"** near the end of this document.

---

## Web app fixtures (`apps/web/e2e/support/auth.ts`)

| Role code | Account | Purpose | Seeded by | Password env var | `isTest` |
| --- | --- | --- | --- | --- | --- |
| CUSTOMER | `uat-customer@bzemarketplace.com` | UAT walkthrough sender: funded test wallet, booked shipments | `seed-uat-logistics.ts` (`USERS.customer`, line 262) | `UAT_SEED_PASSWORD` | `User.isTest` **true** |
| VENDOR | `uat-vendor@bzemarketplace.com` | Approved VENDOR role fixture for role-coverage specs | `seed-uat-roles.ts` (`USERS.vendor`, line 176) | `UAT_SEED_PASSWORD` | `VendorProfile.isTest` true; `User.isTest` **false — see Gaps, below** |
| DELIVERY_DRIVER | `uat-driver@bzemarketplace.com` | **The only fixture with an approved driver profile** (ONLINE, in-district, approved vehicle) — needed for any driver-only surface; SUPER_ADMIN holds no driver role | `seed-uat-logistics.ts` (`USERS.driver`, line 263) | `UAT_SEED_PASSWORD` | `DriverProfile.isTest` **and** `User.isTest` both true |
| JOB_SEEKER | `uat-job-seeker@bzemarketplace.com` | Role-coverage fixture. **Different grant path from every other role on this page**: JOB_SEEKER self-grants on request with no admin approval step (`seed-uat-roles.ts:388`) | `seed-uat-roles.ts` (`USERS.jobSeeker`, line 177) | `UAT_SEED_PASSWORD` | No `isTest` column exists anywhere Belize Connect owns (BMPL-148, open) |
| PASSENGER_DRIVER | `uat-passenger-driver@bzemarketplace.com` | Role-coverage fixture, approved via the real application + review flow | `seed-uat-roles.ts` (`USERS.passengerDriver`, line 178) | `UAT_SEED_PASSWORD` | `PassengerDriverProfile.isTest` true; `User.isTest` **false — see Gaps, below** |
| PASSENGER_PROVIDER | `uat-passenger-provider@bzemarketplace.com` | Role-coverage fixture, approved via the real application + review flow | `seed-uat-roles.ts` (`USERS.passengerProvider`, line 179) | `UAT_SEED_PASSWORD` | `PassengerProviderProfile.isTest` true; `User.isTest` **false — see Gaps, below** |
| **TERMINAL_COMPANY (MANAGER / OPERATOR)** | **none exists** | No committed seed script creates a `TerminalCompanyProfile`, a `TerminalCompanyMember`, or any login tied to one — checked directly: zero references to `TerminalCompany` anywhere in `seed.ts`, `seed-uat-logistics.ts` or `seed-uat-roles.ts`. There is no `TERMINAL_COMPANY` `RoleCode` either; a terminal company's staff are authorized through `TerminalCompanyMember` + `TerminalCompanyMemberLocation` rows, not a role grant (`terminal.controller.ts:144-150`'s own comment). **Before anyone builds one: this is a genuinely new fixture, not a duplicate** — create it via `POST /api/admin/terminal/companies` (`terminal.controller.ts:36-39`, requires the `terminals.manage` permission) with `isTest: true` in the body, then invite a member through the same controller's invite routes. This is exactly the gap MDF-708 is blocked on (no production MANAGER/OPERATOR account to test with, and only the owner holds `SUPER_ADMIN`). | n/a | `TerminalCompanyProfile.isTest` |
| EMPLOYER | `e2e-fixture.employer-with-profile@example.bz` | Approved employer **with** a saved profile — safe to reuse for anything that needs one. No DELETE endpoint exists for an employer profile, so any profile a test creates against this account is permanent, bounded residue, not cleanup debt. | `seed.ts` → `seedEmployerE2eFixtures()` (`packages/database/prisma/seed.ts:234-253`) | `SEED_DEMO_PASSWORD` | No `isTest` column on `EmployerProfile` (BMPL-148, open) |
| SUPER_ADMIN | `admin@bzemarketplace.com` (or `SEED_SUPER_ADMIN_EMAIL`) | Platform administrator | `seed.ts` → `seedSuperAdmin()` (`seed.ts:96-123`) | `SEED_SUPER_ADMIN_PASSWORD` — **no hardcoded fallback** in `auth.ts` (`apps/web/e2e/support/auth.ts:12-22`); a spec must skip, not log in with a guessed value, when it's unset | `User.isTest` **false — correct.** This is the real platform administrator, present in production by design; flagging it would be wrong, not missing. |

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

| Role code | Account | Purpose | Seeded by | Password env var | `isTest` |
| --- | --- | --- | --- | --- | --- |
| ADMIN | `uat-ops-full@bzemarketplace.com` | Full `logistics.read`/`manage`/`operate`/`verify` — the default ADMIN fixture | `seed-uat-logistics.ts` (`USERS.opsFull`, line 260; permissions line 274) | `UAT_SEED_PASSWORD` — see **Finding 1 (closed)**, below | `User.isTest` **false — see Gaps, below. Flagged nowhere.** |
| ADMIN | `uat-ops-limited@bzemarketplace.com` | `logistics.read`/`operate` only — deliberately missing `logistics.verify`, so the permission split (#12) can be demonstrated rather than asserted | `seed-uat-logistics.ts` (`USERS.opsLimited`, line 261; permissions line 275) | `UAT_SEED_PASSWORD` — see **Finding 1 (closed)**, below | `User.isTest` **false — see Gaps, below. Flagged nowhere.** |
| SUPER_ADMIN | `admin@bzemarketplace.com` | Same account as the web table above — the admin console is one of the two places it logs into | `seed.ts` → `seedSuperAdmin()` | `SEED_SUPER_ADMIN_PASSWORD`, same no-fallback rule | `User.isTest` **false — correct**, same reasoning as the web table |

---

## Seeding scripts — what runs when

| Script | Run with | Production behavior |
| --- | --- | --- |
| `packages/database/prisma/seed.ts` | `pnpm db:seed` | Always run. `seedSuperAdmin()` runs unconditionally; `seedDemoData()` is skipped when `NODE_ENV=production` (`seed.ts:452-456`). |
| `packages/database/prisma/seed-uat-logistics.ts` | `pnpm --filter @bmpl/database seed:uat` | **Refuses to run at all** — `process.exit(1)` — unless `NODE_ENV!=production`, `DATABASE_URL` points at `localhost`/`127.0.0.1` on a database literally named `bmpl`, AND `UAT_SEED_API_URL` is explicitly set to a local API (`assertDevelopmentEnvironment()`, lines 52-95; FLOOR-SEEDTARGET, 2026-11-10 — no `localhost:4000` default anymore, since every local stack's database is also named `bmpl`, so a missing API target used to fall through to whatever happened to be listening, not necessarily the caller's own API). A stronger guarantee than `seed.ts`'s simple skip: this script cannot touch production regardless of what calls it. |
| `packages/database/prisma/seed-uat-roles.ts` | `pnpm --filter @bmpl/database seed:uat-roles` | Same refusal guard, same reasoning (lines 44-91). |

---

## `isTest` is six different flags, not one

The "`isTest`" column above names which flag, because there is no single
`isTest` — each one gates something different, confirmed by reading the
code each gates, not assumed from the name:

| Flag | Where | Gates |
| --- | --- | --- |
| `User.isTest` | `schema.prisma:568` (comment 565-567) | **The only thing that gates self-service test wallet funding.** Read directly, and alone — no profile flag is consulted — at `apps/api/src/wallet/wallet.controller.ts:105-106` (gating comment at 67-73). |
| `VendorProfile.isTest` | `schema.prisma:1227` (comment at 1226) | Storefront reachability (an `isTest` store 404s on its own public slug), and whether an order placed against that vendor becomes an `isTest` order. Nothing to do with funding. |
| `DriverProfile.isTest` | `schema.prisma:2243` | Which deliveries a driver is offered — test deliveries go only to `isTest` drivers, and an `isTest` driver is offered only test deliveries. Nothing to do with funding. **Re-checked 2026-11-12: the API now returns it** (`apps/api/src/driver/admin-driver.service.ts:63,207` — PR #662, merged 2026-11-10T05:52:22Z), **but the admin frontend still renders nothing with it** — `apps/admin/app/dashboard/drivers/page.tsx` and `drivers/[id]/page.tsx` contain zero references to `isTest`. So this document's earlier claim that it is "now visible in the admin console" was wrong even as a prediction: the merged PR turned out to be API-only (its own diff touches exactly `admin-driver.service.ts` and its integration spec, no `.tsx` file). Telling a test driver from a real one in the admin UI still requires a direct database read today. |
| `PassengerDriverProfile.isTest` / `PassengerProviderProfile.isTest` | `schema.prisma:6000`, `schema.prisma:6049` | Same symmetric isolation as `DriverProfile.isTest`, for passenger trips instead of deliveries. Nothing to do with funding. |
| `TerminalCompanyProfile.isTest` | `schema.prisma:5864` | **New, not in this document's first version.** Simulation boundary for a terminal company, enforced at write time, not just stored: `terminal.service.ts:155` refuses to place a company at a hub whose `isTest` doesn't match the company's own, and `terminal.service.ts:315` refuses to let an existing user *accept* an invite (inside `acceptInvite`, not at invite-sending time — corrected 2026-11-12, god's own dispatch had said "invite time" and I'd reasonably carried it) whose `User.isTest` doesn't match the company's. Nothing to do with funding — a terminal company has no wallet. **No visibility anywhere yet**: `terminal.service.ts:537-556` (`myWorkspace`, backing `GET /terminal/me`) selects `terminalCompany.isTest` (line 541) but the object it actually returns (lines 546-555) drops it before the response leaves the method, and the frontend's `Workspace` type (`apps/web/app/dashboard/terminal/page.tsx:44-49`) has no field to hold it even if it arrived. Separately, `GET /terminal/queue` (`apps/api/src/shipping/shipment.service.ts:5111-5214`, `terminalQueue`, corrected from `5111-5192` which cut the function mid-return) never selects `shipment.isTest` in any of its five queries, so no queue row can be labelled without a backend change first either. See `docs/TERMINAL-DEMO-DATA-LABELLING.md` for the requirement this gap is tracked against (MDF-707). |

**A fixture can hold one of these without the other, and three of the
fixtures above do:**

- **VENDOR, PASSENGER_DRIVER and PASSENGER_PROVIDER are flagged on their
  profile but not on the owning `User` row.** `seed-uat-roles.ts` calls each
  role's own test-mode endpoint (`/admin/vendors/:id/test-mode`,
  `/admin/passengers/drivers/:id/test-mode`,
  `/admin/passengers/providers/:id/test-mode`) but never calls
  `POST /admin/users/test-flag` for the `User` row underneath — unlike
  `seed-uat-logistics.ts`, which flags both for `uat-driver@`. Practical
  effect: **none of these three fixtures can fund their own test wallet**,
  because that path reads `User.isTest` alone. Tracked as **MDF-681** — a
  seed-script omission, not a two-sources-of-truth defect (a different
  model, `ShippingProviderProfile`, does enforce `User.isTest` / profile-flag
  symmetry at `shipping-provider.service.ts:350-353`; BML has chosen not to
  require the same symmetry for these three). The fix waits on nothing now
  that FLOOR-SEEDTARGET is merged, but building it is not this document's
  job — recorded here as the gap it is.
- **`uat-ops-full@` and `uat-ops-limited@` are flagged nowhere at all** —
  not on `User`, and there is no profile-level flag for an ADMIN role to
  hold. These are the same two accounts the FLOOR-SEEDTARGET incident wrote
  simulation-network permissions for by accident. Likely low-risk today,
  since the only confirmed effect of `User.isTest` is gating wallet funding
  and an ADMIN account has no customer-style wallet to fund — but that is
  this document's own read of the current code, not a guarantee against
  every future feature that might filter on `User.isTest` (analytics,
  reporting, an audit query) and would silently treat these two as real
  staff.

## Findings — code and documentation disagree

**1. CLOSED 2026-11-12. `apps/admin/e2e/support/auth.ts` used to read the
wrong environment variable for the OPS fixtures' password; it no longer
does.**

This document's first version (2026-11-09) reported that the comment at
`apps/admin/e2e/support/auth.ts:3-9` promised both OPS accounts shared
`UAT_SEED_PASSWORD`, while the code actually read a different, unset
variable (`UAT_OPS_PASSWORD`) — silently reporting "this environment can't
run the spec" even when the account, the seed, and the real password were
all fine. Re-checked 2026-11-12: `apps/admin/e2e/support/auth.ts:13` now
reads `export const OPS_PASSWORD = process.env.UAT_SEED_PASSWORD;` — the
same variable the comment always described and the seed script
(`seed-uat-logistics.ts:258`, which reads `UAT_SEED_PASSWORD` with its own
hardcoded fallback if unset — value not repeated here, same rule as the
rest of this document) actually sets it from. Fixed by **PR #642**,
merged **2026-11-10T00:53:34Z** — a few hours *before* this document's own
first version merged (PR #665, 2026-11-10T05:51), so the finding was already
stale the moment it shipped. Recorded here as closed rather than deleted
outright, so a future reader who remembers the old finding can see it was
real, and is now fixed, rather than wondering which is true.

No other fixture in either registry disagreed with its seed script this
pass: every email, role grant, and password variable named above was
re-verified against the script that creates it on 2026-11-12, not assumed
from the previous pass or from a comment.

---

## Manually created accounts — real flows, not seed fixtures (local stack only)

**These are not reproducible.** Each one was created by hand, tonight, by a
specific agent for a specific reason, through the real signup/invite page
rather than a seed script — the opposite of the reproducible-fixture rule
at the top of this document. Recorded here because the owner's standing
instruction is to reuse an existing test account wherever practical, and
that is impossible if the only record of one is a single agent's own
memory file. **No password, token or invitation token appears below, for
any entry — not even a redacted placeholder that hints at a format.**
Sourced from `hive/agents/stanley-mwe4jkri/memory.md` and `tasks.json`
only; the two `*.local` credential files on this host were not opened for
this document and are not the source of anything here.

| Account | Role | Purpose | Stack | Created by / when | Safe to reuse for |
| --- | --- | --- | --- | --- | --- |
| `stanley-manager-1794527832794@example.bz` | Terminal **MANAGER** | Terminal Workspace MANAGER-vs-OPERATOR permission checks (MDF-698) | **Local stack only** — terminal company "Stanley QA Terminal Co 1794527832794" (`isTest`, hub codes `UATBC`/`UATBP`) | Stanley (`stanley-mwe4jkri`), via the real invite-and-accept flow, 2026-11-12 | Any Terminal Workspace check that needs an active MANAGER on an `isTest` terminal company. Do not assume it exists on a fresh database. |
| `stanley-operator-1794527832794@example.bz` | Terminal **OPERATOR** | Same purpose, OPERATOR side of the same role comparison | Same terminal company, local stack only | Stanley, same flow and date | Any check that needs an active OPERATOR on the same `isTest` company, paired with the MANAGER above for a same-company role comparison. |
| `stanley-sender-1794527832794@example.bz` | **CUSTOMER** | Sender account to book parcels against for Terminal Workspace testing | Local stack only | Stanley, registered through the real signup page, 2026-11-13 | Booking a parcel as a sender. Funded with **BZ$50.00** by a single admin-console test-credit grant (`WalletOperations` → `/api/admin/wallet/test-credit`, permission `wallet.credit_test`) — performed by Dwight (`bmpl-qa-mtmcz0m1`), **acting as the seeded SUPER_ADMIN**, because no scoped QA-admin account exists yet (open question on MDF-696/MDF-708). Any finding about what this role *should* be able to do, versus what was actually observed under the SUPER_ADMIN account, should say which of the two it is — the effective permissions of a future dedicated QA-admin role are not yet established. |

**Explicitly out of scope — never use for QA, under any circumstance:**
`edwardbroaster@bzemarketplace.com` (Edward Broaster) is a **real client**,
not a test account. The owner has been emphatic that Edward is the client,
not a tester for this floor to exercise. No future shift should create test
data on his account, book a test parcel to it, or otherwise treat it as
reusable fixture.

**Starting points already established elsewhere, not re-derived here:** the
seeded `SUPER_ADMIN` default is `admin@bzemarketplace.com`
(`packages/database/prisma/seed.ts:97`, same default read again at
`seed-uat-logistics.ts:369` and `seed-uat-roles.ts:252` — both current line
numbers, re-checked rather than copied from the dispatch that named earlier
ones) — see the seed-script table above for the full account. That one *is*
a reproducible fixture; it belongs in the main tables above, not this
section, and is listed here only to avoid a reader assuming it was missed.

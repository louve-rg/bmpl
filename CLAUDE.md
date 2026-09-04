# CLAUDE.md — BML engineering rules

**BML** (Belize Marketplace & Logistics; repo/package name `bmpl`) is a **live,
revenue-path production system** serving real users in Belize. It is not a
prototype and not a greenfield project. Everything below exists because
something in this repository already went wrong once, or because getting it
wrong would harm real people's money, deliveries or data.

Read this file before your first edit. Then read
[`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) for where the project
actually stands today.

---

## 0. Source of truth

**The code is the source of truth.** When documentation and implementation
disagree, the code wins — and then the documentation is wrong and must be fixed
in the same change that discovered it.

Document hierarchy, most authoritative first:

1. **The code and its tests.**
2. `docs/PROJECT_STATUS.md` — current state, live configuration, known gaps.
3. This file and scoped `CLAUDE.md` files (`apps/api`, `packages/database`).
4. `docs/` — architecture, deployment, per-milestone design notes.
5. `docs/history/` — **archived. Historical only. Never cite as current.**

---

## 1. Prime directives

These are absolute. If a task appears to require breaking one, **stop and ask a
human**. Do not find a way around it.

1. **Never move real money, and never enable real-money movement.** BML has no
   payment provider, no card rail, no bank rail, no payout and no withdrawal.
   Building or enabling one requires explicit human product approval. See §4.
2. **Never write a wallet balance directly.** Balances are *derived* from the
   ledger. Every movement is a balanced double-entry transaction through the
   wallet service. See §4.
3. **Never let test money touch real money.** `isTest` is derived from the
   account or the escrow — never taken from a request. See §4.
4. **Never fabricate business or geographic data.** No invented carriers, hubs,
   routes, courier lanes, schedules, rates, distances, towns, or "reasonable
   default" prices. See §5.
5. **Only `apps/api` talks to the database.** See §2.
6. **Never perform destructive production operations.** No deleting wallet
   history, resetting accounts, removing audit records, rewriting settled
   payments, mass-modifying drivers, or dropping/truncating anything.
7. **Never modify production data** — including creating production hubs,
   routes, rates or users — without explicit human authorization for that
   specific change.
8. **Never expose, print, log, commit or transmit secrets.** See §9.
9. **Never run `pnpm format:write`.** See §10.
10. **Never work directly on `main`.** See §11.

---

## 2. Architecture and ownership boundaries

pnpm 9 + Turborepo monorepo. Node 22–24 (`.nvmrc`). ~96k LOC TypeScript.

| Path | What it is | Owns |
| --- | --- | --- |
| `apps/api` | NestJS 10. **The only thing that talks to the database.** | All persistence, all authorization, all money |
| `apps/web` | Next.js 14 App Router. Customer, vendor, driver, employer, property-owner, agent | Public + role dashboards |
| `apps/admin` | Next.js 14. Admin console | Moderation, ops, logistics config |
| `apps/mobile` | Expo 51. **Skeleton only** (~400 LOC) | Not a current milestone |
| `packages/database` | Prisma schema, migrations, seed | The schema |
| `packages/shared` | Framework-free domain logic. **The route planner lives here** | Rules both sides must agree on |
| `packages/validation` | Zod schemas imported by API *and* browser | Input rules |
| `packages/authentication` | argon2, JWT, tokens | Credentials |
| `packages/authorization` | Role/permission evaluation | Access decisions |
| `packages/wallet` | Double-entry ledger primitives | Ledger integrity |
| `packages/notifications`, `packages/ui` | Supporting | — |

### The database boundary

`apps/web`, `apps/admin` and `apps/mobile` **must never** import
`@prisma/client`, open a database connection, or read `DATABASE_URL`. They call
the API. The API is the single point where authorization is enforced; a
frontend that reaches the database bypasses every guard in §3.

### Where a rule belongs

Anything the browser and the server must **both** agree about goes in
`packages/validation` or `packages/shared`, and is imported by both.

> A rule stated twice is a rule that will eventually disagree with itself.

Several real defects in this repository were exactly that — a form that accepted
input the API then rejected. Do not re-create one. If you are about to write a
validation rule in `apps/web`, check whether it belongs in
`packages/validation` instead.

---

## 3. Authorization

The API runs a **global guard chain**, in this order
(`apps/api/src/app.module.ts`):

```
Throttle (Redis) -> CSRF -> JWT authenticate (unless @Public) -> Roles -> Permissions
```

- Routes are authenticated **by default**. `@Public()` is the opt-out and every
  use of it is a deliberate decision.
- A person holds **many roles at once** (14 role codes) with independent
  lifecycles. The same human can be a customer, a vendor and a driver.
- **Authorize on the underlying user id, not the active role.** See §6.
- Never weaken, bypass or reorder the guard chain to make a test pass.

---

## 4. Money — the wallet, escrow and settlement

The wallet is a **closed, correct, double-entry ledger** with system/clearing
accounts, escrow, holds, authorization and settlement. It is fully implemented
and heavily tested. What it does not have is any connection to the outside
world.

### Absolute rules

- **No direct balance writes.** Ever. Balances are derived from ledger entries.
  Every movement is a balanced transaction (debits equal credits) through the
  wallet service. `packages/wallet` rejects `UNBALANCED`, `EMPTY`,
  `NON_POSITIVE_AMOUNT` and `SINGLE_SIDED` transactions — do not route around it.
- **Money is integer minor units (BZD cents), always.** Never a float. The
  ledger uses `BigInt`; do not narrow it to `number`.
- **`isTest` is derived, never supplied.** It comes from the account or the
  escrow, and it propagates: payment -> escrow -> vendor settlement -> driver
  earning -> platform fee. Analytics and real reporting exclude it. A real
  customer is never routed over test infrastructure and a test parcel is never
  offered to a real driver.
- **Concurrency is not optional.** Wallet writes use row locks plus unique
  transaction references; checkout is guarded by idempotency keys. A wallet was
  once overspendable by concurrent requests (`95e8498`). Preserve these.
- **Do not build a second funding mechanism.** Two already exist and are
  correct: admin-granted test credit, and self-service UAT funding.

### Real money — requires explicit human approval

There is **no** payment provider, card processor, bank transfer, top-up,
payout, refund-to-source or withdrawal anywhere in this system, and
`PaymentMethodType.CREDIT_CARD` / `BANK_TRANSFER` are enum values with nothing
behind them.

**Do not implement, wire, enable or scaffold any real-money rail.** That
decision is the product owner's and depends on a provider choice, KYC/AML and
regulatory posture. If a task seems to require it, stop and ask.

### `ENABLE_SELF_SERVICE_TEST_FUNDING`

A temporary UAT mechanism letting a tester grant themselves BZ$250 of simulation
money, once, cumulatively. Ledger-backed, `isTest`, audited, no withdrawal path.

- The flag **defaults to off and is off when absent.** It is deliberately not
  keyed on `NODE_ENV`.
- It is **currently ON in production** for UAT. It must be switched off before
  commercial launch by unsetting the variable and redeploying. No code deletion
  is required, and none should be done.

---

## 5. Logistics, geography and business configuration

**Never invent any of the following.** Not for a demo, not to make a test pass,
not to fill an empty screen:

- Terminals, hubs, carriers, vehicles or drivers
- Routes, courier lanes, schedules or departure times
- Prices, rates, fees or delivery times
- Which towns are connected to which, or by what
- Distances, travel times or coverage areas

Production currently has **no transport network** — `/api/shipping/hubs` is `[]`,
`/api/shipping/modes` is `[]`, and `courier_lanes` is empty. **That is the
correct state**, not a bug to fix with seed data. Real hubs and routes require
carrier onboarding; a courier lane requires an approved commercial rate. Both
are business decisions entered by operations through the admin console.

### The planner never guesses geography

`packages/shared/src/route-planner.ts` is pure, deterministic and contains **no
place names**. It learns which towns share a road only from configured
`CourierLane` rows. Districts never imply a road — Belize City and San Pedro
share a district and one of them is on an island.

If the planner cannot make a trip, it **refuses with an explanation a customer
can act on**. It does not invent transport. Do not add a fallback that does.

### Do not claim capabilities that do not exist

There is no timetable or scheduled-departure calendar, **no live GPS tracking**
of any bus, boat or aircraft, and no reverse geocoding (a pin cannot fill in its
own town — which is part of why the town is asked for directly). Do not describe
these as working in code comments, UI copy, or reports.

### Classify problems honestly

| Symptom | Classification |
| --- | --- |
| Eligible driver online, dispatch never offers the job | **Engineering defect** |
| No driver onboarded | **Business dependency** |
| No water-taxi route configured | **Business configuration** |
| Planner cannot represent a bus leg | **Engineering gap** |

---

## 6. Named domain invariants — do not regress these

Each was a real defect once. Each has tests. If your change touches these areas,
run the named specs.

**A requester never fulfils their own delivery.** Matched on the underlying
**user id**, not the active role — the same person may be both customer and
driver. Covers automatic dispatch, the available-jobs feed, direct lookup,
direct accept, admin assignment and reassignment, for both marketplace
deliveries and shipping courier legs.
-> `apps/api/test/self-delivery.integration.spec.ts`, `self-courier.integration.spec.ts`

**No balance is ever written directly.** See §4.

**Test money stays test money.** See §4.
-> `apps/api/test/settlement.integration.spec.ts`, `wallet-authorization.integration.spec.ts`

**A delivery address is written down OR pinned — either alone is complete.**
A dropped pin is a complete answer; in Belize it is frequently the *better* half
of an address. But **town and district are always required**, pin or no pin —
they price the delivery, match the driver and drive the shipment planner. A pin
must never be allowed to imply them, because a mis-dropped pin would then
silently re-price the order.
-> `packages/validation/src/common.ts` (`isLocatable()`), `apps/web/lib/address.test.ts`

**A hub is optional.** Shipping does not require a terminal. `DOOR_TO_DOOR`
supports a completely direct courier run with no terminal at all. Service types
say *which ends BML is responsible for*, not whether a terminal is involved.

**The planner never guesses geography.** See §5.

**Simulation network data is isolated.** Hubs, routes and courier lanes carry
`isTest` and the two sides never mix.

**Marketplace delivery and shipping are deliberately distinct.** Marketplace
delivery (the customer bought goods) is priced by the vendor's own delivery
settings and zones, and **does not** go through the multimodal planner. Shipping
(the customer is sending a parcel) does. Do not force marketplace purchases
through the shipment planner.

---

## 7. Branding and terminology

- The user-facing abbreviation is **BML**, never "BMPL". Enforced by
  `packages/shared/src/brand-copy.test.ts`.
- Identifiers and persisted values are **exempt**: `@bmpl/*` package names, the
  `BMPL_HUB` enum value, the `X-BMPL-Commit` header. **Renaming those renames
  data** — do not.
- The product says **Driver** / **Delivery driver** / **Courier**. "Runman" is
  business shorthand, not product terminology; do not rename anything to it
  without an explicit decision.

---

## 8. Scope

**Passenger transportation is out of scope. Do not begin it**, despite
`PASSENGER_DRIVER` / `PASSENGER_PROVIDER` existing as role codes.

Active business areas, in priority order: Marketplace · Shipping & Delivery ·
Delivery driver · Wallet & payments. Also present but not the current focus:
Belize Connect (jobs), real estate, marketing.

---

## 9. Secrets

- Never print, log, echo, paste into a report, or commit a secret value.
- `.env` and `.env.*.local` are gitignored and must stay that way.
  `.env.example` carries **names and shapes only** — never a real value.
- CI runs a **gitleaks** filesystem scan (`.gitleaks.toml`) that fails the build
  on any finding.
- The API scrubs secrets from structured logs and Sentry. Do not add a log line
  that defeats it.
- When documenting configuration, write the variable **name** and what it does.
  Never its value.

---

## 10. Commands

```bash
pnpm install                 # --frozen-lockfile in CI
pnpm db:generate             # required before typecheck after a schema change
pnpm infra:up                # docker: postgres, redis, minio
pnpm db:migrate && pnpm db:seed
pnpm dev
```

Verification (see §11 for what to run when):

```bash
pnpm turbo run typecheck                  # 19/19 expected
pnpm test:unit                            # wallet + authorization + api
pnpm turbo run test --filter=@bmpl/shared --filter=@bmpl/validation --filter=@bmpl/web
pnpm --filter @bmpl/api test:integration  # needs TEST_DATABASE_URL + pnpm infra:up
                                          # 691 tests / 55 spec files, ~8 min
pnpm --filter @bmpl/api build && pnpm --filter @bmpl/web build && pnpm --filter @bmpl/admin build
```

### Known-broken commands — these are not your regression

| Command | Reality |
| --- | --- |
| `pnpm format:write` | **NEVER RUN THIS.** Rewrites ~490 files, destroys `git blame`, collides with every open branch. A repo-wide format is a deliberate, isolated, human-scheduled change. |
| `pnpm format:check` | Fails repo-wide. Pre-existing. Informational in CI. |
| `pnpm lint` | **No ESLint configuration exists anywhere in this repo.** Cannot pass. `continue-on-error` in CI. The 84 `eslint-disable` comments in the tree are inert. |
| `pnpm test` (`turbo run test`) | Reports 3 failures — `@bmpl/authentication`, `@bmpl/notifications` and `@bmpl/database` declare a `test` script with no test files. Use `pnpm test:unit`. |

Do not "fix" any of these as a side effect of unrelated work. Each is tracked
and each needs its own scoped change.

### Running the integration suite locally

Docker is available on this machine and the suite runs here — **691 tests across
55 spec files, ~8 minutes**, against real Postgres, Redis and MinIO.

```bash
pnpm infra:up            # postgres 5432, redis 6379, minio 9000/9001
# One-time: docker-compose creates only the `bmpl` dev database, so the
# disposable test database TEST_DATABASE_URL points at must be created once.
docker exec bmpl-postgres psql -U bmpl -d postgres -c "CREATE DATABASE bmpl_test OWNER bmpl;"
pnpm --filter @bmpl/api test:integration
```

`TEST_DATABASE_URL` is read from the root `.env` by `test/integration.global.ts`,
which then runs `prisma migrate deploy` against it. It **must** name a different
database from `DATABASE_URL` — the suite truncates between tests.

**A change to `apps/api/src`, the Prisma schema, money, dispatch or routing is
not verified until this suite has been run.** Unit tests do not cover the same
ground. If you genuinely cannot run it, say so explicitly rather than omitting
it.

---

## 11. Git and verification workflow

Full detail: [`docs/AGENT-WORKFLOW.md`](docs/AGENT-WORKFLOW.md). In short:

- **Never commit to `main`.** One branch per task:
  `feat|fix|chore|docs|test/<short-description>`.
- Commit **coherent** changes with a real message. Follow the existing style: a
  plain-English subject saying what changed for a *user*
  (`fix(shipping): one road could be configured as three lanes at three prices`).
- **Run the verification appropriate to the change before asking for
  integration**, and paste real output. Never claim a check passed without
  having run it.
- Significant changes are reviewed by another agent or by Michael before merge.
- **CI runs only on pull requests into `main` and on pushes to `main`** —
  pushing a feature branch on its own runs nothing and tests nothing. The
  integration suite runs *only* there unless you have local Postgres.
- Merging deploys: API -> Railway (which applies migrations as
  `preDeployCommand`), Web + Admin -> Vercel.

### Requires explicit human approval — never do these autonomously

- Merging to `main`, or anything that triggers a deployment
- Any production database operation, including migrations against production
- Enabling, wiring or activating any real-money movement
- Changing, adding or rotating any secret or production environment variable
- Any destructive operation, anywhere
- `git push --force`, history rewriting, or deleting a remote branch
- Changing `ENABLE_SELF_SERVICE_TEST_FUNDING` or `dispatchAutomatic`

---

## 12. How to work here

**Inspect before you build.** This is a large, mature codebase with a lot of
existing machinery. Before creating any new abstraction, service, helper,
component or table:

1. Search for an existing one. `packages/shared` and `packages/validation` are
   the first places to look.
2. If something close exists, extend it rather than adding a parallel
   implementation.
3. A second way to do something that already works is a defect, not a feature.

**Do not duplicate existing functionality.** Two funding mechanisms, two address
validators, two ways to price a courier leg — each of these has already been a
bug here.

**Write tests for behavioral changes.** A change to business logic, money,
authorization, dispatch, routing or validation lands with a test that fails
before the change and passes after. Follow the existing patterns in
`apps/api/test/*.integration.spec.ts` and `packages/*/src/*.test.ts`.

**Stay in scope.** Do not refactor, rename, reformat or "tidy" code unrelated to
your task. A scoped change that touches 6 files is reviewable; the same change
buried in 200 files of drive-by cleanup is not. If you find unrelated problems,
**report them** — do not fix them silently.

**Report uncertainty; never invent a business rule.** If you do not know what a
price should be, which towns connect, how a fee splits, what a status transition
means commercially, or whether something is allowed — **say so and ask.** A
plausible guess in this system becomes a real charge to a real person. "I don't
know, and here is what I would need to find out" is always an acceptable answer.
Inventing the answer is not.

**Prefer the smallest change that is actually correct.** Then say plainly what
you did, what you verified, and what you did not.

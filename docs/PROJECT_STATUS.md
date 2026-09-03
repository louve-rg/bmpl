# BML — project status

**Read this first.** It exists so a new session, on a new machine, can pick the
project up from the repository alone. It carries no secrets, no credentials and
no customer data — only what is true about the code and how it is run.

Last reviewed: 2026-09-03, against `main` at **`a2bab27`** — the marketplace
address and courier-lane work, **merged and deployed**. API, Web and Admin are
all serving that commit. What is still unverified is listed in §12.

When this document and the code disagree, **the code wins** — and then this
document is wrong and should be fixed in the same change.

**Before changing anything, read [`../CLAUDE.md`](../CLAUDE.md)** — the
engineering rules and the invariants that must not regress. Scoped rules live in
[`apps/api/CLAUDE.md`](../apps/api/CLAUDE.md) and
[`packages/database/CLAUDE.md`](../packages/database/CLAUDE.md). How work gets
branched, verified, reviewed and integrated is
[`AGENT-WORKFLOW.md`](./AGENT-WORKFLOW.md).

Superseded status documents from earlier phases are archived in
[`history/`](./history/README.md). **Nothing in there is current** — in
particular `REMAINING_WORK.md` still describes marketplace, shipping, jobs, real
estate and marketing as not started, and all five have shipped.

---

## 1. What BML is

Belize Marketplace & Logistics: a multi-role commerce and logistics platform for
Belize. One account, many roles — a person can be a customer, a vendor and a
delivery driver at once, and switch between them.

Active business areas, in the order they matter right now:

1. **Marketplace** — vendors, products, cart, checkout, orders.
2. **Shipping & Delivery** — sending a parcel, possibly across several legs.
3. **Delivery driver** — the courier who actually moves it.
4. **Wallet & payments** — a ledger, escrow and settlement behind all of it.

Also present, and **not** the current focus: Belize Connect (jobs), real estate,
marketing/promotions.

**Passenger transportation is out of scope.** Do not begin it.

---

## 2. Architecture

pnpm + Turborepo monorepo. Node 22–24, pnpm 9.

| Path | What it is |
| --- | --- |
| `apps/api` | NestJS API. The only thing that talks to the database. |
| `apps/web` | Next.js 14 customer + vendor + driver app. |
| `apps/admin` | Next.js admin console. |
| `apps/mobile` | Expo app. Not part of the current milestone. |
| `packages/database` | Prisma schema, migrations, seed. |
| `packages/shared` | Framework-free domain logic. **The route planner lives here.** |
| `packages/validation` | Zod schemas shared by API and browser. |
| `packages/authentication`, `packages/authorization` | Sessions, roles, permissions. |
| `packages/wallet` | Ledger primitives. |
| `packages/notifications`, `packages/ui` | Supporting. |

**Where a rule belongs.** Anything both the browser and the server must agree
about goes in `packages/validation` or `packages/shared`, and is imported by
both. A rule stated twice is a rule that will eventually disagree with itself —
several of the defects fixed in this repo were exactly that.

### Deployment

| Service | Where | How |
| --- | --- | --- |
| API | Railway | Docker, `railway.json`. `preDeployCommand` runs `prisma migrate deploy`. Health at `/api/health`. |
| Web | Vercel | `apps/web/vercel.json`. |
| Admin | Vercel | `apps/admin/vercel.json`. |

Every service reports the commit it is serving, so a deploy can be confirmed
rather than assumed:

```
curl -s https://www.bzemarketplace.com/api/health
# {"status":"ok","commit":"a2bab27", ...}
curl -s https://www.bzemarketplace.com/api/health/ready
# {"status":"ready","checks":{"database":true,"redis":true,"storage":"ok"}}

# Web and Admin carry it as a header, from VERCEL_GIT_COMMIT_SHA.
curl -sI https://www.bzemarketplace.com/ | grep -i x-bmpl-commit
curl -sI https://bmpl-admin.vercel.app/ | grep -i x-bmpl-commit
# X-Bmpl-Commit: a2bab27e703c
```

`/api/health/live` does not exist — do not look for it.

CI (`.github/workflows/ci.yml`): build + typecheck + `pnpm test:unit`, then
integration tests against real Postgres/Redis/MinIO. `format:check` and `lint`
are **informational** and currently fail repo-wide; do not treat that as a
regression, and do not run `format:write` as a side effect of unrelated work
(it rewrites ~490 files).

---

## 3. Invariants — do not regress these

These were each a real defect once. Each has tests.

**A requester never fulfils their own delivery.** Matched on underlying **user
id**, not active role. The same person may be both customer and driver; they
must not be sent their own job. Covers automatic dispatch, the available-jobs
feed, direct lookup, direct accept, admin assignment and reassignment, for both
marketplace deliveries and shipping courier legs.
→ `apps/api/test/self-delivery.integration.spec.ts`, `self-courier.integration.spec.ts`

**No balance is ever written directly.** Every movement is a balanced
double-entry transaction through the wallet service. Balances are derived.

**Test money stays test money.** `isTest` is derived from the account or the
escrow, never taken from a request. It propagates through payment → escrow →
vendor settlement → driver earning → platform fee, and analytics exclude it.
→ `apps/api/test/settlement.integration.spec.ts`, `wallet-authorization.integration.spec.ts`

**A delivery address is written down OR pinned — either alone is complete.**
The town and district are required in their own right, because they price the
delivery and match the driver. See §5.

**A hub is optional.** Shipping does not require a terminal. See §6.

**The planner never guesses geography.** Towns it has not been told about do not
become "local". A road courier is only planned where a configured lane, or the
same town, says one can make the trip.

**Simulation network data is isolated.** Hubs, routes and courier lanes carry
`isTest`; a real customer is never routed over a test node and vice versa.

---

## 4. Wallet

Ledger-backed, double-entry, with system/clearing accounts, escrow, holds,
authorization, settlement and full transaction history. Concurrency is handled
with row locks plus unique transaction references; idempotency keys guard
checkout.

### Temporary self-service UAT funding — **must be off before launch**

Already built and shipped (`fdf3e82`). Do not build a second mechanism.

- Endpoints: `GET /api/wallet/test-funding` (status), `POST /api/wallet/test-fund`.
- The client sends **nothing** — no user, no wallet, no amount. All three come
  from the session and server configuration.
- Cap is **cumulative**: BZ$250.00 once per account. Spending it does not earn
  another. A second attempt is a 409, not a top-up.
- Ledger-backed, `isTest`, audited as `WALLET_SELF_SERVICE_TEST_FUNDING_GRANTED`,
  excluded from real reporting, and there is no withdrawal path in the product
  at all.
- Kill switch `ENABLE_SELF_SERVICE_TEST_FUNDING`, **default off**, off when
  absent, and deliberately not keyed on `NODE_ENV` (UAT runs on the live stack).
  Optional `SELF_SERVICE_TEST_FUNDING_EXPIRES_AT` disarms it on a date.
- → `apps/api/test/self-service-funding.integration.spec.ts`

Administrative UAT credits are a **separate** mechanism with a separate audit
action, and do not consume anyone's self-service allowance.

**It is currently ON in production** (checked 2026-09-03). That is correct for
UAT and wrong for launch.

**Before commercial launch:** unset `ENABLE_SELF_SERVICE_TEST_FUNDING` on the
API service and redeploy. Nothing else has to be remembered — the flag is off
when absent, so removing it is enough, and no code has to be deleted.

---

## 5. Addresses

One model, one component, one rule, used by marketplace checkout and shipment
booking alike.

The customer picks **how** they give the address:

| Method | Asks for | Does not ask for |
| --- | --- | --- |
| Drop a pin | town, district, map pin | any street line |
| Type the address | street, town, district (+ geocoded pin) | — |
| Saved address | pick one; fields and pin are copied in | — |

**A pin is a complete answer.** In Belize it is frequently the better half of
the address — "behind the old bridge" is a real address and a useless navigation
target. Requiring a typed street as well is what made "drop a pin" pointless.

**The town and the district are always required**, pin or no pin. They are not
location detail: they price the delivery, match the driver, and tell the shipment
planner whether one courier can make the trip. A pin is never allowed to imply
them, because a mis-dropped pin would then silently re-price the order.

Where it lives:

- `packages/validation/src/common.ts` — `isLocatable()`, the one rule.
- `packages/validation/src/marketplace.ts` — `orderAddressSchema`.
- `packages/validation/src/shipping.ts` — `createShipmentSchema`.
- `apps/web/lib/address.ts` — `addressGap()` (says what is missing, in the
  customer's words) and `switchMethod()` (changing method leaves no stale
  answer behind). Unit-tested without a browser.
- `apps/web/components/address/AddressField.tsx` — the shared form.
- `packages/shared/src/geo.ts` — `addressLines()` for rendering an address that
  may have no street line, and `UNLOCATABLE_ADDRESS_MESSAGE`.

`order_addresses.addressLine1` is **nullable**; `city` is not.

---

## 6. Shipping & routing

### A hub is a node, not a requirement

A journey is: origin → *optional* courier → *optional* terminal → *optional*
transport leg(s) → *optional* terminal → *optional* courier → destination. All
of these are valid:

```
Sender → Courier → Recipient
Sender → Transport → Recipient collects at the terminal
Sender → Courier → Transport → Recipient collects
Sender → Transport → Courier → Recipient
Sender → Courier → Transport → Courier → Recipient
```

Service types (`DOOR_TO_DOOR`, `DOOR_TO_HUB`, `HUB_TO_DOOR`, `HUB_TO_HUB`) say
**which ends BML is responsible for**, not whether a terminal is involved.
`DOOR_TO_DOOR` supports a completely direct courier run with no terminal at all.

"Recipient meets the transport" is `DOOR_TO_HUB` / `HUB_TO_HUB` plus the
`AWAITING_COLLECTION` status and the collect endpoint — it is supported today,
and a last-mile courier is genuinely optional.

### How the planner decides (`packages/shared/src/route-planner.ts`)

Pure, deterministic, no place names in the file. In order:

1. **Same town, door to door** → one `DIRECT` courier leg. No terminal.
2. **A configured `CourierLane` connects the two towns** → one `DIRECT` leg,
   priced and timed from the lane's own row. Lanes are read in both directions.
3. Otherwise each door attaches to a hub in its own town (falling back to its
   district), and the cheapest chain of configured routes is found between them.
4. No chain → refused, with an explanation a customer can act on. **It never
   invents transport.**

Districts are never used to imply a road. Belize City and San Pedro share the
Belize District and one of them is on an island; the planner learns which towns
share a road from `CourierLane` rows, entered by operations at
`/dashboard/logistics/courier-lanes` in the admin console.

**Belize City → Ladyville** is exactly the case lanes exist for. Configure a lane
and it plans as one direct courier (Option A). Configure hubs and a route instead
and it plans as first-mile → line-haul → last-mile (Options B/C). The available
**service**, not the geography, decides the workflow.

### Transport modes

`LAND`, `AIR`, `SEA`. `/api/shipping/modes` is derived from **active configured
routes**, so the UI never offers a mode nothing runs. "Best available" picks the
cheapest chain that can actually make the trip.

### Not yet modelled

There is no scheduled-departure calendar and **no live vehicle tracking** for
buses, boats or aircraft, because no data source exists. `scheduleNote` is a
label operations write, and the leg state machine
(`PENDING → READY → IN_PROGRESS → COMPLETED`, plus `EXCEPTION`) can carry
departed/arrived/ready-for-collection without a rewrite when a real integration
arrives. **Do not claim live tracking.**

---

## 7. Marketplace delivery vs shipping

Related, deliberately distinct.

- **Marketplace delivery**: the customer bought goods. Vendor → courier →
  customer, priced by the vendor's own delivery settings and zones. It does not
  go through the multimodal planner.
- **Shipping**: the customer is sending a parcel. May involve couriers,
  carriers, terminals, recipient pickup, or combinations.

Do not force marketplace purchases through the shipment planner.

---

## 8. Terminology

The product says **Driver** / **Delivery driver** / **Courier**. "Runman" is
business shorthand heard in conversation, **not** current product terminology —
do not rename anything to it without an explicit decision. The concept is the
local first/last/direct courier.

The abbreviation is **BML**, never BMPL, in anything a person reads. Enforced by
`packages/shared/src/brand-copy.test.ts`. Identifiers and persisted enum values
(`BMPL_HUB`, package names `@bmpl/*`) are exempt — renaming those renames data.

---

## 9. Simulation vs real data

| Never fabricate | Use instead |
| --- | --- |
| Production terminals, carriers, routes, schedules, commercial rates | `isTest` rows, clearly marked, configured through the admin console |
| Driver accounts | Onboard a real driver, or use a designated test account |
| Wallet balances | The ledger, via the self-service or admin test-credit path |

`isTest` exists on users, vendors, drivers, orders, shipments, hubs, routes,
courier lanes and wallet transactions, and the two sides never mix: a real
customer is not routed over a test node, and a test parcel is never offered to a
real driver.

Distinguish carefully when reporting:

- Eligible driver online but dispatch never offers → **engineering defect**.
- No driver onboarded → **business dependency**.
- No water-taxi route configured → **business configuration**.
- Planner cannot represent a bus leg → **engineering gap**.

---

## 10. Configuration that changes behaviour

Read the live value; do not assume.

| Setting | Where | Notes |
| --- | --- | --- |
| `dispatchAutomatic` | `platform_settings` row, admin → Dispatch | Shipped **off** by migration `20261009120000_dispatch_default_off`. Whether it is on today must be read from the live row, not assumed. |
| `localCourierFeeMinor` / `localCourierFeeTestMinor` / `localCourierMinutes` | `platform_settings` | Prices a same-town direct courier run. 0 means "unset" and the quote says so rather than shipping free. |
| `LogisticsHub.courierFeeMinor` | per hub | Prices a door leg at that terminal. 0 = unset, flagged in the quote. |
| `CourierLane.priceMinor` | per lane | Prices a direct inter-town run. 0 = unset, flagged in the quote. |
| `ENABLE_SELF_SERVICE_TEST_FUNDING` | API env | Default off. See §4. |

---

## 11. Last milestone: shipped 2026-09-03

PR [#1](https://github.com/louve-rg/bmpl/pull/1), merged as **`a2bab27`**.

| | |
| --- | --- |
| Merge commit | `a2bab27` |
| API (Railway) | `a2bab27` · ready · database, redis, storage all ok |
| Web (Vercel) | `a2bab27e703c` |
| Admin (Vercel) | `a2bab27e703c` |
| CI on the PR | green — build/typecheck/unit, integration, secret scan |
| CI on `main` after merge | green |

### What shipped

1. **Marketplace address-method parity.** Checkout uses the shared
   `AddressField` — drop a pin / type the address / use a saved one. A pin with
   no street line is now accepted by the browser, the API schema and the
   database. This is Edward's report.
2. **Shipping pin-only booking.** The form had accepted a pin and the booking
   schema had then demanded a typed address. One rule both sides now, with the
   town required at every door end.
3. **`CourierLane`.** Operations can state that two towns are connected by road,
   which is what Belize City ↔ Ladyville needed. **The table is deployed and
   empty**, so routing is unchanged until a lane is entered.
4. **Recipient-meets-transport and optional last mile** — already supported, no
   model change made.
5. **Self-service BZ$250 UAT funding** — verified, not rebuilt; its kill switch
   is now documented in `.env.example`.

### Migrations, applied

Railway runs `prisma migrate deploy` as `preDeployCommand`, so the container
only takes traffic if both applied. It did, and readiness reports
`database: true`.

- `20261102090000_pin_only_delivery_address` — `DROP NOT NULL` on
  `order_addresses.addressLine1`. Loosening only; every existing row keeps its
  value, and the town stays `NOT NULL`.
- `20261102093000_courier_lanes` — an empty `courier_lanes` table with no
  foreign key to anything existing, plus two `AuditAction` values added with
  `IF NOT EXISTS`.

Corroborated from outside: `/api/admin/logistics/courier-lanes` answered `404`
before the deploy and `401` after, so the new route is live; and the same
migrations were applied by CI against real Postgres before the merge.

### Test evidence

- **691 integration tests across 55 spec files**, green — the first time they
  had ever run. Includes `orders` (18 → 20 tests, the two new pin-only checkout
  cases) and `shipping` (56 → 70, pin-only booking, courier-lane routing in both
  directions, lane pricing, and refusal of reversed and re-cased duplicates).
- **442 unit tests**, green. Typecheck 19/19. All builds.
- **Self-delivery regression green in CI**: `self-delivery` (6) and
  `self-courier` (5). `apps/api/src/dispatch` and both specs are byte-identical
  to the pre-merge `main`, so the invariant is unregressed by construction.
- **Money paths green in CI**: `shipment-payments` (16), `wallet-authorization`
  (11), `wallet-activation` (37), `settlement` (9), `self-service-funding` (10).

## 12. Known gaps and what still needs a person

### The one thing blocking sign-off

**Deployed browser and mobile QA of marketplace checkout has not been done.**
Everything about the fix is proven in CI against real Postgres, and it is live
on production — but nobody has yet opened it in a phone browser and watched the
pin drop. Edward reported the bug from a phone, so that is the test that
settles it, and no session so far has had browser automation available.

**The script to run is [`docs/quality/MARKETPLACE-ADDRESS-QA.md`](quality/MARKETPLACE-ADDRESS-QA.md)**
— step by step, with what a pass looks like at each width, and a UAT account
that already holds BZ$250 of test money.

The server half is already verified against deployed production. A pin-only
address passes validation and reaches the business layer; an address that is
neither written nor pinned is refused with "Tell us where to go: type the street
address, or drop a pin on the map."; a pin with no town is refused; and a pin
outside Belize is still rejected. What remains is the browser half — that the
form no longer asks for a street, and the pay button is not blocked.

### Live configuration

- **`ENABLE_SELF_SERVICE_TEST_FUNDING` is ON in production** (read 2026-09-03
  from a signed-in session). `GET /api/wallet/test-funding` returns
  `{"enabled": true, "amountMinor": 25000, "capMinor": 25000}`. Verified end to
  end on production: a fresh account claimed BZ$250, the wallet showed
  available 25000 / on hold 0 / total 25000, the ledger entry is described
  `Self-Service Test Credit` and carries `isTest: true`, the state survived a
  refresh, and a second claim was refused `409 Your test credit has already
  been issued.` — a cumulative grant, not a balance topped back up.
  **This must be switched off before commercial launch** (see §4).
- **The live `dispatchAutomatic` value is still unread.** It needs an admin
  session: Admin → Dispatch, or `GET /api/admin/ops/settings`. It shipped off
  by migration; whether it is on today is a live value, not something to infer.
  It was deliberately not changed by this milestone.

### Business configuration, not defects

- **Production has no transport network.** Re-checked after the deploy:
  `/api/shipping/hubs` → `[]`, `/api/shipping/modes` → `[]` (modes derive from
  active routes), and `courier_lanes` is deployed **empty**. Production Shipping
  can therefore quote a same-town direct courier and nothing else. That is the
  expected state and it should stay that way until real providers are onboarded.
- **No Belize City ↔ Ladyville lane exists, and no rate has been chosen.** The
  model supports it; the price is a business decision. Do not invent one to make
  a demo work. Create it at admin → Logistics → Courier lanes when there is a
  confirmed origin, destination, rate and authorisation.

### Standing limitations — do not describe these as working

- No timetables or scheduled departures. `scheduleNote` is a label an operator
  types, not a calendar.
- **No live GPS tracking of any bus, boat or aircraft.** No data source exists.
  The leg state machine can carry departed / arrived / ready-for-collection when
  a real integration arrives.
- No reverse geocoding: a pin cannot fill in its own town, which is part of why
  the town is asked for directly.
- No transport network is fabricated anywhere. Real hubs and routes need carrier
  onboarding; real courier lanes need an approved rate.

### Leftover from verification

- A production account **bml-uat-pinfix-20260903@example.com** was created on
  2026-09-03 to read the funding flag and exercise the deployed address rules.
  It holds BZ50 of correctly-marked test money. It is a real user row and is
  **not** flagged `isTest`, so flag or delete it (Admin -> Users) once the
  mobile QA in docs/quality/MARKETPLACE-ADDRESS-QA.md has been run with it.

### Repository housekeeping

- `format:check` fails repo-wide (~490 files). Pre-existing; informational in CI.
- `@bmpl/authentication`, `@bmpl/notifications` and `@bmpl/database` declare a
  `test` script but have no test files, so `turbo run test` reports them as
  failures. Pre-existing; CI runs `pnpm test:unit`, which excludes them.
- **No ESLint configuration exists anywhere in the repository**, so `pnpm lint`
  cannot pass and is `continue-on-error` in CI. The 84 `eslint-disable` comments
  in the tree are inert. Configuring it is tracked work, not a side task.
- **Docker is not installed on the current development machine**, so
  `pnpm infra:up` cannot run and the 691-test integration suite **cannot be run
  locally at all**. CI on a pull request is the only place it executes. Any API,
  schema, money, dispatch or routing change is unverified until its PR is green.
- **There is no browser or end-to-end test** (no Playwright, no Cypress).
  `apps/admin` has no test suite at all. Every UI behaviour is verified either by
  a pure-function unit test of the logic behind it, or by a person.
- **Tooling drift resolved 2026-09-03.** An uncommitted `shadcn` devDependency
  had been added at the repo root, which pulled ~1,047 lines into
  `pnpm-lock.yaml` and — the reason it mattered — re-resolved `next@14.2.35` in
  **both** `apps/web` and `apps/admin` to carry a `(@babel/core@7.29.7)` peer
  suffix. The package was unused (no `components.json`, no `@/components/ui`, no
  radix/cva/tailwind-merge anywhere), and the shadcn MCP server in `.mcp.json`
  invokes it via `npx` and never needed the dependency. The devDependency,
  lockfile and the `.npmrc` `ignore-workspace-root-check` flag added alongside it
  were reverted; `.mcp.json` and the `.gstack/` gitignore entry were kept.
  `pnpm install --frozen-lockfile` passes.

---
## 13. Working on this repo

```bash
pnpm install
pnpm db:generate
pnpm infra:up          # Docker: Postgres, Redis, MinIO
pnpm db:migrate && pnpm db:seed
pnpm dev
```

Before pushing:

```bash
pnpm turbo run typecheck
pnpm test:unit
pnpm turbo run test --filter=@bmpl/shared --filter=@bmpl/validation --filter=@bmpl/web
pnpm --filter @bmpl/api test:integration    # needs TEST_DATABASE_URL
pnpm --filter @bmpl/api build && pnpm --filter @bmpl/web build && pnpm --filter @bmpl/admin build
```

**Never commit to `main`.** One branch per task; integration is by pull request,
after review and verification. Full process: [`AGENT-WORKFLOW.md`](./AGENT-WORKFLOW.md).

**CI runs on pull requests into `main`, and on pushes to `main` — not on feature
branches.** Pushing a branch on its own runs nothing and tests nothing; open the
PR, which is what starts the integration job. That job is the only place the
integration suite runs at all unless you have local Postgres.

Merging deploys API (Railway) and Web/Admin (Vercel). Railway applies migrations
as `preDeployCommand`, so a failed migration fails the deploy rather than
half-applying. Afterwards confirm all three are actually serving your commit —
`/api/health` for the API, the `X-BMPL-Commit` header for Web and Admin.

**Never** delete legitimate wallet history, reset real accounts, remove audit
records, rewrite settled payments, mass-modify drivers, or create production
hubs, routes or rates that no real carrier operates.

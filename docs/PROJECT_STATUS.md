# BML — project status

**Read this first.** It exists so a new session, on a new machine, can pick the
project up from the repository alone. It carries no secrets, no credentials and
no customer data — only what is true about the code and how it is run.

Last reviewed: 2026-09-02, against `main` at `87b0566` plus four commits on
`fix/marketplace-address-and-courier-lanes` — **written, locally verified, and
NOT YET DEPLOYED**. See §11 and §12 for exactly how far it got and why.

When this document and the code disagree, **the code wins** — and then this
document is wrong and should be fixed in the same change.

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

Production API health reports the deployed commit:

```
curl -s https://www.bzemarketplace.com/api/health
# {"status":"ok","commit":"87b0566", ...}
curl -s https://www.bzemarketplace.com/api/health/ready
# {"status":"ready","checks":{"database":true,"redis":true,"storage":"ok"}}
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

**Before commercial launch:** unset `ENABLE_SELF_SERVICE_TEST_FUNDING` on the
API service and redeploy. Nothing else has to be remembered.

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

## 11. Current active work

Four commits on `fix/marketplace-address-and-courier-lanes`, based on `87b0566`:

| Commit | What it does |
| --- | --- |
| `c54c63c` | A dropped pin is an address; a courier can be planned between two towns on one road. |
| `9f6697a` | A blank test-funding expiry no longer stops the API booting. |
| `7710516` | This document. |
| `3521d0e` | One road could be configured as three lanes at three prices. |

### What is finished in code

1. **Marketplace address-method parity.** Checkout uses the shared
   `AddressField`; drop-pin / type-address / saved-address; a pin with no street
   line is accepted by the browser, the API schema and the database.
2. **Shipping pin-only booking.** `createShipmentSchema` had accepted a pin in
   the form and then demanded a typed address at booking. Same rule both sides
   now, with the town required at every door end.
3. **Direct-vs-terminal routing.** `CourierLane` lets operations state that two
   towns are connected by road. Ships with an empty table: with no lanes,
   routing behaviour is exactly what it is today.
4. **Recipient-meets-transport / optional last mile** — assessed, already
   supported (`AWAITING_COLLECTION`, `collectShipmentSchema`, `needsLastMile`).
   No model change made or needed.
5. **Self-service BZ$250 UAT funding** — verified, not rebuilt. `.env.example`
   now documents the kill switch.

### Verified locally (2026-09-02)

- Typecheck: 19/19 tasks, including the API test project.
- Unit tests: **442 passing** — 58 api, 209 shared, 43 validation, 127 web,
  7 wallet, 5 authorization.
- Builds: all 8 packages, plus API, Web and Admin.
- Self-delivery protections: `apps/api/src/dispatch` and both self-delivery /
  self-courier specs are **byte-identical to `main`** on this branch. Untouched,
  so unregressed by construction.

## 12. Known gaps and what still needs a person

- **NOT DEPLOYED, and blocked on a credential — not on the code.** Two sessions
  have now tried to push `fix/marketplace-address-and-courier-lanes` and failed
  for the same reason: this is a private repository and the machine has no
  usable GitHub credential in a non-interactive session. `git ls-remote` ends in
  `fatal: could not read Username for 'https://github.com'`; the credential
  helper is `manager`, which needs a GUI prompt nothing can answer. The network
  itself is fine — the git endpoint answers `401`, not a timeout.

  **To unblock it, run this once from an interactive terminal on this machine:**

  ```
  git push -u origin fix/marketplace-address-and-courier-lanes
  ```

  Authenticate when the credential manager prompts. Everything downstream —
  CI, the integration tests, the merge, the deploy, the migrations — then runs
  through the normal pipeline. Nothing else is waiting on engineering.

- **Integration tests have still never been run.** Neither machine had Docker or
  Postgres (5432 and 6379 closed, no `psql`), and pointing them at any real
  database is not an option because the suite calls `resetDb`. They are written
  — including pin-only checkout, pin-only booking, courier-lane routing and
  duplicate-lane refusal — and CI runs them against real Postgres/Redis/MinIO on
  the first push. **Do not treat this milestone as verified until that run is
  green.**
- **Browser and mobile-width verification has not been done, and it is the gate
  on this milestone.** Neither session had browser automation, and the fix is
  not on production to test against anyway. Edward reported the bug from a
  phone, so desktop-only checking would not settle it. After deploying, walk
  marketplace checkout at 320 / 375 / 390 / 430 / 768 px and desktop:
  drop-pin with "use my current location" and no street address, type-address,
  saved-address, and switching between all three without stale validation. Then
  the same three methods on shipment booking, through to an actual booking.
- **The live `dispatchAutomatic` value was not read** — it needs admin access.
  Check it at admin → Dispatch, or
  `GET /api/admin/ops/settings`.
- **The live `ENABLE_SELF_SERVICE_TEST_FUNDING` value is still unknown.**
  `GET /api/wallet/test-funding` answers `401` to an unauthenticated caller
  whether the flag is on or off, so its state cannot be inferred from outside —
  and it should not be guessed. Signed in, that endpoint returns
  `{"enabled": false}` when off, or the amount, cap and remaining allowance when
  on. Read it there.
- **Production has no shipping network configured.** Re-probed 2026-09-02:
  `/api/shipping/hubs` → `[]` and `/api/shipping/modes` → `[]`, so zero hubs and
  zero active routes (modes are derived from active routes). Courier lanes do
  not exist there yet at all — `/api/admin/logistics/courier-lanes` returns 404,
  which is the branch not being deployed. Today production Shipping can quote a
  same-town direct courier and nothing else. **This is business configuration,
  not a defect**, and the table is expected to stay empty until a real lane with
  a real approved rate exists. Do not invent one — the Belize City to Ladyville
  price is a business decision, not an engineering default.
- **Things BML does not do, and must not be described as doing.** No timetables
  or scheduled departures — `scheduleNote` is a label an operator types. **No
  live GPS tracking of any bus, boat or aircraft**, because no data source
  exists; the leg state machine can carry departed/arrived/ready-for-collection
  when a real integration arrives. No transport network is fabricated anywhere:
  real hubs and routes require carrier onboarding, and real courier lanes
  require a rate the business has approved.
- **No reverse geocoding.** A pin cannot fill in its own town, which is one
  reason the town is asked for directly.
- `format:check` fails repo-wide (~490 files). Pre-existing; informational in CI.
- `@bmpl/authentication`, `@bmpl/notifications` and `@bmpl/database` declare a
  `test` script but have no test files, so `turbo run test` reports them as
  failures. Pre-existing; CI runs `pnpm test:unit`, which does not include them.

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

Pushing `main` deploys API (Railway) and Web/Admin (Vercel). Confirm afterwards
that `/api/health` reports the commit you pushed.

**Never** delete legitimate wallet history, reset real accounts, remove audit
records, rewrite settled payments, mass-modify drivers, or create production
hubs, routes or rates that no real carrier operates.

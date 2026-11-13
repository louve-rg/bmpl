# MDF-705 — Terminal Workspace E2E fixture plan

Written before any environment exists (no local/staging BMPL, per
`terminal-feature-inventory.md`'s "Why nothing is WORKING" section and
Stanley's charter environment note). This is the plan the specs in this
directory (`mdf705-*.local-only.spec.ts`) already assume — nothing here is
provisioned yet; it becomes real the moment MDF-704 (Dwight) lands a runnable
environment, or a production terminal-staff test account is granted
(MDF-696).

## Isolation rules (same discipline as `mdf587-handoff-negative-cases`)

- No DB shortcut, ever. Every fixture is created through the real,
  already-sanctioned API a real operator would use: the admin console's
  `POST /admin/terminal/companies` / `.../locations` / `.../invites`, and the
  real public `POST /terminal/invites/accept` flow — never a Prisma write.
- Every terminal company created by a spec passes `isTest: true`.
- Every shipment a spec creates uses the existing UAT simulation hub pair
  `UATBC`/`UATBP` (`packages/database/prisma/seed-uat-logistics.ts`) as origin
  and destination — these already carry `isTest: true` and an already-priced
  courier lane, so booking against them doesn't invent a route.
- Every identifier a spec creates is suffixed with `Date.now()` (the existing
  `stamp` convention) so parallel/retried runs never collide, and nothing is
  deleted afterward — these are already-isolated test-side records, same
  ruling `mdf587`'s own fixtures operate under.
- Never touch `BML-MX7ND6Q3` or its legs. Never call
  `pnpm db:seed`/`db:reset`/`prisma migrate reset`.

## Accounts needed

| Role | How it's created | Scope |
|---|---|---|
| BML ops admin (`SEED_SUPER_ADMIN_EMAIL`/`SEED_SUPER_ADMIN_PASSWORD`) | Already seeded | Creates the terminal company, its locations, and its staff invites — the same account every existing terminal spec uses for this |
| Terminal MANAGER | `POST .../invites` with `memberRole: 'MANAGER'`, accepted via the public accept-invite flow | Granted BOTH `UATBC` and `UATBP` locations, so one account can drive a full DEPART→ARRIVE→HANDOFF→COLLECT cycle through the real UI without a second login |
| Terminal OPERATOR | Same invite flow, `memberRole: 'OPERATOR'` | Same two locations as MANAGER — the point of this fixture is that today (`Blocker 2`, confirmed in `terminal.service.ts`'s `assertStaffLocationAccess`, which reads only `location.hubId` and never `memberRole`) the two accounts are provably interchangeable; MDF-698 is what's expected to change that |
| Terminal staff scoped to ONE location only | Same invite flow, `locationIds: [locB]` only | Proves the wrong-terminal case: this account never sees a leg whose hub is `locA` |
| UAT customer/driver (`UAT_CUSTOMER_EMAIL`/`UAT_DRIVER_EMAIL`) | Already seeded | Needed only for the RELEASE_TO_COURIER case (needs a real `DRIVER_ACCEPTED` LAST_MILE leg) and the DIRECT-delivery regression control |

## Shipment states needed, and how each is reached (no DB shortcut)

| Queue section | Service type | How it's produced |
|---|---|---|
| DEPART (LINE_HAUL, `originHubId` mine, not yet departed) | `HUB_TO_HUB` (UATBC→UATBP) | `POST /shipping` with `payWithWallet: true` — the single LINE_HAUL leg is immediately `READY` |
| ARRIVE (LINE_HAUL, `destinationHubId` mine, departed not arrived) | Same shipment | `POST /terminal/legs/:id/depart` (via the real UI button) on the leg above |
| HANDOFF (LINE_HAUL, arrived, OR any FIRST_MILE) | Same shipment, after ARRIVE | `POST /terminal/legs/:id/arrive` (via the real UI button). The handoff PIN a LINE_HAUL leg needs is staff-revealed (`GET /admin/logistics/legs/:id/handoff-pin` — no self-reveal UI exists for staff on this leg kind, confirmed by grep; see "Known gaps" below) |
| COLLECT (shipment `AWAITING_COLLECTION`) | Same shipment, after HANDOFF | The shipment auto-recomputes once its only leg completes |
| RELEASE_TO_COURIER (LAST_MILE, `courierStatus: 'DRIVER_ACCEPTED'`) | `HUB_TO_DOOR` (UATBP→a written Belize City address — NOT UATBC→Belize City, which 400s as a local delivery under the real geo rule once origin and destination share a terminal's catchment; confirmed live, not a flake), booked via raw API (`payWithWallet: true`) since the booking UI's hub picker cannot select an `isTest` hub (confirmed defect, `mdf587`'s own WRONG-TERMINAL case) | The UAT driver fixture accepts the offered job (first click only — do not confirm pickup) |
| Invalid/locked collection | Same HUB_TO_HUB shape as COLLECT above | Five wrong codes through the real "Record collection" UI field |
| Wrong-terminal (any action) | Any of the above | A staff account granted only the OTHER hub attempts the same leg/shipment |
| Direct-delivery control | `DOOR_TO_DOOR` | Booked through the real customer UI exactly as `mdf587-shipping-journey` already does — asserted to NEVER appear in ANY terminal queue, at any hub, for any staff account |

## Known gaps this plan does not paper over

- **UPDATE (2026-11-12): both gaps below have since SHIPPED.** This section
  is left in place as the historical record of what was missing when this
  plan was written, not as a current status — see each bullet's own update.
- **No lookup-by-reference anywhere — CLOSED by #686/bbf90094.**
  `GET /terminal/shipments/:reference` now exists on
  `TerminalShipmentsController`, scoped via `myActiveHubIds`; real tests
  against it (own-hub happy path, cross-terminal 403, unknown-404-vs-
  DIRECT-403) live in `mdf699-terminal-lookup-by-reference.local-only.spec.ts`
  (the MDF-705 follow-up branch). Still open: the Terminal Workspace page
  itself has no lookup CONTROL (Oscar/MDF-702/MDF-710) — that half is the
  one remaining `test.fixme` in this file's own journey spec.
- **No Operator-forbidden-action list — CLOSED by MDF-698/#683 (`fe991b98`).**
  `GET /terminal/staff` is now MANAGER-only (`assertActiveMemberRole`),
  real test in `mdf705-terminal-manager-operator-login.local-only.spec.ts`
  asserting the divergence both ways plus the role-reason message. Per
  Stanley/god: this does not by itself close T-4, which still needs a
  MANAGER-only capability visible on a SCREEN (Oscar's staff tab).
- **No unlock-collection UI exists in the Terminal Workspace.** The lockout
  itself is reachable from the real "Record collection" field; clearing it is
  only reachable via `POST /admin/logistics/shipments/:id/unlock-collection`
  (BML ops staff only, confirmed by grep of `apps/web/app/dashboard/terminal`).
  A terminal manager who locks a shipment out has no in-product way to
  recover it — this is the inventory's own row 13 (PARTIAL, backend only),
  re-confirmed here, not newly discovered.

## What unblocks this plan

1. **MDF-704** (Dwight) — a runnable environment (local or staging) these
   specs can execute against. Until then every spec here is written, not run,
   and the honest status is NOT TESTED, never PASS.
2. **MDF-696** — if production is used instead of a local environment, a real
   terminal-staff production test account, under whatever boundaries the
   owner sets for production test data.
3. **MDF-698** (Pam) — the actual Operator-forbidden-action permission matrix,
   needed before `mdf705-terminal-role-separation.local-only.spec.ts`'s second
   half can assert anything beyond "the two roles are identical today."

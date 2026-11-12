# Terminal Workspace — demo-vs-real data labelling requirement

**MDF-707.** Owner requirement: a client exploring the Terminal Workspace
must never have to guess whether a shipment, a parcel, or the terminal
company itself in front of them is real or a demonstration, and must never
be able to act on real customer shipments, payments or sensitive records by
mistake. This document specifies the requirement precisely enough for Oscar
to implement and Stanley to verify independently — it is a requirement, not
an implementation; no code in this repository has been changed by this card.

---

## 1. What already enforces the boundary (do not re-build this)

The simulation boundary between test and real data in this part of the
system is **already real, at write time, today**:

- `TerminalCompanyProfile.isTest` (`packages/database/prisma/schema.prisma:5864`)
  is admin-set at creation and never derived from a signed-in account.
- `terminal.service.ts:155` refuses to authorize a terminal company at a
  hub whose `LogisticsHub.isTest` doesn't match the company's own `isTest` —
  a test company cannot be placed at a real hub or vice versa.
- `terminal.service.ts:315` refuses to let an existing user *accept* an
  invite into a terminal company whose `User.isTest` doesn't match the
  company's — a real person's account cannot be pulled into a test
  company's staff, or a test account into a real one. **Corrected
  2026-11-12**: this check runs inside `acceptInvite`, at the moment the
  invited person accepts — not when the invite is sent, as an earlier
  version of this line (and the dispatch it came from) said.
- `Shipment.isTest` (`schema.prisma:5090`) carries the same boundary at the
  parcel level. `ShipmentLeg` has no `isTest` column of its own — it is
  reached only through its `shipment` relation (`schema.prisma:5338-5341`),
  so every leg a terminal screen shows is real-or-test exactly as its
  parent shipment is.

**This requirement is about visibility, not enforcement.** The data cannot
leak across the boundary today; a person looking at the screen just cannot
currently tell which side of the boundary they're looking at.

## 2. The gap — three confirmed points where the data is unlabelled

1. `GET /terminal/me` (`terminal.controller.ts:157`, backed by
   `terminal.service.ts:537-556`, `myWorkspace`) **selects**
   `terminalCompany.isTest` (`terminal.service.ts:541`) but the object it
   actually returns (`terminal.service.ts:546-555`) never includes it. The
   value is fetched from the database and then thrown away before the
   response leaves the method.
2. `GET /terminal/queue` (`terminal.controller.ts:172-175`, backed by
   `apps/api/src/shipping/shipment.service.ts:5111-5214`, `terminalQueue`
   — corrected 2026-11-12 from `5111-5192`, which cut the function's own
   `return` statement mid-way) runs five separate Prisma queries — one per queue section (DEPART,
   ARRIVE, HANDOFF, RELEASE_TO_COURIER, COLLECT) — and **none of their five
   `select`/`include` clauses fetches `shipment.isTest`**
   (`shipment.service.ts:5118,5124,5143,5152,5161`). The backend cannot
   label a queue row today even if the frontend were ready to show it.
3. The frontend has nowhere to put either value even if both were sent:
   `apps/web/app/dashboard/terminal/page.tsx`'s `Workspace` interface
   (lines 44-49) and `QueueRow` union type (lines 51-65) carry no `isTest`
   field anywhere.

This is not a new or unusual shape of gap in this codebase — the same
"the API now has it, nothing renders it" pattern exists today for
`DriverProfile.isTest` in the admin console (confirmed 2026-11-12:
`admin-driver.service.ts` returns it since PR #662, but
`apps/admin/app/dashboard/drivers/page.tsx` and `drivers/[id]/page.tsx`
render nothing with it — see `docs/TEST-ACCOUNTS.md`'s `isTest` flags
table). Fixing the Terminal Workspace instance of it does not fix the
admin-console one; they are two separate frontend changes.

## 3. The requirement

### 3.1 Backend — carry the flag through, both endpoints

- `myWorkspace()` must include `isTest: member.terminalCompany.isTest` in
  the object it returns (alongside `companyId`, `companyName`,
  `memberRole`, `locations`).
- `terminalQueue()` must select `shipment.isTest` (or, for the two queries
  keyed off a leg, `shipment: { select: { ..., isTest: true } }`) in all
  five of its queries, and each of the five row-shapes it returns
  (`DEPART`, `ARRIVE`, `HANDOFF`, `RELEASE_TO_COURIER`, `COLLECT`) must
  carry an `isTest: boolean` field.

### 3.2 Frontend — where the label must be visible

- **Company level**: the `PageHeader` at the top of the Terminal Workspace
  (`apps/web/app/dashboard/terminal/page.tsx:272-280`) must show a visible
  "Demo" or "Test" badge whenever `workspace.isTest` is `true`. This is the
  first thing on the screen, before any queue row — a client opening the
  workspace for a test company must know it before reading anything else.
- **Per-row level**: every `QueueRowCard` (`page.tsx:334-496`) must show the
  same badge whenever that row's `isTest` is `true`, reusing the existing
  `Badge` component already used for the hub label (`page.tsx:387-391`) —
  not a new component, not a tooltip, not a hover-only affordance. **Per
  row, not only a single page-level banner**: if a terminal operator is
  ever authorized at both a test company and a real one, or a queue ever
  mixes rows from different shipments, a single banner cannot tell two
  adjacent rows apart. The badge must render even if a real banner is also
  present — belt and suspenders, not either/or.
- The badge text must say **"Demo"** or **"Test"** plainly — not an icon
  alone, not a color alone (color-only fails anyone who can't distinguish
  the color, and a plain reader of the page source should be able to tell
  too).
- Nothing in this requirement asks for a *real* record to be labelled.
  Only `isTest: true` renders a badge; `isTest: false` renders nothing
  extra. A real shipment must look exactly as it does today.

### 3.3 What this does not cover

- This requirement does not add a *new* protection against acting on real
  data — the guards in §1 already exist. It only makes the existing
  boundary visible to a human looking at the screen.
- This requirement does not cover the admin console's own
  `DriverProfile.isTest` gap (§2 above) — that is a separate frontend
  change, on a separate screen, not part of MDF-707's scope. Naming it here
  only so it is not mistaken for already covered by this one.
- This requirement does not invent a new data model or a new flag. Every
  flag named above already exists and is already enforced server-side.

## 4. How Stanley verifies this

PASS requires, on the real deployed Terminal Workspace, with a real
terminal-company account that holds at least one `isTest: true` demo
shipment and (if available) at least one real shipment:

1. Open the workspace signed in as a member of an `isTest` terminal
   company — the page header shows a visible "Demo" or "Test" label,
   without reading the database or asking anyone.
2. Each queue row for that company's demo shipments shows the same visible
   label on the row itself.
3. If a real shipment's row is ever visible in the same view (e.g. a
   company holding both), its row shows **no** such label, and is visually
   distinguishable from the demo rows without clicking into either one.
4. Nothing about this check depends on code reading, mocked data, or an
   assumption about how the badge "should" look from the ticket alone — the
   badge must actually render on the actual page.

If no `isTest: true` terminal company and shipment exist to test against
yet, that is a separate, already-known gap (`docs/TEST-ACCOUNTS.md`'s new
`TERMINAL_COMPANY` row — no reusable fixture exists today) and the correct
verdict is **BLOCKED**, naming that gap precisely — not a PASS on a
code-reading alone, and not a FAIL for a precondition this card does not
control.

**Update 2026-11-12:** Stanley accepted the §4 PASS criterion above
verbatim and logged the missing label itself as a new ticket, **T-7**,
owned by MDF-700 (the backend exposure in §3.1) and MDF-702 (the frontend
badge in §3.2) — so a future PASS on either card should be checked against
exactly this wording, not a looser paraphrase of it.

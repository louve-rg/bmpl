# Terminal Workspace — Edward-readiness evidence pack (living document)

**MDF-713.** This document holds four of the owner's seven final
deliverables for Edward's Terminal Workspace readiness: the PASS/FAIL
matrix per critical workflow, confirmation of the exact deployed version(s)
tested, the list of remaining limitations, and the structure the GO/NO-GO
recommendation sits in. (The other three are `docs/TEST-ACCOUNTS.md`,
`docs/TERMINAL-DEMO-DATA-LABELLING.md`, and
`docs/EDWARD-TERMINAL-ONBOARDING.md` — MDF-707.)

**What this document is not.** It is not a status exercise, and it does not
issue verdicts. Every PASS / FAIL / BLOCKED / NOT TESTED verdict below is
**Stanley's** (`stanley-mwe4jkri`, card MDF-697/ACCEPT-1) or an agent's own
self-declared NOT TESTED, attributed by name and dated. Where nobody has
ruled, the cell says **NOT TESTED** and names precisely what is missing — a
merged PR, a green CI check, or an existing endpoint is never read as a pass.
The **GO/NO-GO recommendation is the owner's, made through god** — this
document holds the slot for it (§4) and does not pre-fill it.

**Last synced against `tasks.json` and the cited PRs:** 2026-11-12, ~23:20
UTC. Re-sync before trusting a row that looks final — fourteen cards are
moving under this document right now.

---

## 1. Deployed version — not one number

**The trap:** naming a single commit as "the version tested" is wrong for
this programme. Confirmed by running `node scripts/deploy-status.mjs`
myself just now, independent of Toby's map (PR #679,
`docs/TERMINAL-DEPLOY-MAP.md`, not yet merged — cited below, not re-derived):

| Service | Commit actually serving | Matches `origin/main`? |
| --- | --- | --- |
| **Web** (Vercel, `www.bzemarketplace.com`) | `6cc75009` | Yes — current |
| **Admin** (Vercel, `bmpl-admin.vercel.app`) | `2951a385` | No — 1 commit behind, correctly: `6cc75009` touches only `apps/web`, nothing `@bmpl/admin` depends on |
| **API** (Railway) | `2951a385` | No — same reason; last deploy attempt `success` at `2026-11-12T03:28:53Z` |

This is **`NOTHING_TO_DELIVER`, not a stuck or failed deploy** — each
service is exactly as current as its own watch pattern says it should be
(`railway.json` for API, `turbo query affected` / Vercel's `ignoreCommand`
for admin and web). Any sentence in this document or the final owner report
that says "production is running `<one commit>`" is wrong by construction;
say which service, every time. Full per-workflow deploy-path table (which
app carries which Terminal Workspace surface, and the one-line curl check
for each) is in `docs/TERMINAL-DEPLOY-MAP.md` — read it there rather than
having this document re-derive it; it will go stale independently of this
one as more terminal PRs land.

---

## 2. PASS/FAIL matrix — Terminal Workspace critical workflows

**Legend.**

- **Code state** (the owner's six words, computed from the card + the
  deploy check above, never asserted on their own): `Implemented` (written,
  not yet merged) · `Merged` (on `main`, not yet deployed or deploy
  unconfirmed) · `Deployed` (confirmed serving, per §1) · `Production-verified`
  (Deployed **and** Stanley's verdict is PASS on the live app) ·
  `Blocked-by-authorization` (code is ready or nearly so; verification needs
  an access grant nobody has) · `Blocked-by-defect` (a real, confirmed code
  gap is what's stopping it).
- **Stanley verdict**: PASS / FAIL / BLOCKED / NOT TESTED, exactly as he
  wrote it, with his baseline commit and the ticket id from
  `hive/agents/stanley-mwe4jkri/acceptance-matrix.md` (MDF-697). I do not
  paraphrase his wording into a different verdict.

| # | Workflow | Card(s) | Code state (now) | Stanley verdict (MDF-697) | Note |
| - | --- | --- | --- | --- | --- |
| 1 | Collect parcel at counter (name + code) | MDF-696 (fix), MDF-703 (admin parity) | **Deployed** — fix merged+deployed to web at `6cc75009` (confirmed §1) | **FAIL** (ticket T-1, baseline `5cbb515c`, *before* this fix existed) | **Stale verdict, not resolved.** Stanley's FAIL predates the code fix. His own charter: "never mark a failure resolved on an implementer's report" — this row stays FAIL until he re-tests, even though the code he failed no longer matches what's deployed. Flagging the mismatch is this document's job; closing it is his. |
| 2 | Obtain the collection code (recipient/sender) | MDF-709 (API), MDF-710 (UI) | **Implemented** — both cards `doing`, not merged | **FAIL** (ticket T-2, corrected 2026-11-12) | Stanley's correction already names the exact fix path (reuse the CLOSE-2 two-step reveal pattern) and marks the live half NOT TESTED pending it. No owner decision needed — god's notes on both cards confirm this is pure build-out. |
| 3 | Collection lockout + a way forward when locked | MDF-698 (manager unlock-request), MDF-703 (messaging) | **Implemented** — both `doing` | **FAIL** (ticket T-6, added after PR #680 review) | Admin-only unlock is correct by design (owner's own ruling) and is not the defect; the screen giving the clerk nothing to do next is. |
| 4 | Look up a parcel by reference | MDF-699 | **Implemented** — contract approved (`GET /terminal/shipments/:reference`, 404/403/200 split, carries `isTest`); no PR yet | **FAIL** (ticket T-3) | Contract approval is a decision, not code — this row does not move to Merged until a PR lands. |
| 5 | MANAGER vs OPERATOR permission difference | MDF-698 | **Implemented** — PR #683 open (branch `fix/term-role-manager-operator-split`, commit `261692f4`), held for Stanley + CI, not merged | **FAIL** (ticket T-4) — *superseded design decision since his verdict, not yet re-tested* | God ruled **MANAGER is a strict superset of OPERATOR**, not disjoint (Edward is onboarded as the sole active Manager; a disjoint split would leave him unable to do anything on day one). PR #683 adds `assertActiveMemberRole`, a MANAGER-only `GET /terminal/staff` roster, and 5 integration tests — unit/typecheck green, integration **NOT TESTED** (Docker loss, see §3). **Today, before this PR merges, the two roles are still functionally identical** — independently confirmed a second time by Toby (same grep, same conclusion as Stanley and Jim before him). |
| 6 | Work queue (5 sections), including the silent 100/200-row cap | MDF-700 (cap + isTest), base queue pre-existing | **Deployed** (base) with a **named, confirmed gap** (silent truncation); contracts approved for 3 new siblings — `GET /terminal/inbound`, `/outbound`, `/custody` — each carrying `isTest` and paging/overflow from the start, no PR yet | **NOT TESTED** — "code supports it... live behaviour NOT run"; cap itself noted as ticket T-5 | — |
| 7 | Core actions: depart / arrive / handoff / release-to-courier | pre-existing, deployed | **Deployed** | **BLOCKED** (MDF-696/708 — no live account) | Jim's 8 real specs for this journey exist (PR #680, not merged) but **zero have been run** — he self-declared NOT TESTED on every one. |
| 8 | Custody chain / who holds a parcel, visible to staff | MDF-701 | **Implemented** — backend writes custody today; display does not exist yet | **FAIL** (ticket T-5, feature gap) | — |
| 9 | Manager dashboard / activity-audit / exception / manifest views | MDF-702, MDF-701 | **Implemented** — `doing`, rebuild in progress | **FAIL** (ticket T-5) | — |
| 10 | Staff invitation → account creation → sign-in, incl. delivery-outcome visibility | MDF-695 (merged+deployed) | **Deployed** — `2951a385`, confirmed §1 — but see note: provisioning does not finish inside the admin console | **BLOCKED** (MDF-696 + "a QA admin who is not the owner") | No real invite has been sent through the deployed admin UI yet; automated-test evidence only. **Toby's finding, load-bearing for MDF-708**: an invite does not become an ACTIVE member on admin action alone — the invited person must separately open a *different app, different domain* (`apps/web /terminal/accept-invite?token=...`), fill their own first name, last name and password, and even then receives no session there — signing in afterward is a further, separate step. **Two real people must complete this hop for each account.** For Edward specifically, the owner has already ruled he must activate his own account himself and must not be impersonated — so this is not a step the floor can do on his behalf even once provisioned. |
| 11 | Admin: terminal company + location setup | pre-existing, deployed | **Deployed** | **BLOCKED** (MDF-696) | — |
| 12 | Hub drop-off / release / line-haul: courier's own code visibility | MDF-711 | **Implemented** (pre-existing; under confirmation, not a UI build yet) | **NOT TESTED** — moved from FAIL after correction; the design is now read as *correct* (it's the courier's own pickup code, not the recipient's secret); pending MDF-711's written confirmation | Not a security defect as first reported — see MDF-711's own notes. |
| 13 | Demo/test data visibly labelled on this screen | MDF-707 (spec, PR #681 open), MDF-700 (backend exposure), MDF-702 (frontend badge) | **Implemented** (spec only; code not started) | **FAIL** (new ticket **T-7**) | Stanley accepted the spec's own PASS criterion verbatim: *"a rendered Demo or Test label observed on a real isTest company and a real isTest parcel, absent on a real one, and a code reading cannot satisfy it."* That exact wording now binds MDF-700/702 — a future claim of PASS here must be checked against it, not a looser paraphrase. |
| 14 | Terminal company + hub provisioning actually usable for `isTest` data | MDF-708, new cards HUB-ISTEST-API / HUB-ISTEST-UI | **Blocked-by-defect** — see note | **Not Stanley's own row; Toby's finding, 23:07** | **Toby found the thing that would have made the pending owner grant fail outright.** There is no way to create a hub with `isTest: true` — `createHubSchema`/`hubBase` has no such field and `createHub` spreads validated input straight into Prisma's `create`, so `isTest` can only default to `false`. Attaching a location to a terminal company only offers hubs whose `isTest` matches the company's own. So ticking **"Simulation company (isTest)"** at company creation produces an **empty hub dropdown** at the very next step, with nothing further to click — the demo-data path the owner's grant is supposed to produce does not work today. Carded urgent, ahead of MDF-700/701: **HUB-ISTEST-API** (Pam) and **HUB-ISTEST-UI** (Oscar). This is why MDF-708 was held rather than sent to the owner as Toby's provisioning-clicks document stood. |

**Rows 1–12 cover every workflow named in Stanley's own Section 1 (Terminal
Workspace).** Row 13 (demo labelling) is the ticket his audit predates but
has since adopted (T-7). **Row 14 is not a Stanley verdict at all** — it is
Toby's provisioning-mechanics finding, included because it directly
controls whether MDF-708's pending owner grant would actually produce usable
test data; I've labelled its "verdict" column accordingly rather than
inventing a Stanley attribution for it. Section 2–6 of his matrix (other
role workflows, messaging, marketplace, logistics, notifications) are real
findings but are **out of this card's scope** — this document tracks
Edward's Terminal Workspace readiness specifically, not the whole-platform
audit.

---

## 3. Remaining limitations (concise)

Pulled from the cards and from Stanley's own matrix/tickets, not re-derived:

- **No row above is PASS.** Stanley has run nothing live — no Docker, no
  PostgreSQL, no browser, no non-production QA account exist on his
  machine, and production has no spare terminal to test against. His own
  words: "So no row is PASS." This is the single fact MDF-708 exists to fix.
- **Stanley flagged his own test-instrument gaps** reviewing PR #680 (Jim's
  e2e specs) — real, specific, worth carrying forward rather than trusting
  the spec file at face value once it does run: the collection-code
  assertion reads the code from an API response, not the rendered screen,
  so it would pass while the T-2 defect (nothing shows the recipient their
  code) stays broken; the handoff-code assertion is fetched with an admin
  session, hiding that terminal staff alone cannot get it; two assertions
  (`wrong-terminal`, `direct-delivery`) check only that a reference is
  *not* visible, with no positive control, so they'd pass on an empty or
  broken page too.
- **MANAGER and OPERATOR are identical today in the deployed code** —
  confirmed independently three times now (Stanley's grep, Jim, then Toby).
  **This has a date on it, not a permanent one**: PR #683 (MANAGER as a
  strict superset of OPERATOR) is written and held for Stanley + CI, not a
  speculative fix.
- **No way exists today to create an `isTest: true` hub** — confirmed by
  Toby while writing MDF-708's provisioning-click document: neither
  `createHubSchema` nor `createHub` accepts or sets it, so ticking
  "Simulation company (isTest)" at company creation leads to an empty hub
  dropdown with nothing further to click. **This blocks MDF-708's pending
  grant from producing anything usable** until HUB-ISTEST-API/HUB-ISTEST-UI
  ship — carded urgent, ahead of MDF-700/701.
- **The console's own demo-company control is a one-way switch, not a
  setting.** The admin creation form's checkbox is literally labelled
  `"Simulation company (isTest) — never mixed with real hubs or real
  staff"` (`apps/admin/app/dashboard/logistics/terminal-companies/
  page.tsx:174`); `isTest` is accepted by `createTerminalCompanySchema` but
  deliberately excluded from `updateTerminalCompanySchema`
  (`packages/validation/src/terminal.ts:16-29`, whose own comment says
  flipping it later "would orphan [locations/members], not correct a
  typo"). Describe it in any owner-facing material as an **irreversible
  creation-time choice**, not a toggle that can be corrected afterward.
- **No integration test can run on this host for anyone, right now** — not
  a pre-existing absence but a **regression**: Docker Desktop was present
  and the full 1,562-test integration suite ran successfully from a
  different worktree on 2026-11-09; by 2026-11-12 `C:/Program
  Files/Docker` no longer exists on the same host, with no native
  PostgreSQL either. This blocks MDF-699, 700, 701, 709 and 711 from
  integration coverage until MDF-704 lands or Docker is restored — every
  PR in this programme is shipping with integration explicitly declared
  NOT TESTED in the meantime, which is the correct declaration, not a
  shortcut.
- **The gate is catching real problems before merge, which is its own
  limitation worth naming: evidence takes longer to produce than code
  does.** Stanley rejected PR #680 (Jim's e2e specs) as not mergeable —
  four specs that could pass without proving anything, three blind spots
  that would hide the exact gaps they're meant to catch (see above) — and
  separately rejected PR #679 (the deploy map + OpenAPI baseline) on
  accuracy: ten endpoints documented as returning 200 when NestJS actually
  returns 201 with no `@HttpCode` override, three schema/model
  misattributions, and an endpoint count off by two. The underlying deploy
  *facts* this document's §1 relies on were not among the rejected parts —
  Stanley confirmed those hold — but neither PR is merged, so cite them as
  held-for-correction, not as shipped.
- **No parcel lookup, no custody view, no activity/audit view, no
  manifest/print, no exception report exist in the Terminal Workspace
  today.** All in progress (MDF-699, 701, 702), none merged.
- **The collection-lockout screen leaves a clerk with no way forward.**
  Admin-only unlock is the owner's own design and is correct; the missing
  explanation is the gap (MDF-698, MDF-703).
- **No reusable `TERMINAL_COMPANY` test fixture exists anywhere** (confirmed
  2026-11-12, `docs/TEST-ACCOUNTS.md`) — this is the structural reason
  Stanley cannot be handed a demo account today without an owner action on
  MDF-708.
- **The demo/real data label does not exist on screen yet** — the
  requirement is specified (`docs/TERMINAL-DEMO-DATA-LABELLING.md`, ticket
  T-7); nothing has been built against it.
- **A terminal company member holds literally none of the admin
  permission list** — Toby's definitive answer on MDF-708's minimum-grant
  question: `TerminalController`'s own class comment confirms a member has
  neither a `RoleCode` nor any admin permission; the entire grant is
  `memberRole` plus the one location checked. There is nothing narrower or
  broader to choose — the owner has no permission decision left to make on
  this specific point.
- **By design, not a gap:** admin-only collection-code unlock; no real-money
  rail anywhere (root `CLAUDE.md` §1); production carries no hubs/lanes
  until configured through the admin console (§5).

---

## 4. GO / NO-GO recommendation

**Not filled in by this document.** This is god's recommendation to the
owner, made once Stanley's matrix in §2 has enough PASS rows against a
confirmed deployed version to support one — see MDF-708, which this section
exists to feed. Edward's confirmed contact details live on MDF-650 and are
not repeated here.

---

## How to keep this living

- Update §2 by re-reading the specific card's current notes and/or
  `hive/agents/stanley-mwe4jkri/acceptance-matrix.md` — never by inferring a
  row from a PR merging or a check going green.
- A code fix landing after a Stanley FAIL does **not** change his verdict in
  this table. Note the mismatch explicitly (as row 1 does) and wait for his
  re-test.
- Re-run `node scripts/deploy-status.mjs` before restating §1 — it reads
  live config and production every time; this document's own copy of its
  output is a snapshot, not a source of truth going forward.
- If a workflow here is ever re-scoped, split, or merged into another card,
  say so in this table rather than deleting the row silently — a reader
  comparing this document to an earlier version should be able to tell what
  changed and why.

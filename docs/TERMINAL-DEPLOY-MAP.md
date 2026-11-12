# Terminal Workspace — deploy dependency map

MDF-706. One question only: for each Terminal Workspace workflow, which app
carries it, which deploy path ships that app, what makes that path trigger on
a given commit, and how to confirm from outside that a commit is actually
serving. Full mechanism detail (watch patterns, the `inactive`-vs-failed
trap, API/web sequencing) already lives in
[`DEPLOYMENT.md`](./DEPLOYMENT.md) §2a/§2b — this file does not repeat that,
it applies it to one feature.

**The concrete problem this answers:** `6cc75009` deployed web-only because
it touched only `apps/web`, which matches no `railway.json` watch pattern.
That is *correct* behaviour — but it means an API change in this programme
could, in principle, land on `main` and never reach Railway if nobody checks
which files it actually touched. The map below exists so that check is a
lookup, not a guess, for every Terminal Workspace surface and for the four
endpoints Pam is landing now (MDF-698–701).

## Live worked example (checked 2026-11-12, not hypothetical)

Two adjacent terminal commits on `main` right now behave differently on
purpose, and production currently proves it:

| Commit | Touched | Deploys to | Confirmed live right now |
| --- | --- | --- | --- |
| `2951a385` (#676) | `apps/admin/.../terminal-companies/[id]/page.tsx`, `apps/api/src/terminal/terminal.controller.ts`, `apps/api/src/terminal/terminal.service.ts` | Admin (Vercel) **and** API (Railway) | `curl -sI https://bmpl-admin.vercel.app/ \| grep -i x-bmpl-commit` → `2951a385e2c3`; `curl -s https://bmplapi-production.up.railway.app/api/health` → `"commit":"2951a38"` |
| `6cc75009` (#677, `main`'s tip) | `apps/web/app/dashboard/terminal/page.tsx` only | Web (Vercel) only | `curl -sI https://www.bzemarketplace.com/ \| grep -i x-bmpl-commit` → `6cc750092c39` |

Admin and the API are one commit "behind" `main` at this instant — correctly.
Neither has anything to rebuild from `6cc75009`, because it never touches a
file either platform watches. This is `NOTHING_TO_DELIVER`, not `BEHIND` —
see `DEPLOYMENT.md` §2a. `node scripts/deploy-status.mjs` reports exactly this
for all three services at once and is the authoritative tool below, not a
reimplementation of it.

## Per-workflow map

Every row's "Watched by" column is a fact already true today, verified by
reading `railway.json`'s `watchPatterns`, `apps/web/package.json` and
`apps/admin/package.json`'s own `@bmpl/*` dependencies (which decide what
`turbo query affected` — the exact check each app's `vercel.json`
`ignoreCommand` runs — can ever call "affected"), not assumed from a file's
directory name.

| Terminal workflow | Surfaces (frontend / backend / shared) | Deploy path | Watched by | One-line check |
| --- | --- | --- | --- | --- |
| Admin: manage terminal companies, locations, invites, members | `apps/admin/app/dashboard/logistics/terminal-companies/**` · `apps/api/src/terminal/terminal.controller.ts` (`AdminTerminalController`) + `terminal.service.ts` · `packages/validation/src/terminal.ts` · `packages/shared/src/permissions.ts` (`terminals.read`/`terminals.manage`) | Admin → Vercel · API → Railway | `apps/api/**` (direct Railway pattern); `packages/validation/**`, `packages/shared/**` (Railway pattern **and** `@bmpl/admin`'s own dependency, so both rebuild from the same change) | `curl -sI https://bmpl-admin.vercel.app/ \| grep -i x-bmpl-commit` + `curl -s .../api/health` |
| Public: terminal staff accepts an email invite | `apps/web/app/terminal/accept-invite/page.tsx` · `apps/api/src/terminal/terminal.controller.ts` (`TerminalInviteController`, `@Public`) + `terminal.service.ts` (`acceptInvite`) · `packages/validation/src/terminal.ts` | Web → Vercel · API → Railway | `apps/api/**`; `packages/validation/**` (both) | `curl -sI https://www.bzemarketplace.com/ \| grep -i x-bmpl-commit` + `curl -s .../api/health` |
| Terminal staff: workspace / queue | `apps/web/app/dashboard/terminal/page.tsx` · `apps/web/lib/use-terminal-membership.ts` · `apps/api/src/terminal/terminal.controller.ts` (`TerminalController`: `GET terminal/me`, `GET terminal/queue`) + `ShipmentService.terminalQueue` | Web → Vercel · API → Railway | `apps/api/**` | same as above |
| Terminal staff: handoff / release-to-courier / depart / arrive (leg custody) | `apps/web/app/dashboard/terminal/page.tsx` · `apps/api/src/terminal/terminal.controller.ts` (`TerminalLegsController`) → `ShipmentService` · `packages/validation/src/shipping.ts` (`legHandoffSchema` :398, `legDepartSchema` :365, `legReleaseToCourierSchema`) | Web → Vercel · API → Railway | `apps/api/**`; `packages/validation/**` (both) | same as above |
| Terminal staff: collect (recipient collection at destination) | `apps/web/app/dashboard/terminal/page.tsx` · `apps/api/src/terminal/terminal.controller.ts` (`TerminalShipmentsController`) → `ShipmentService.recordCollection` · `packages/validation/src/shipping.ts` (`collectShipmentSchema` :584) | Web → Vercel · API → Railway | `apps/api/**`; `packages/validation/**` (both) | same as above |
| Any workflow above, if a `TerminalCompanyProfile`/`TerminalCompanyMember`/`TerminalCompanyLocation` schema or migration changes | `packages/database/prisma/schema.prisma` + a migration | API only (web/admin never touch Prisma directly — §2 of `CLAUDE.md`, the database boundary) | `packages/database/**` (Railway pattern; **not** a turbo dependency of `@bmpl/web`/`@bmpl/admin`, so a schema-only change never triggers a web or admin rebuild on its own, correctly) | `curl -s .../api/health` only — a schema change with no frontend-visible effect has nothing to check on web/admin |

## Pam's four endpoints landing now (MDF-698–701)

TERM-ROLE, TERM-LOOKUP, TERM-INBOUND, TERM-HISTORY are all new reads/guards
inside the existing terminal surface — expected in
`apps/api/src/terminal/**` and/or `apps/api/src/shipping/**`, with new
request/response shapes in `packages/validation/src/{terminal,shipping}.ts`
(membership/role reads belong with the existing `terminal.ts` schemas; leg/
shipment lookups belong with `shipping.ts`'s, same as the existing custody
actions above). **Every one
of those paths is already inside `railway.json`'s watch patterns** (`apps/api/**`,
`packages/validation/**`) — there is no new watch-pattern gap to open for
these four cards on the API side. The risk for this batch is not "will
Railway notice," it is sequencing (`DEPLOYMENT.md` §2b): Vercel ships in
about a minute, Railway in 11–16. If a terminal frontend screen for one of
these four lands in the same PR or shortly after its API half, deploy and
verify the API first (`curl -s https://bmplapi-production.up.railway.app/api/health`
reporting the intended commit) before trusting the web build that calls it —
otherwise the faster-deploying client-facing screen can call an endpoint
that is not live yet, a hard 404, not a graceful failure.

## The one check that answers all of the above at once

```bash
node scripts/deploy-status.mjs
```

Reports, for API/web/admin together: the commit each is actually serving,
whether `main` is ahead in a way that platform would ever rebuild from (the
exact `watchPatterns` / `turbo query affected` logic each platform's own
config runs — not a re-derived approximation of it), and whether the last
Railway deploy attempt itself succeeded, is still running, or went
`inactive` without a replacement (the open-ended risk this card's own
framing names: "an API change can silently fail to ship"). No credential
needed — it reads `origin/main` over git and calls three public HTTP
endpoints. This table exists to localize that general tool's answer to one
terminal workflow at a time; the tool, not this table, is the one to trust
if they ever disagree — this file can go stale, `scripts/deploy-status.mjs`
reads the live config every time it runs.

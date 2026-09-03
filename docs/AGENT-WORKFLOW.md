# Agent development workflow

How autonomous agents make changes to BML without breaking production.

Read [`CLAUDE.md`](../CLAUDE.md) first — this document is the *process*; that one
is the *rules*. Where they appear to conflict, `CLAUDE.md` wins.

---

## 1. Roles

| Role | Who | Responsibility |
| --- | --- | --- |
| **Orchestrator** | Michael (`god`) | Decomposes work, assigns owners, reviews, integrates, holds the human's approval gates |
| **Implementer** | A specialist agent | Owns one task end to end: branch, change, tests, verification, report |
| **Reviewer** | A different agent, or Michael | Reviews significant changes before integration. **Never the implementer.** |
| **Approver** | The human product owner | The only one who can approve the gates in §7 |

An agent never reviews or merges its own work.

---

## 2. Branching

**No agent commits to `main`. Ever.** `main` is deployed automatically on merge:
API to Railway (which applies database migrations as its `preDeployCommand`) and
Web + Admin to Vercel. A commit to `main` is a production release.

One branch per task:

```
feat/<short-description>     new capability
fix/<short-description>      defect repair
chore/<short-description>    tooling, config, dependencies
docs/<short-description>     documentation only
test/<short-description>     tests only
```

Branch from an up-to-date `main`:

```bash
git fetch origin
git checkout -b fix/driver-queue-position origin/main
```

### Worktrees for concurrent work

When two or more agents work at the same time, each takes an **isolated
worktree** so they cannot corrupt each other's build output, generated Prisma
client or `node_modules`:

```bash
git worktree add ../bmpl-driver-queue -b fix/driver-queue-position origin/main
cd ../bmpl-driver-queue
pnpm install --frozen-lockfile
pnpm db:generate
```

A worktree needs its own install (`node-linker=isolated`), which costs disk and
about half a minute. For a single agent working alone, a plain branch in the
main checkout is fine. **Two agents in one checkout is not.**

Remove it when the work is integrated: `git worktree remove ../bmpl-driver-queue`.

---

## 3. Committing

Commit **coherent** changes — one commit should be one comprehensible step, not
a day's worth of unrelated edits, and not thirty commits of "wip".

Follow the existing message style. The subject says, in plain English, what
changed **for a person using the product** — not which function was edited:

```
fix(shipping): one road could be configured as three lanes at three prices
fix(payments): a wallet could be overspent by concurrent requests
feat(wallet): a tester can fund their own wallet, and test money stays test money
```

The body explains *why*, what was rejected, and what deliberately did not
change. Migrations carry the same explanation in their SQL (see
`packages/database/CLAUDE.md`).

Do not include unrelated files. If `git status` shows something you did not
intend to change, find out why before committing it.

---

## 4. Verification — run it before you claim it

**Never state that a check passed without having run it and read the output.**
Paste the real result into your report. "Should pass" is not a result.

Run the checks appropriate to what you touched. Cheapest useful set, always:

```bash
pnpm turbo run typecheck    # 19/19 expected
pnpm test:unit
```

| If you changed… | Also run |
| --- | --- |
| `packages/shared` or `packages/validation` | `pnpm turbo run test --filter=@bmpl/shared --filter=@bmpl/validation --filter=@bmpl/web` |
| Anything in `apps/api/src` | `pnpm --filter @bmpl/api test:integration` and `pnpm --filter @bmpl/api build` |
| The Prisma schema or a migration | `pnpm db:generate`, then the integration suite (its `globalSetup` applies migrations to a real database) |
| Money, escrow or settlement | integration: `shipment-payments`, `wallet-authorization`, `wallet-activation`, `settlement`, `self-service-funding` |
| Dispatch, driver, delivery or shipping | integration: `self-delivery`, `self-courier`, `dispatch`, `dispatch-engine`, `driver-queue` |
| Addresses or checkout | integration: `orders`, `shipping`; unit: `apps/web/lib/address.test.ts` |
| `apps/web` | `pnpm --filter @bmpl/web test` and `pnpm --filter @bmpl/web build` |
| `apps/admin` | `pnpm --filter @bmpl/admin build` (no test suite exists yet) |
| Any user-facing copy | `pnpm turbo run test --filter=@bmpl/shared` (brand copy: it is **BML**, never BMPL) |

The integration suite needs `TEST_DATABASE_URL` and a live Postgres, Redis and
MinIO (`pnpm infra:up`). **If you cannot run it, say so explicitly in your
report** — do not silently omit it, and do not present unit tests as though they
covered the same ground.

> **On the current development machine, Docker is not installed**, so
> `pnpm infra:up` cannot start Postgres/Redis/MinIO and **the 691-test
> integration suite cannot be run locally by anyone.** Until Docker (or a remote
> test database) is available, **the CI job on the pull request is the only place
> the integration suite runs at all.**
>
> Two consequences, and they are not optional:
> 1. Any change to `apps/api/src`, the Prisma schema, money, dispatch or routing
>    is **unverified until its PR is open and CI is green.** Never describe such
>    a change as verified before that.
> 2. Opening that PR is therefore part of verification, not the end of it — but
>    **merging it still requires human approval** (§7).
>
> Getting Docker installed, or a remote test database provisioned, is the single
> highest-value change to this workflow.

### Checks that are already red — not your regression

`pnpm lint` (no ESLint config exists), `pnpm format:check` (~490 files) and
`pnpm test` / `turbo run test` (three packages declare a `test` script with no
tests). See `CLAUDE.md` §10. Do not fix these as a side effect; do not let them
mask a real failure either — read the output.

**Never run `pnpm format:write`.**

---

## 5. Handing work back

The implementer reports: what changed, why, the verification commands run and
their **actual output**, what was *not* verified, and anything found but
deliberately left alone.

**If verification fails, the work goes back to the implementing agent.** It is
not the reviewer's job to fix it, and a failing check is never "flaky" until
somebody has proved it. Re-run, diagnose, fix, re-verify, re-report.

### Review

Significant changes are reviewed by a different agent or by Michael before
integration. "Significant" means any of:

- money, escrow, settlement or the ledger
- authorization, authentication or a guard
- dispatch, driver assignment or routing
- a Prisma migration
- anything touching a named invariant in `CLAUDE.md` §6
- more than ~200 changed lines, or more than ~10 files

The reviewer checks: does it do what the task asked; does it break a named
invariant; is a rule now stated twice; is there a test that would have caught
the original defect; is the scope clean; were the right checks actually run.

Documentation-only and test-only changes may be integrated on the implementer's
own verification, with Michael's sign-off.

---

## 6. Integration

Only verified, reviewed work is integrated. Michael integrates; implementers do
not merge their own branches.

The route to `main` is a **pull request**, because CI runs on pull requests into
`main` and on pushes to `main` — **and nowhere else**. Pushing a feature branch
runs nothing and tests nothing. The integration suite runs in CI *only* on the
PR, so for anyone without local Postgres the PR is the first real test.

CI must be green: build + typecheck + unit, the integration job, and the
gitleaks secret scan. (`format:check` and `lint` are `continue-on-error` and are
expected to be red.)

**Merging is a production release and requires human approval** — see §7.

After a merge, confirm all three services are actually serving the new commit
rather than assuming it:

```bash
curl -s https://www.bzemarketplace.com/api/health          # {"status":"ok","commit":"..."}
curl -s https://www.bzemarketplace.com/api/health/ready    # database, redis, storage
curl -sI https://www.bzemarketplace.com/ | grep -i x-bmpl-commit
curl -sI https://bmpl-admin.vercel.app/  | grep -i x-bmpl-commit
```

Then delete the branch and remove the worktree.

---

## 7. Gates — require the human's explicit approval

An agent must **stop and ask**, every time, for:

- **Merging to `main`**, opening a PR for merge, or anything that deploys
- **Any production database operation**, including running a migration against
  production and any read that requires production credentials
- **Enabling, wiring or scaffolding real-money movement** — payment provider,
  card or bank rail, top-up, payout, refund-to-source, withdrawal
- **Changing, adding or rotating any secret or production environment variable**,
  including `ENABLE_SELF_SERVICE_TEST_FUNDING` and `dispatchAutomatic`
- **Any destructive operation**, anywhere: `git push --force`, history rewriting,
  deleting a remote branch, dropping or truncating data, deleting wallet or
  audit history, mass-modifying records
- **Creating production business configuration** — hubs, routes, courier lanes,
  rates, carriers, drivers
- **A repo-wide mechanical change** such as formatting or a rename
- **Spending money** or signing up for a third-party service

Michael holds these gates and asks the human directly. An agent that believes a
gate should open writes the request; it does not open it.

When blocked on the human, the task moves to `blocked` on the board with the ask
recorded on the card. Work continues on everything that does not depend on the
answer.

---

## 8. Uncertainty

If an agent does not know what a price should be, which towns are connected, how
a fee splits, what a status transition means commercially, or whether something
is permitted — it **reports that and asks**. It does not guess, and it does not
invent a business rule to make a test pass or fill a screen. See `CLAUDE.md` §12.

A plausible invention in this system becomes a real charge to a real person.

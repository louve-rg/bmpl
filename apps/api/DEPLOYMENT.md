# Deploying this service

`@bmpl/api` is deployed by Railway from `main`. The authoritative description of
the mechanism, with the evidence behind each claim, is
[`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md) — read §2a before changing
anything here. This file is the short version, kept next to the service because
the facts below are about *this* app's deploy and are easy to get wrong from the
repo root.

## What triggers a build

`railway.json`'s `build.watchPatterns` decides, and `apps/api/**` is one of them
— so **any** file under `apps/api/`, including this one, triggers a full
Dockerfile build of the service. Patterns take no leading slash.

Two consequences that have both bitten us:

- A commit touching only `apps/web/**` or `apps/admin/**` matches nothing here
  and creates **no API deployment at all**. Main moving forward does not mean the
  API moved forward.
- The watch patterns that matter are the ones configured in the Railway
  **dashboard**, not the ones in this file. The webhook fires before the repo is
  cloned, so `railway.json` has not been read when the decision to build is
  made. Keep the two in step; treat the dashboard as authoritative.

A skipped deployment records `builder: RAILPACK`; a real one records
`DOCKERFILE`.

## Never merge while a deployment is in flight

A later push to `main` marks an in-flight production deployment `inactive`
**without replacing it** — even when that later push matches no watch pattern
and so creates no deployment of its own. The API then keeps serving the
*previous* commit, with nothing in flight to fix it.

This has happened twice:

- `6c1ea8f` (#405) was killed 28 seconds after a web-only push. The API served
  the superseded commit's predecessor for roughly 15 hours.
- `a76fe3ad` (#636) was killed 62 seconds in by an `apps/admin`-only merge
  (#637) 75 seconds after it started. A real Docker build here takes 11–16
  minutes, so a deployment that reaches a terminal state in about a minute was
  cancelled, not built.

**Rule: before merging anything to `main`, check that no production deployment
is `in_progress`.** Read the deployment statuses, not a green check:

```
gh api "repos/louve-rg/bmpl/deployments?per_page=5" \
  -q '.[] | "\(.id) \(.sha[0:8]) \(.environment)"'
gh api repos/louve-rg/bmpl/deployments/<id>/statuses \
  -q '.[] | "\(.created_at) \(.state)"'
```

The same rule is stated at the top of `.github/workflows/ci.yml`, with the full
evidence trail.

## Recovering a stranded deployment

A **check-suite rerun does not help** — rerunning a cancelled suite comes back
green and produces no new deployment attempt, because the commit is no longer
`main`'s tip. Only two things move the service:

1. **Deploy commit** on the skipped deployment in the Railway dashboard.
2. The **next commit that matches a watch pattern** reaching `main`.

## Checking what is actually deployed

`/api/health` reports the commit baked into the running build — not inferred
from git, not from a provider status page:

```
curl -s https://bmplapi-production.up.railway.app/api/health
{"status":"ok","uptime":…,"commit":"0f67b6f","startedAt":"…"}
```

`node scripts/deploy-status.mjs` reads that endpoint and compares it against
`origin/main`, labelling each undelivered commit `[api]` (it matches a watch
pattern and should have deployed) or `[unwatched]` (it never could). Trust the
measured line; a provider deployment record is not a build.

## One thing to know before triggering a deploy

`railway.json`'s `deploy.preDeployCommand` runs `prisma migrate deploy` against
the production database on **every** deployment. Before deliberately triggering
a build, confirm whether the range adds migrations:

```
git diff --name-only <deployed-commit> origin/main -- '*migrations*'
```

Empty output means the pre-deploy step is a no-op. Non-empty means the deploy
will apply schema changes to production — know which ones first.

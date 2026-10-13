# Release record

One row per release. Every cell is a verified fact or the word `PENDING`.
`MERGED` is not `DEPLOYED` is not `PRODUCTION-VERIFIED` is not `ACCEPTED BY
EDWARD` — these are kept as separate columns deliberately. **Deploy scope**
is what the deploy's watched-path filter actually rebuilt, measured
per-commit against that filter — never assumed to be the full commit range
since the previous release, which can include commits outside any watched
path.

| PR | Ticket | Reviewed head | CI (4 required checks) | Merge commit | Deploy scope | API deployed | Web deployed | Admin deployed | Post-deploy regression check | Production-verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [#382](https://github.com/louve-rg/bmpl/pull/382) | MDF-218 | `82fc3af` | green (CI run [38340245762](https://github.com/louve-rg/bmpl/actions/runs/38340245762), SUCCESS on `94147b0`) | `94147b0` | **#382 alone.** The commit range since the previous release (`4dcc279..94147b0`) holds 9 commits; only `94147b0` (#382) touches an `apps/api`/`packages/*` path watched by `railway.json`. The other 8 are `apps/web`-only or docs-only, measured per-commit (`git show --stat`, not a pathspec filter) — already live via Vercel or docs-only, not part of what this API deploy shipped. Previous production commit `4dcc279` live since 2026-10-12T04:53:35Z; zero migration files in the range (`preDeployCommand` applied none). | YES — `94147b0`, deploy started 2026-10-13T03:18:50Z, `GET /api/health` → `{"status":"ok","commit":"94147b0"}` (confirmed live) | PENDING | PENDING | PENDING | **NOT YET** — the concurrency-race fix is CI-verified (automated test, full suite) and locally verified (adversarial review), but not exercised in production: doing so would require mutating real customer data. A local walk of the legitimate assign/reassign paths at this commit (Jim) will fill the regression-check cell above, not this one, when it lands. |

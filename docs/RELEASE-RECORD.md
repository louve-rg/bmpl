# Release record

One row per release. Every cell is a verified fact or the word `PENDING`.
`MERGED` is not `DEPLOYED` is not `PRODUCTION-VERIFIED` is not `ACCEPTED BY
EDWARD` — these are kept as separate columns deliberately. **Deploy scope**
is the full commit range actually shipped by this deploy, not just the named
PR — a deploy can carry hours of accumulated `main`.

| PR | Ticket | Reviewed head | CI (4 required checks) | Merge commit | Deploy scope | API deployed | Web deployed | Admin deployed | Post-deploy regression check | Production-verified |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [#382](https://github.com/louve-rg/bmpl/pull/382) | MDF-218 | `82fc3af` | green (CI run [38340245762](https://github.com/louve-rg/bmpl/actions/runs/38340245762), SUCCESS on `94147b0`) | `94147b0` | `4dcc279..94147b0` — full range shipped; previous production commit `4dcc279` live since 2026-10-12T04:53:35Z; zero migration files in this range (`preDeployCommand` applied none); runtime-affecting delta list PENDING (Dwight enumerating) | YES — `94147b0`, deploy started 2026-10-13T03:18:50Z, `GET /api/health` → `{"status":"ok","commit":"94147b0"}` (confirmed live) | PENDING | PENDING | PENDING | **NOT YET** — the concurrency-race fix is CI-verified (automated test, full suite) and locally verified (adversarial review), but not exercised in production: doing so would require mutating real customer data. A local walk of the legitimate assign/reassign paths at this commit (Jim) will fill the regression-check cell above, not this one, when it lands. |

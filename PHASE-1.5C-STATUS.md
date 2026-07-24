# Phase 1.5C — Development Cloud Deployment: STATUS

**Outcome: deployment BLOCKED on external credentials — nothing was deployed.**
The automation environment has **no** GitHub remote, **no** provider CLIs
(`gh`/`railway`/`vercel`/`wrangler`/`eas`/`docker` all absent), and **no**
provider tokens. Per the operating rule, no credentials were invented and no
deployment or provider-dependent test is reported as successful. Everything that
can be verified without cloud credentials **was executed and passed**; the exact
operator actions to finish are in
[`docs/OPERATOR-DEPLOYMENT-CHECKLIST.md`](./docs/OPERATOR-DEPLOYMENT-CHECKLIST.md).

## Executed locally (real runs)

| Check | Result |
|---|---|
| Repo state | `main` @ `5665a90`, clean tree, no `.env`/secrets/data/artifacts tracked, 3 phase commits present, 229 files |
| Config validity | railway.json, vercel.json ×2, eas.json, app.json parse; **ci.yml YAML parses**; Dockerfile COPY sources all exist; all CI-referenced scripts exist |
| Production secret guard | Refuses boot on dev-placeholder secrets in production; accepts strong secrets ✅ |
| Production-mode boot (local infra, `PORT=4055`) | Boots; `PORT`/`0.0.0.0` bind; health ok; **readiness db+redis+storage all true**; JSON logs; **no secrets in logs** ✅ |
| Dev outbox in production | `/api/dev/emails/latest` → **404**, DevModule never loaded ✅ |
| Storage smoke (app `StorageService`, MinIO) | **9/9**: upload · real HEAD metadata · namespace guard · signed-200 · unsigned-403 · **expiry-403** · cleanup ✅ |
| Unit tests | **15** (wallet 7, authorization 5, api 3) ✅ |
| Integration tests (real PG+MinIO+Redis) | **42** (auth 9, workflows 26, csrf 5, ratelimit 1, seed 1) ✅ |
| Builds | 8 packages, API (`dist/main.js`), web (12 routes), admin (9 routes), mobile typecheck ✅ |

The integration suite already exercises, against real infrastructure, the same
workflows the phase asks to verify in cloud: auth (register/verify/login/refresh
rotation+reuse/logout/reset), role application + R2-path storage, admin approval,
role switching + suspension, the authorization/abuse matrix, **CSRF** (valid
token 200, altered/missing 403, disallowed origin 403, mobile Bearer exempt), and
**Redis-backed rate limiting** (429 after limit).

## Pending — requires operator credentials/DNS (not executed)

GitHub push · CI-in-GitHub · Railway project/API/Postgres/Redis · cloud
`migrate:deploy` · R2 buckets/token + R2 smoke · cloud env population · cloud
admin bootstrap · Resend email · Sentry · Vercel web+admin · DNS · browser
cookie/CSRF gate · Expo EAS build. See the operator checklist for exact commands.

## Monthly development infrastructure cost estimate

Indicative; provider plans/usage vary. Dev-scale, low traffic.

| Service | Plan | Est. / mo |
|---|---|---|
| Railway (API + Postgres + Redis) | Hobby ($5) + usage | ~$15–25 |
| Vercel (web + admin) | Hobby (free) personal, or Pro if commercial | $0–20 |
| Cloudflare R2 | Free tier (10 GB + ops) | ~$0 |
| Resend | Free tier (3k emails/mo) | $0 |
| Sentry | Developer (free) | $0 |
| Expo EAS | Free build credits (dev builds) | $0 (Production plan $99 not needed) |
| **Total (dev)** | | **≈ $15–45 / month** |

## Recommendation

**NO-GO for Phase 1.5D (cloud stabilization)** — you cannot stabilize what is not
yet deployed. The blocker is solely the absence of cloud credentials/accounts/DNS
in this environment, **not** the readiness of the software: the deployable
artifact is fully prepared, config-validated, and passes 57 local tests plus a
production-mode boot and an S3 storage smoke. **This becomes GO the moment the
operator completes the credentialed steps** in the checklist and the cloud
health/readiness + browser gate pass.

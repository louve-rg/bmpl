# Email configuration — transition checklist (PR #389)

PR #389 (`7a253b9`, MDF-24, currently on hold) corrects `.env.example`'s email
block. **It does not change any email-transport code.** The actual code
variable names (`EMAIL_PROVIDER`, `RESEND_API_KEY`, `SMTP_URL`) have existed
in `apps/api/src/config/env.ts` since commit `5665a90` ("Phase 1.5B", 2026-07-23)
— `.env.example` was simply wrong/stale for the ~3 months since, documenting
names (`EMAIL_TRANSPORT`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASSWORD`) that **never existed in code at any point** (confirmed via
`git log -S` on `apps/api/src/config/env.ts`). `.env.example` is a template
file only — `ConfigModule` loads env from `process.env` via `loadEnv()`
(`apps/api/src/config/config.module.ts`), never from this file — so this
correction has zero runtime effect by itself.

The real risk this document exists for is independent of merging #389: it is
whether Railway's **actual** production variables were ever set under the
real names. If they were set under the never-real `.env.example` names
instead, `EMAIL_PROVIDER` is simply absent in Railway and the schema's
`z.enum([...]).default('console')` (`apps/api/src/config/env.ts:101`) silently
applies — no crash, no error log, verification/reset email stop reaching
anyone.

## 1. OLD NAME → NEW NAME

| Old (`.env.example` pre-#389 — never read by code) | New (actual code variable, unchanged by #389) |
| --- | --- |
| `EMAIL_TRANSPORT` | `EMAIL_PROVIDER` |
| `SMTP_HOST` | `SMTP_URL` (merged — see §2) |
| `SMTP_PORT` | `SMTP_URL` (merged) |
| `SMTP_USER` | `SMTP_URL` (merged) |
| `SMTP_PASSWORD` | `SMTP_URL` (merged) |
| *(none — new)* | `RESEND_API_KEY` *(new variable, no old-name equivalent)* |
| *(none — new)* | `EMAIL_NOTICE_ADDRESS_LIMIT` *(new, MDF-24 — unrelated to transport; per-address rate limit on reset/verification-resend requests)* |

`EMAIL_FROM` is unchanged (same name before and after #389).

## 2. Required value or format (shape only — never a real value)

| Variable | Shape |
| --- | --- |
| `EMAIL_PROVIDER` | One of exactly three strings: `console`, `resend`, `smtp`. Defaults to `console` if absent or unrecognized. |
| `RESEND_API_KEY` | A Resend API key. Required only when `EMAIL_PROVIDER=resend`; optional otherwise. By Resend's own published format this is a string prefixed `re_` — this repo's schema does not itself validate the prefix or length. |
| `SMTP_URL` | A single connection-string URL, e.g. shape `smtp://user:password@host:port`. **Not currently wired to any transport** — see the flag below. |
| `EMAIL_FROM` | A display-name + address string, e.g. `"Name <local@domain>"`. Has a committed, non-secret default already in `.env.example`; not a secret itself. |
| `EMAIL_NOTICE_ADDRESS_LIMIT` | A positive integer (default `5`). Not transport-related — a per-address ceiling on reset/verification-resend requests within one `THROTTLE_TTL_SECONDS` window. |

**Flag, not optional**: reading `apps/api/src/email/email.service.ts`, the
`smtp` case is a stub — it only logs `SMTP transport is not implemented;
email not sent.` and returns `false`. Setting `EMAIL_PROVIDER=smtp` (with or
without `SMTP_URL`) sends **nothing**, today, regardless of `SMTP_URL`'s
value. Only `EMAIL_PROVIDER=resend` (with a valid `RESEND_API_KEY`) sends a
real email right now.

## 3. Verification procedure — telling real sending from console logging

No step below requires reading a production environment variable's value or
sending a test email; where a live-send check is unavoidable, it is marked as
the owner's own action, matching how this was verified before (§ below).

1. **Weak, safe, log-only signal (anyone, any time, no action taken)**: watch
   Railway's API service logs for the two labelled lines
   `apps/api/src/email/email.service.ts` emits:
   - `[email:console] to=... subject="..."` — **proof positive the API is
     still on `console`** (no real send happened for that request), regardless
     of what `.env.example` says.
   - `EMAIL_PROVIDER=resend but RESEND_API_KEY is missing; email not sent.` or
     `Resend send failed: HTTP ...` — proof `resend` is selected but
     misconfigured or failing.
   - **Important gap**: a successful Resend send logs **nothing at all** (the
     code path is `return true;` with no log call). So the *absence* of both
     lines after a deploy is necessary but **not sufficient** evidence of real
     sending — it is equally consistent with no verification/reset request
     having happened yet since the restart. Do not report "no console lines
     seen" as proof email works.
   - This also means: do not wait for a customer's own real registration/reset
     to produce one of these log lines before treating the deploy as
     accepted — if no customer action happens to touch this path in the
     observation window, this check alone will stay silent either way.
2. **The only method that gives certainty**: the owner (not this agent) signs
   in on an account she controls and requests a verification resend or
   password reset through the live site, then confirms whether the email
   physically arrives. This is exactly how production email was confirmed
   working before, per `docs/PROJECT_STATUS.md` (BMPL-73, 2026-09-07: "the
   owner ... tested the resend-verification flow end to end — the message was
   delivered and the link verified the account"). This document recommends
   repeating that same owner-run check after any deploy that touches this
   area, rather than introducing a new method.
3. If the owner wants a presence-only config check beforehand (not a value,
   just whether the variable exists): she can look at Railway's own Variables
   tab for `EMAIL_PROVIDER` / `RESEND_API_KEY` under the API service — her own
   dashboard access, not something this document or this agent reads or
   transcribes.

## 4. Rollback — in order

Because #389 does not touch `EMAIL_PROVIDER`/`RESEND_API_KEY`/`SMTP_URL`
handling at all (only `.env.example` text and the unrelated MDF-24
rate-limit/honest-email logic in `auth.service.ts`), a regression in actual
email delivery after this deploy is much more likely to be a **pre-existing
or coincidental Railway configuration state**, not something #389 introduced.
Diagnose before reverting:

1. **Confirm it's config, not code**: per §3.3, the owner checks whether
   `EMAIL_PROVIDER` and `RESEND_API_KEY` are present and set to the intended
   values in Railway's Variables tab for the API service.
2. **If a variable is missing or wrong**: set it correctly in Railway
   (`EMAIL_PROVIDER=resend`, a valid `RESEND_API_KEY`) and redeploy/restart —
   this is a configuration fix, not a code rollback, and does not require
   touching #389 or its branch.
3. **If the configuration is confirmed correct and email still fails**:
   Resend's own API may be rejecting the request — `Resend send failed: HTTP
   ...` in the service log carries Resend's own explanation (most often an
   unverified sending domain). That is a Resend-account-side issue to resolve
   with Resend, not a code or deploy rollback.
4. **Only if the deployed code itself is suspected** (e.g., a regression in
   `auth.service.ts`'s new honest-email-outcome handling, not the transport):
   roll back via Railway to the previously running commit (redeploy the prior
   image) rather than editing `EMAIL_PROVIDER` — do not "fix" a code
   regression by switching to `EMAIL_PROVIDER=console`, since `console`
   reports success while sending nothing and would hide the problem, not fix
   it.
5. **Re-verify** using §3.2 (the owner's own real end-to-end check) before
   declaring the rollback or fix complete — a log check alone is not
   sufficient per §3.1's stated gap.

---

## Answer to the standing question: is production email currently operational?

**Cannot be independently confirmed from here, and that is a different answer
from "no data exists."** One real, dated, specific data point exists:
`docs/PROJECT_STATUS.md` records that production email was broken (silently
defaulting to `console`) until the owner fixed it on **2026-09-07 (BMPL-73)** —
corrected the Railway configuration, rotated the Resend API key, redeployed,
and verified a real resend-verification flow end to end on production, with
the message delivered and the link working. No commit since then touches
`apps/api/src/email/` or the `EMAIL_PROVIDER`/`RESEND_API_KEY` handling in
`apps/api/src/config/env.ts` (checked via `git log` on both paths) — #389
itself does not touch that logic either.

That record is **36 days old** as of today (2026-10-13) and this task's
boundaries forbid the two ways to re-confirm it directly: reading production
environment variables, or sending any test email. So: **last documented
state is working (2026-09-07, BMPL-73)**; **current state is not verified by
me today** — I have no way, within these boundaries, to rule out an
undocumented Railway configuration change in the 36 days since. Do not read
this as "probably still fine" or as "unknown" — it is a specific, dated,
positive record with a specific unconfirmed gap.

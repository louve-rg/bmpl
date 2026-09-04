# Security — how each rule is enforced

| # | Rule | Where / how it is enforced |
|---|------|----------------------------|
| 1 | Authorization enforced on the backend | NestJS global guards (`JwtAuthGuard` → `RolesGuard` → `PermissionsGuard`) run on every non-`@Public` route; subject state is loaded **fresh from the DB per request** in `AuthContextService`. |
| 2 | Hiding buttons is not authorization | The web/admin UIs hide controls for UX, but the API independently rejects unauthorized calls (e.g. `switchRole` refuses non-approved roles; admin routes require an explicit `AdminPermission`). |
| 3 | Users never approve their own roles | `AdminService.loadDecidableApplication` and `changeRoleStatus` call `isSelfAction(actor, target)` and throw `Forbidden` when actor == target. Covered by the e2e test. |
| 4 | Admin permissions separate from customer roles | Admin capability lives on `AdminPermissionGrant` (permission strings), a different table/axis from `UserRole`. Customer roles grant none of them. |
| 5 | Uploaded documents not publicly accessible | Documents are stored as opaque object keys in an **auto-created private** bucket; no public URL is ever stored or returned. Verified in integration tests: an unsigned GET to the object returns `403`. |
| 6 | Sensitive files use signed URLs | `StorageService.presignDownload` mints short-lived (default 300s, `X-Amz-Expires=300`) signed GET URLs, minted per-click in the admin document viewer. |
| 5a | Upload validation (server-side) | Uploads are constrained by a **MIME allow-list** + size limit at presign, and — critically — the stored object's **real** content type/size are read back via `HEAD` before metadata is persisted (client-declared values are never trusted). Keys are **namespace-scoped** to the owner, so a user cannot attach another user's object. |
| 7 | Passwords hashed securely | `@bmpl/authentication` uses **argon2id** (memory-hard) with tuned parameters; `needsRehash` supports parameter upgrades. |
| 8 | Sessions revocable | Server-side `Session` rows; refresh tokens are hashed and **rotated on use**. Logout/reset/suspend set `revokedAt`, and `JwtAuthGuard` rejects revoked/expired sessions even with a valid JWT. |
| 9 | Server-side validation | Every mutating route validates its body with a Zod schema via `ZodValidationPipe` (schemas live in `@bmpl/validation`). |
| 10 | Migrations for DB changes | All schema changes go through `prisma migrate`; no ad-hoc DDL. |
| 11 | Privileged actions audited | `AuditService.record(...)` is called inside the same transaction as each privileged change; captures actor, action, target user/role, before/after, reason, IP, session. |
| 12 | Secrets via env vars | All secrets come from validated env (`apps/api/src/config/env.ts`); the API refuses to boot on invalid config. |
| 13 | No production secrets committed | `.env` is git-ignored; only `.env.example` with clearly-labeled dev placeholders is committed. |
| 14 | No mock authentication | Real argon2 verification, real JWT signing/verification, real DB-backed sessions. There is no bypass. |
| 15 | Features not "done" until the full workflow is tested | `apps/api/test/workflows.integration.spec.ts` exercises register → apply → admin-approve → switch, and asserts the audit trail. Unit tests cover the ledger invariants, authorization logic, and validation pipe. |

## Additional hardening in place
- `helmet` security headers and a strict CORS allow-list on the API.
- Account-enumeration resistance on register / forgot-password / resend-verification (uniform responses; constant-ish work on login).
- `SameSite=Strict` cookies; the refresh cookie is path-scoped to `/auth`.
- BigInt wallet amounts serialize safely; money is stored in integer minor units.

## Phase 1.5A verification (local integration)
- All 12 rules above were exercised end-to-end against **real** PostgreSQL + MinIO
  + Redis by the integration suite (`pnpm --filter @bmpl/api test:integration`,
  36 tests) — including self-approval rejection, permission denial, session
  revocation on logout/suspension, refresh-token rotation + reuse rejection,
  private-document access control, MIME/size/namespace upload rejection, and the
  CORS allow-list. (That suite is now **691 tests across 55 spec files**; the
  original 36-test verification report is archived at
  `docs/history/PHASE-1.5A-VERIFICATION.md`.)
- Readiness (`/api/health/ready`) proves the API is bound to real infrastructure
  and is not falling back to mocks or in-memory storage.

## Since delivered — do not re-implement these

The three items previously listed here as missing have all shipped. They are
recorded so nobody builds a second one:

- **Rate limiting** — Redis-backed distributed throttling (`@nestjs/throttler` +
  `@nest-lab/throttler-storage-redis`), with strict per-IP limits on auth,
  upload, signed-URL and wallet-funding routes via `@StrictThrottle()`.
  Tested: `apps/api/test/ratelimit.integration.spec.ts`.
- **CSRF** — Origin allow-list plus a double-submit token on browser cookie
  mutations; mobile `Bearer` requests are exempt by design.
  Tested: `apps/api/test/csrf.integration.spec.ts`.
- **Email transport** — an `EmailService` abstraction with a `console` dev
  transport (dev-only outbox) and a real `resend` transport. Failures are logged
  and never falsely reported as sent.

## Current known limitations

- **Refresh-token reuse is rejected** (rotation invalidates the old token), but
  **session-family revocation on detected reuse** is still future hardening.
- **`smtp` is a placeholder, not a transport** (`apps/api/src/email/email.service.ts`)
  despite `SMTP_*` variables appearing in `.env.example`. Use `resend`.
- **No nonce-based CSP** on web/admin — baseline security headers only.
- **No antivirus / content scanning** on uploads, and no object
  deletion/retention lifecycle on R2.
- **No ESLint configuration exists in this repository**, so `pnpm lint` cannot
  pass and CI treats it as informational. Whole classes of defect are unguarded
  by static analysis.
- **`ENABLE_SELF_SERVICE_TEST_FUNDING` is currently ON in production** for UAT.
  It is capped, ledger-backed, `isTest`-marked and has no withdrawal path, but
  it **must be switched off before commercial launch**. See
  [`docs/PROJECT_STATUS.md`](./docs/PROJECT_STATUS.md) §4.

Historical Phase-1 context is archived in
[`docs/history/`](./docs/history/README.md) — it is not current.

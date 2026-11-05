# Running admin's browser-driven tests locally (read before chasing a connection/CORS error)

Found during MDF-556's comprehensive gate, 2026-11-05, on a worktree that was otherwise clean and fully migrated/seeded. Both symptoms below look like product bugs on first read. They are not — they're drift between root `.env` and whatever port your own worktree's API and admin dev servers actually came up on. Check these two before filing anything.

## 1. `ADMIN_PUBLIC_API_URL` in root `.env` can be stale

**Symptom:** every API call in a spec fails with `connect ECONNREFUSED ::1:<port>` / `127.0.0.1:<port>`, even though the API is clearly running (health check succeeds on its real port).

**Cause:** root `.env`'s `ADMIN_PUBLIC_API_URL` is a fixed value (observed pointing at `:4000`), not derived from `API_PORT` (observed `:4010`). Nothing guarantees the two stay in sync, and nothing listens on the stale port. `apps/admin/playwright.config.ts`'s own header comment already says to override this — it's worth repeating here because the resulting error (`ECONNREFUSED`) reads exactly like the API is down, not like an env mismatch.

**Fix (local override only, never edit `.env` for this):**
```
ADMIN_PUBLIC_API_URL=http://localhost:4010 pnpm --filter @bmpl/admin test:e2e e2e/<spec>.spec.ts
```
Check `API_PORT` in root `.env` (or the API's own startup log line, `Bootstrap] BML API listening on :<port>`) rather than assuming `:4010`.

## 2. `CORS_ORIGINS` in root `.env` may not list your worktree's admin dev port

**Symptom:** a *browser-driven* action that calls the API (e.g. clicking a button that does `api.post(...)` client-side) fails with a 403 whose body is `"Request origin is not allowed."` — but the same call made directly through an `APIRequestContext` (no browser) succeeds. Direct `fetch()`/API-context calls never hit this at all: a request with no `Origin` header is treated as a non-browser client and skips the check (`apps/api/src/auth/csrf.guard.ts`) — so this gotcha only shows up once a test clicks something in the real page, not when it only uses API contexts.

**Cause:** `apps/admin`'s dev server picks its own port per worktree (observed `:3178` on this one); `CORS_ORIGINS` in root `.env` is a fixed, manually-maintained list (`env.ts`'s `corsOrigins()`) that may not include it.

**Fix (local override only):** restart the API dev server with the worktree's admin port appended:
```
CORS_ORIGINS="$CORS_ORIGINS,http://localhost:3178" pnpm --filter @bmpl/api dev
```
**This must be a restart, not just a new shell export** — `CORS_ORIGINS` is read once at Nest boot (`env.ts`), not per-request, so a server already running won't pick up the change. On Windows, killing only the `dist/main` leaf process isn't enough either: `nest start --watch`'s watcher respawns a new leaf on the next file-system event, so kill from the root `pnpm dev` process (or its task) and confirm the port is actually free before restarting.

Find your own admin dev port either from the Playwright run's own browser URL in a trace, or from `apps/admin`'s dev server startup log.

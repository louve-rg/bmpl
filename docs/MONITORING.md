# Monitoring & Logging

No DSNs are committed. Every integration is a **no-op without credentials**, so
local/dev/CI never send data unless explicitly configured.

## Structured logging (API)

- Set `LOG_FORMAT=json` in cloud (default in production). Each HTTP request emits
  one JSON line: `time, level, msg, service, env, version, requestId, method,
  route, status, durationMs, userId?, role?`.
- **Correlation:** every request gets an `x-request-id` (honored from a trusted
  proxy, else generated) echoed on the response and included in logs.
- **Never logged:** passwords, access/refresh tokens, verification/reset tokens,
  full signed document URLs, storage secrets, DB credentials, cookies, auth headers.
- **Retention:** Railway retains recent logs; for longer retention forward stdout
  to a log sink (e.g. a drain/provider). Treat logs as sensitive (they contain
  user ids); restrict access.

## Sentry — API (already wired)

- Add `@sentry/node` env: `SENTRY_DSN`, `SENTRY_ENVIRONMENT`,
  `SENTRY_TRACES_SAMPLE_RATE`. Without `SENTRY_DSN`, `initSentry()` returns
  immediately and nothing is captured.
- `beforeSend`/`beforeBreadcrumb` scrub cookies, `authorization`/`x-csrf-token`
  headers, query-string tokens/signatures, and any `password|token|secret|
  authorization|cookie|signature|x-amz` fields. `sendDefaultPii: false`.
- **Release:** `bmpl-api@${APP_VERSION}` — set `APP_VERSION` per deploy for source
  correlation. Upload source maps from CI/Railway build as a follow-up.

## Sentry — Web / Admin (deploy-time)

The apps ship a dependency-free `reportError()` shim + `app/global-error.tsx`
boundary. At deploy time:
1. `pnpm --filter @bmpl/web add @sentry/nextjs` (and admin).
2. Run `npx @sentry/wizard@latest -i nextjs` in each app, or add
   `sentry.client.config.ts` / `sentry.server.config.ts` + wrap `next.config` with
   `withSentryConfig`.
3. Set `NEXT_PUBLIC_SENTRY_DSN` (public by design) in Vercel. The SDK exposes
   `window.Sentry`, which the existing `reportError()` shim then uses.
4. Configure `beforeSend` to scrub cookies + auth headers; disable in dev.

## Sentry — Mobile (deploy-time)

1. `pnpm --filter @bmpl/mobile add @sentry/react-native` (+ Expo config plugin).
2. Init with `EXPO_PUBLIC_SENTRY_DSN` (already read by `app.config.ts` into
   `extra.sentryDsn`). Enable only in preview/production build profiles.
3. Scrub tokens; never attach secure-store contents to events.

## Error boundaries

- Web/Admin: `app/global-error.tsx` (root) — reports via `reportError()` and
  shows a safe fallback. Add per-segment `error.tsx` boundaries as screens grow.
- Mobile: wrap the navigation root with an error boundary when Sentry RN is added.

/**
 * Error-reporting shim. Kept dependency-free so the app builds without a
 * monitoring provider. At deploy time, install `@sentry/nextjs` and initialize
 * it (see docs/MONITORING.md); this helper forwards to `window.Sentry` when
 * present. No DSN is committed. Never pass tokens/cookies into `extra`.
 */
type SentryGlobal = { captureException?: (e: unknown) => void };

export function reportError(error: unknown): void {
  if (typeof window !== 'undefined') {
    const s = (window as unknown as { Sentry?: SentryGlobal }).Sentry;
    if (s?.captureException) {
      s.captureException(error);
      return;
    }
  }
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error('[reportError]', error);
  }
}

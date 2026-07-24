/**
 * Error-reporting shim (see docs/MONITORING.md). Dependency-free; forwards to
 * `window.Sentry` when `@sentry/nextjs` is installed + initialized at deploy
 * time. No DSN committed. Never pass tokens/cookies into `extra`.
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

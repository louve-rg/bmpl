'use client';

import { useEffect } from 'react';
import { reportError } from '../lib/monitoring';

/**
 * Root error boundary (Next App Router).
 *
 * The copy deliberately does NOT claim the team has been notified: reportError
 * forwards to window.Sentry only when a provider is present, and none is
 * installed (see lib/monitoring.ts). The claim would be false on every render,
 * and worse, it discourages the one person who knows about the crash from
 * telling us. Show the digest instead, so a user report can be matched to the
 * server log. Restore the claim only once a provider is genuinely wired.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportError(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f172a',
          color: '#fff',
        }}
      >
        <div style={{ textAlign: 'center', padding: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Something went wrong</h1>
          <p style={{ marginTop: 8, color: '#93c5fd' }}>
            An unexpected error occurred. If it keeps happening, please tell us
            what you were doing — that is how we find it.
          </p>
          {error.digest ? (
            <p style={{ marginTop: 8, color: '#64748b', fontSize: 13 }}>
              Reference: <code>{error.digest}</code>
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              marginTop: 16,
              background: '#1e40af',
              color: '#fff',
              border: 0,
              borderRadius: 8,
              padding: '10px 18px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

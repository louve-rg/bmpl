'use client';

import { useEffect } from 'react';
import { reportError } from '../lib/monitoring';

/** Root error boundary (Next App Router). Reports to monitoring when configured. */
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
            An unexpected error occurred. Our team has been notified.
          </p>
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

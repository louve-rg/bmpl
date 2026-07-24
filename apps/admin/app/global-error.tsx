'use client';

import { useEffect } from 'react';
import { reportError } from '../lib/monitoring';

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
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 40 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>Admin console error</h1>
        <p style={{ marginTop: 8, color: '#475569' }}>An unexpected error occurred.</p>
        <button
          onClick={reset}
          style={{
            marginTop: 16,
            background: '#1e40af',
            color: '#fff',
            border: 0,
            borderRadius: 8,
            padding: '8px 16px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}

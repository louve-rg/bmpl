'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';
import { AuthShell, FormError, FormSuccess } from '../../components/auth/AuthShell';
import { ButtonLink } from '../../components/ui';

function Verifier() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    if (!token) {
      setState('error');
      return;
    }
    api
      .post('/auth/verify-email', { token })
      .then(() => setState('ok'))
      .catch(() => setState('error'));
  }, [token]);

  if (state === 'loading') return <p className="text-sm text-slate-500">Verifying your email…</p>;
  if (state === 'ok') {
    return (
      <div className="space-y-4">
        <FormSuccess message="Your email is verified. Thank you!" />
        <ButtonLink href="/dashboard" size="lg" className="w-full">
          Go to your dashboard
        </ButtonLink>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <FormError message="This verification link is invalid or has expired." />
      <ButtonLink href="/dashboard" variant="outline" size="lg" className="w-full">
        Continue to dashboard
      </ButtonLink>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthShell title="Email verification">
      <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
        <Verifier />
      </Suspense>
    </AuthShell>
  );
}

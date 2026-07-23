'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, type ApiError } from '../../lib/api';
import { AuthShell, Field, FormError, FormSuccess } from '../../components/auth/AuthShell';
import { Button, ButtonLink } from '../../components/ui';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      await api.post('/auth/reset-password', { token, password: form.get('password') });
      setDone(true);
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.errors?.[0]?.message ?? apiErr.message ?? 'Unable to reset password.');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return <FormError message="This reset link is missing its token." />;
  }
  if (done) {
    return (
      <div className="space-y-4">
        <FormSuccess message="Your password has been reset. You can now sign in." />
        <ButtonLink href="/login" size="lg" className="w-full">
          Go to sign in
        </ButtonLink>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FormError message={error} />
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        placeholder="At least 10 characters"
      />
      <Button type="submit" size="lg" className="w-full" disabled={loading}>
        {loading ? 'Updating…' : 'Update password'}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Choose a new password">
      <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}

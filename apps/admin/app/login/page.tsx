'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type ApiError } from '../../lib/api';
import { Alert, Button, Field, Input } from '../../components/ui';
import { Logo } from '../../components/Logo';

export default function AdminLogin() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      await api.post('/auth/login', {
        email: form.get('email'),
        password: form.get('password'),
      });
      // Confirm this account actually has admin capability before entering.
      await api.get('/admin/summary');
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      const apiErr = err as ApiError;
      setError(
        apiErr.status === 403
          ? 'This account does not have administrator access.'
          : apiErr.message ?? 'Unable to sign in.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-belize-hero p-6">
      <div className="w-full max-w-sm rounded-bmpl-xl bg-white p-8 shadow-bmpl-lg">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo size={48} />
          <h1 className="mt-3 text-lg font-bold text-belize-navy">Admin Console</h1>
          <p className="text-sm text-slate-500">Belize Marketplace &amp; Logistics</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Email" htmlFor="login-email">
            <Input id="login-email" name="email" type="email" required autoComplete="email" />
          </Field>
          <Field label="Password" htmlFor="login-password">
            <Input id="login-password" name="password" type="password" required autoComplete="current-password" />
          </Field>
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}

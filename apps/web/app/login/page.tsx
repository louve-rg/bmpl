'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, type ApiError } from '../../lib/api';
import { AuthShell, Field, FormError } from '../../components/auth/AuthShell';
import { Button } from '../../components/ui';

export default function LoginPage() {
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
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError((err as ApiError).message ?? 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your Belize Marketplace account."
      footer={
        <>
          New here?{' '}
          <Link href="/register" className="font-semibold text-belize-blue hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <FormError message={error} />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm text-belize-blue hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  );
}

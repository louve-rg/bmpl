'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type ApiError } from '../../lib/api';

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
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-belize-hero font-bold text-white">
            BM
          </div>
          <h1 className="text-lg font-bold text-belize-navy">Admin Console</h1>
          <p className="text-sm text-slate-500">Belize Marketplace &amp; Logistics</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-belize-accent focus:ring-2 focus:ring-belize-accent/30"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Password</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-belize-accent focus:ring-2 focus:ring-belize-accent/30"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-belize-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-belize-deep disabled:opacity-60"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

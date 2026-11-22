'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, type ApiError } from '../../lib/api';
import { AuthShell, Field, FormError, FormSuccess } from '../../components/auth/AuthShell';
import { Button } from '../../components/ui';

const REASON_MESSAGES: Record<string, string> = {
  // MDF-925/MDF-923: change-password revokes every session server-side,
  // including the one that made the call -- this is where that lands, so
  // the confirmation shows up HERE rather than as a toast on a dashboard
  // page whose session the server has already ended.
  'password-changed': 'Your password was changed. Please sign in again.',
  // MDF-925/MDF-924: deleteAccount revokes every session the same way.
  // Copy rule from the controller's own doc comment -- this is NOT a full
  // erasure, so the confirmation says "anonymized," never "deleted": a
  // completed order or shipment keeps its own stored recipient name and
  // address by owner ruling.
  'account-anonymized': 'Your profile has been anonymized and your past order records are retained.',
};

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Read on mount, not during render: this component also renders on the
  // server, where `window` does not exist, and SEC-LOGIN-PASSWORD-IN-URL
  // already established the pattern of reading the query string only from
  // browser-only code (window.location.search), never from render output.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reason = params.get('reason');
    setNotice((reason && REASON_MESSAGES[reason]) || null);
    // Strip ?reason= once read -- otherwise a reload (or a bookmark, or the
    // back button) re-shows "Your password was changed" to someone who did
    // not just change it. replaceState, not a router navigation: this must
    // not remount the page or touch ?next=, which a failed sign-in still
    // needs on the retry.
    if (reason) {
      params.delete('reason');
      const query = params.toString();
      window.history.replaceState(null, '', query ? `${window.location.pathname}?${query}` : window.location.pathname);
    }
  }, []);

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
      // Honor ?next= so guests bounced to login (add-to-cart, checkout) return to
      // where they were headed. Only same-origin relative paths ("/…", not "//…")
      // are allowed — this blocks open-redirect to an external host.
      const raw = new URLSearchParams(window.location.search).get('next');
      const dest = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard';
      router.push(dest);
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
      {/* SEC-LOGIN-PASSWORD-IN-URL: method="post" is load-bearing, not
          decorative. Before React hydrates, a click has no onSubmit handler
          yet, so the browser falls back to this attribute's default — omit
          it and that default is GET, putting the password in the URL,
          browser history and every access/Referer log on the path. */}
      <form onSubmit={onSubmit} method="post" className="space-y-4">
        <FormError message={error} />
        {!error && <FormSuccess message={notice} />}
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

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';
import { AuthShell, Field, FormSuccess } from '../../components/auth/AuthShell';
import { Button } from '../../components/ui';

export default function ForgotPasswordPage() {
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      await api.post('/auth/forgot-password', { email: form.get('email') });
    } finally {
      // Always show success — the API never reveals whether an email exists.
      setDone(true);
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email and we'll send you a reset link."
      footer={
        <Link href="/login" className="font-semibold text-belize-blue hover:underline">
          Back to sign in
        </Link>
      }
    >
      {done ? (
        <FormSuccess message="If an account exists for that email, a reset link is on its way." />
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Email" name="email" type="email" autoComplete="email" required />
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

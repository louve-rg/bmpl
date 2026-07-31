'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DISTRICTS, DISTRICT_LABELS } from '@bmpl/shared';
import { api, type ApiError } from '../../lib/api';
import { AuthShell, Field, FormError } from '../../components/auth/AuthShell';
import { Button } from '../../components/ui';

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      await api.post('/auth/register', {
        firstName: form.get('firstName'),
        lastName: form.get('lastName'),
        email: form.get('email'),
        password: form.get('password'),
        district: form.get('district') || undefined,
        acceptedTerms: form.get('acceptedTerms') === 'on',
      });
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.errors?.[0]?.message ?? apiErr.message ?? 'Unable to register.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Every account starts as a Customer — request provider roles anytime."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-belize-blue hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <FormError message={error} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" name="firstName" autoComplete="given-name" required />
          <Field label="Last name" name="lastName" autoComplete="family-name" required />
        </div>
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          placeholder="At least 10 characters"
        />
        <label className="block">
          <span className="bmpl-label">District (optional)</span>
          <select name="district" className="bmpl-input">
            <option value="">Select a district</option>
            {DISTRICTS.map((d) => (
              <option key={d} value={d}>
                {DISTRICT_LABELS[d]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-600">
          <input type="checkbox" name="acceptedTerms" required className="mt-1 accent-belize-blue" />
          <span>
            I agree to the{' '}
            <Link href="#" className="text-belize-blue hover:underline">
              Terms
            </Link>{' '}
            and{' '}
            <Link href="#" className="text-belize-blue hover:underline">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthShell>
  );
}

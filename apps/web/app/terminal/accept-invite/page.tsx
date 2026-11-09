'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, type ApiError } from '../../../lib/api';
import { AuthShell, Field, FormError, FormSuccess } from '../../../components/auth/AuthShell';
import { Button, ButtonLink } from '../../../components/ui';

/**
 * TERM-9. Contract read from apps/api/src/terminal/terminal.service.ts
 * (acceptInvite) and packages/validation/src/terminal.ts
 * (acceptTerminalInviteSchema) on origin/main. `password`/`firstName`/
 * `lastName` are only enforced server-side when the invited email has no
 * account yet -- this page cannot know that in advance, so it always
 * collects them; the server simply ignores them when the invitee already
 * has an account and only attaches the terminal membership. No session is
 * issued on success (deliberate -- the invitee signs in afterward through
 * the ordinary /login path), so success here means "tell them plainly, then
 * hand them to sign-in," not an automatic redirect.
 */
function AcceptInviteForm() {
  const token = useSearchParams().get('token') ?? '';
  const [error, setError] = useState<string | null>(null);
  const [createdAccount, setCreatedAccount] = useState(false);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      const result = await api.post<{ accepted: true; createdAccount: boolean }>('/terminal/invites/accept', {
        token,
        password: form.get('password'),
        firstName: form.get('firstName'),
        lastName: form.get('lastName'),
      });
      setCreatedAccount(result.createdAccount);
      setDone(true);
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.errors?.[0]?.message ?? apiErr.message ?? 'Unable to accept this invite.');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="space-y-4">
        <FormError message="This invite link is missing its token." />
        <p className="text-sm text-slate-600">Ask whoever invited you to send a new invite link.</p>
        <ButtonLink href="/login" variant="outline" size="lg" className="w-full">
          Go to sign in
        </ButtonLink>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-4">
        <FormSuccess
          message={
            createdAccount
              ? 'Your account has been created and you have been added to the team. Sign in to continue.'
              : 'You already had a BML account, so it has been added to the team as-is. Sign in with your existing password, not the one you just entered — it was not used.'
          }
        />
        <ButtonLink href="/login" size="lg" className="w-full">
          Go to sign in
        </ButtonLink>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <FormError message={error} />
        <p className="text-sm text-slate-600">
          Ask whoever invited you to send a new invite link, or sign in if you already have an account.
        </p>
        <ButtonLink href="/login" variant="outline" size="lg" className="w-full">
          Go to sign in
        </ButtonLink>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" name="firstName" autoComplete="given-name" required />
        <Field label="Last name" name="lastName" autoComplete="family-name" required />
      </div>
      <Field
        label="Choose a password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        placeholder="At least 10 characters"
      />
      <Button type="submit" size="lg" className="w-full" disabled={loading}>
        {loading ? 'Joining…' : 'Accept invite'}
      </Button>
    </form>
  );
}

export default function AcceptInvitePage() {
  return (
    <AuthShell title="Join your team on BML" subtitle="You were invited to manage a terminal company on BML.">
      <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
        <AcceptInviteForm />
      </Suspense>
    </AuthShell>
  );
}

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
 *
 * TERM-INVITE-COPY: the invited role is unknowable before accepting -- there
 * is no public preview-by-token route, by design, matching every other
 * token-gated route in this system (holding a link proves possession, never
 * identity, and a preview route would let a guessed/leaked token enumerate
 * company membership details before anyone had proven anything). So the
 * page-level subtitle below stays role-neutral; only the success message,
 * once `memberRole` comes back from a genuine accept, says "manager" or
 * "operator" specifically.
 */
function AcceptInviteForm() {
  const token = useSearchParams().get('token') ?? '';
  const [error, setError] = useState<string | null>(null);
  const [createdAccount, setCreatedAccount] = useState(false);
  const [memberRole, setMemberRole] = useState<'MANAGER' | 'OPERATOR' | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      const result = await api.post<{ accepted: true; createdAccount: boolean; memberRole?: 'MANAGER' | 'OPERATOR' }>(
        '/terminal/invites/accept',
        {
          token,
          password: form.get('password'),
          firstName: form.get('firstName'),
          lastName: form.get('lastName'),
        },
      );
      setCreatedAccount(result.createdAccount);
      // Optional: web and api deploy independently, same pattern as every
      // other additive field in this codebase (e.g. ShipmentEtaSummary).
      // Absence just means the generic wording below is used instead of the
      // role-specific one -- never a crash, never a wrong claim.
      setMemberRole(result.memberRole ?? null);
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
    // TERM-INVITE-COPY: role-correct, not role-blind -- an OPERATOR told
    // they were added "as a manager" would expect the Staff tab the server
    // then 403s them for. `memberRole` absent (an older API during a split
    // deploy) falls back to the pre-existing generic wording, never a crash
    // and never a wrong claim either way.
    const roleSuffix = memberRole === 'MANAGER' ? ' as a manager' : memberRole === 'OPERATOR' ? ' as an operator' : '';
    return (
      <div className="space-y-4">
        <FormSuccess
          message={
            createdAccount
              ? `Your account has been created and you have been added to the team${roleSuffix}. Sign in to continue.`
              : `You already had a BML account, so it has been added to the team${roleSuffix}. Sign in with your existing password, not the one you just entered — it was not used.`
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
    <AuthShell title="Join your team on BML" subtitle="You were invited to join a terminal company's team on BML.">
      <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
        <AcceptInviteForm />
      </Suspense>
    </AuthShell>
  );
}

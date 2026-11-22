'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import type { MeView } from '../../../lib/types';
import { ChangePasswordForm } from '../../../components/account/ChangePasswordForm';
import { ContactInfoForm } from '../../../components/account/ContactInfoForm';
import { DeleteAccountForm } from '../../../components/account/DeleteAccountForm';
import { Alert, PageHeader, Spinner } from '../../../components/ui';

/**
 * MDF-925: the account settings surface the owner asked for -- profile and
 * contact editing, password security, session management, and account
 * deletion. Built in the order Pam's API routes land, not the order the
 * sections are listed in.
 *
 * Live: profile/contact (PATCH /me/profile, via the shared `ContactInfoForm`,
 * same route Profile's own page uses), password security (Pam's MDF-923
 * contract, POST /auth/change-password, via `ChangePasswordForm`), and
 * account deletion (DELETE /me, MDF-924, via `DeleteAccountForm` -- landed
 * once #795 merged the route it needed).
 *
 * There is deliberately no externally-authenticated-account branch here --
 * Pam confirmed that account type does not exist in this product yet
 * (User.passwordHash is non-nullable, no provider/ssoId column, no OAuth/SSO
 * login route anywhere). Verified not applicable, not guessed from the email
 * domain and not quietly dropped.
 *
 * Session management is still NOT rendered -- the owner's rule for this card
 * is that no control ships without a server route behind it, and there is no
 * session-list/revoke endpoint yet (a Session model exists at
 * schema.prisma:726, nothing exposes it). A section with nothing real behind
 * it is left out entirely, not rendered disabled or decorative.
 */
export default function SettingsPage() {
  const [me, setMe] = useState<MeView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<MeView>('/me').then(setMe).catch(() => setError('Unable to load your account.'));
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Settings" />
        <Alert tone="error">{error}</Alert>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" />
        Loading your account…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" description="Manage your profile, contact information, and password." />

      <h2 className="mb-2 text-sm font-semibold text-[color:var(--bmpl-text-muted-strong)]">Profile &amp; contact information</h2>
      <ContactInfoForm me={me} onSaved={setMe} />

      <h2 className="mb-2 mt-6 text-sm font-semibold text-[color:var(--bmpl-text-muted-strong)]">Password &amp; security</h2>
      <ChangePasswordForm />

      <h2 className="mb-2 mt-6 text-sm font-semibold text-[color:var(--bmpl-text-muted-strong)]">Delete account</h2>
      <DeleteAccountForm />

      {/* No heading, no card, no disabled control here -- a session-list/
          revoke endpoint does not exist yet (schema.prisma:726 has the
          Session model, nothing exposes it), and the owner's rule for this
          card is that no control ships without a real server route behind
          it. This line says honestly that it's coming, rather than the
          section being silently absent with no explanation at all. */}
      <p className="mt-6 text-xs text-[color:var(--bmpl-text-muted)]">
        Active session management is coming to this page soon.
      </p>
    </div>
  );
}

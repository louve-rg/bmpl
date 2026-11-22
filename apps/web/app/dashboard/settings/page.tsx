'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import type { MeView } from '../../../lib/types';
import { ContactInfoForm } from '../../../components/account/ContactInfoForm';
import { Alert, PageHeader, Spinner } from '../../../components/ui';

/**
 * MDF-925: the account settings surface the owner asked for -- profile and
 * contact editing, password security, session management, and account
 * deletion. Built in the order Pam's API routes land, not the order the
 * sections are listed in: profile/contact already has a server route
 * (PATCH /me/profile, the same one Profile's own page uses, via the shared
 * `ContactInfoForm`) and is live here now.
 *
 * Security, session management and deletion are deliberately NOT rendered
 * yet -- the owner's rule for this card is that no control ships without a
 * server route behind it: a section with nothing real behind it is left out
 * entirely, not rendered disabled or decorative. They are added one at a
 * time as Pam's contracts arrive, each gated on its own real route the same
 * way this one is.
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
      <PageHeader title="Settings" description="Manage your profile and contact information." />

      <h2 className="mb-2 text-sm font-semibold text-[color:var(--bmpl-text-muted-strong)]">Profile &amp; contact information</h2>
      <ContactInfoForm me={me} onSaved={setMe} />

      {/* No heading, no card, no disabled control for the sections below --
          a section without a real server route behind it is left out of
          this page entirely, per the owner's rule, rather than shown dead
          or decorative. This line is the one thing that IS true right now:
          it says honestly that more is coming, same as every other
          "not yet" note added to this product tonight. */}
      <p className="mt-6 text-xs text-[color:var(--bmpl-text-muted)]">
        Password and sign-in security, active session management, and account deletion are coming to this page soon.
      </p>
    </div>
  );
}

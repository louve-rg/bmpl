'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '../../lib/api';
import { FormError } from '../auth/AuthShell';
import { Button, Card, Field, Input } from '../ui';

/**
 * MDF-925 / Pam's MDF-923 contract: POST /auth/change-password revokes
 * EVERY session for the account, including the one that made this call,
 * and clears the web auth cookies -- the person is signed out everywhere
 * and must sign in again. That consequence has to be stated before they
 * submit, not discovered when the page goes dead, so there is no "saved"
 * message rendered here -- success navigates straight to /login, which
 * shows its own confirmation, rather than leaving this now-unauthenticated
 * page up with a toast on it.
 *
 * The two 400 shapes the contract defines (a bare current-password refusal,
 * and the standard Zod {message, errors[]} shape) are already told apart by
 * `errorMessage` -- it prefers `errors[0].message` when present, falling
 * back to the bare `message` otherwise, exactly the "tell them apart by
 * shape, not status code" rule the contract states. No special-casing
 * needed here.
 */
export function ChangePasswordForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    try {
      await api.post('/auth/change-password', {
        currentPassword: form.get('currentPassword'),
        newPassword: form.get('newPassword'),
      });
      router.push('/login?reason=password-changed');
      router.refresh();
    } catch (err) {
      setError(errorMessage(err, 'Unable to change your password.'));
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-6">
      <form onSubmit={onSubmit} className="space-y-4">
        <FormError message={error} />
        <p className="text-sm text-[color:var(--bmpl-text-muted-strong)]">
          Changing your password signs you out of every device, including this one. You will need to sign in again
          afterward.
        </p>
        <Field label="Current password" htmlFor="currentPassword">
          <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
        </Field>
        <Field label="New password" htmlFor="newPassword">
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            placeholder="At least 10 characters, with a letter and a number"
          />
        </Field>
        <div className="pt-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Changing…' : 'Change password'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

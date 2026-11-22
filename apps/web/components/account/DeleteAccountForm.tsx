'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type ApiError } from '../../lib/api';
import { Alert, Button, Card, Field, Input } from '../ui';

/**
 * MDF-925/MDF-924: DELETE /me. Reauthentication (currentPassword) is
 * required by the owner directive -- the schema is `deleteAccountSchema`
 * in @bmpl/validation, enforced server-side; this form only carries the
 * one field it asks for. The server revokes every session (including this
 * one) and clears the auth cookies itself on success, so this component
 * never renders a "deleted" confirmation on a now-unauthenticated page --
 * it navigates straight to /login, same pattern as ChangePasswordForm.
 *
 * THE COPY RULE (apps/api/src/users/users.controller.ts's own doc comment
 * on deleteAccount): this is NOT a full erasure. A completed order or
 * shipment keeps its own stored recipient name and address by owner
 * ruling, and the vendor order page prints "Deleted User" beside that same
 * real name and address. Any web-facing confirmation must say "profile
 * anonymized, past order records retained," never "account deleted" -- so
 * the consequence copy below, and the post-redirect login notice, both
 * avoid that phrase on purpose.
 *
 * REFUSALS ARE RENDERED, NEVER RE-DERIVED. deleteAccount refuses with a
 * 409 and a `reasons: string[]` body -- one plain-language sentence per
 * live responsibility the account still holds (sole terminal-company
 * manager, an open vendor order, an unfinished delivery/shipment leg, the
 * only super-admin, an in-flight customer order/shipment, an open
 * passenger booking, an applicant awaiting a decision, or a wallet balance
 * / open hold). Only the server knows which of these apply right now, so
 * this form shows exactly what it sends back and does not try to guess or
 * pre-disable the button from a client-side copy of that logic. The
 * wallet-balance reason in particular states the blocking fact and stops
 * -- there is no withdrawal, sweep or forfeiture route in this product
 * (root CLAUDE.md §4/§8) for this screen to offer instead.
 *
 * A 429 (StrictThrottle, same as the other sensitive account routes) gets
 * its own copy rather than whatever raw text the throttler guard returns,
 * per the owner's instruction not to show "a generic failure" here.
 *
 * ACKNOWLEDGEMENT, NOT JUST DISCLOSURE (acceptance round 1): the owner
 * directive asks for "explicit consequence confirmation," which is a
 * different requirement from showing the consequences honestly -- a
 * browser-autofilled password turns this into a single keypress otherwise.
 * `window.confirm` is the same control the product already uses for its
 * other recoverable-but-not-trivial account action, "End membership"
 * (apps/web/app/dashboard/terminal/page.tsx's `endMember`) -- reused here
 * rather than inventing a second confirmation pattern (a checkbox) for the
 * same kind of decision.
 */
export function DeleteAccountForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[] | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!window.confirm('Delete your account? This anonymizes your profile and cannot be undone.')) return;
    setError(null);
    setReasons(null);
    setSubmitting(true);
    try {
      await api.del('/me', { currentPassword });
      router.push('/login?reason=account-anonymized');
      router.refresh();
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 429) {
        setError("You've tried this too many times. Wait a few minutes, then try again.");
      } else if (apiErr.status === 409 && apiErr.reasons && apiErr.reasons.length > 0) {
        setReasons(apiErr.reasons);
      } else {
        setError(apiErr.message || 'Unable to delete your account.');
      }
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-red-200 p-6">
      <p className="text-sm text-[color:var(--bmpl-text-muted-strong)]">
        This anonymizes your profile -- your name, contact details and saved addresses are removed and your login is
        disabled. It does <strong>not</strong> erase your history: completed orders and shipments keep their stored
        recipient name and address, by policy, and will show &ldquo;Deleted User&rdquo; in place of your account
        going forward. This cannot be undone.
      </p>
      {/*
       * Required (acceptance round 1): every sentence here is sourced to a
       * line in users.service.ts's deleteAccount/anonymizePersonalData, not
       * assumed -- a paragraph that over-promises consequences is as wrong
       * as one that hides them.
       *   - storefront suspension: deleteAccount calls VendorService.
       *     moderate(..., 'suspend', ...) on an APPROVED storefront before
       *     anonymizing anything.
       *   - driver/passenger-driver going offline: anonymizePersonalData
       *     sets DriverProfile/PassengerDriverProfile isActive:false,
       *     availability:'OFFLINE'.
       *   - identity documents and CVs removed: anonymizePersonalData
       *     orphans every RoleApplicationDocument's and JobSeekerResume's
       *     storageKey, and deleteAccount deletes the underlying objects
       *     afterward.
       *   - messages left as-is: anonymizePersonalData's own doc comment
       *     states Message.body/MessageAttachment are deliberately left
       *     alone -- a two-sided conversation is not solely this account's
       *     record to rewrite.
       */}
      <p className="mt-2 text-sm text-[color:var(--bmpl-text-muted-strong)]">
        A few other things happen immediately, without asking again: a live storefront is suspended; a driver or
        passenger-driver profile goes offline; any identity documents or CVs you uploaded are deleted; and messages
        you&rsquo;ve already sent stay visible to the people you sent them to, exactly as sent.
      </p>
      <p className="mt-2 text-sm text-[color:var(--bmpl-text-muted-strong)]">
        You will be signed out of every device immediately, including this one.
      </p>

      <form onSubmit={onSubmit} className="mt-4 space-y-4">
        {error && <Alert tone="warning">{error}</Alert>}
        {reasons && (
          <Alert tone="warning" title="Your account cannot be deleted yet.">
            <ul className="list-disc space-y-1 pl-4">
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </Alert>
        )}
        <Field label="Current password" htmlFor="deleteAccountPassword">
          <Input
            id="deleteAccountPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </Field>
        <div className="pt-2">
          <Button type="submit" variant="destructive" disabled={submitting || !currentPassword}>
            {submitting ? 'Deleting…' : 'Delete account'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

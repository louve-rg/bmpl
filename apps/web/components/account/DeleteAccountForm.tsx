'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type ApiError } from '../../lib/api';
import { Alert, Button, Card, Field, Input } from '../ui';

const TRIGGER_ID = 'deleteAccountTrigger';

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
 * THE RULE THIS SCREEN'S CONFIRMATION FOLLOWS (acceptance round 2):
 * irreversible actions get an in-page confirmation step; reversible ones
 * keep `window.confirm`. This is the only IRREVERSIBLE action in the
 * product's confirm-gated set today -- "End membership"
 * (dashboard/terminal/page.tsx's `endMember`) is undone by reactivation,
 * and revoking a session (`SessionsList`) is undone by signing back in.
 * Both stay on `window.confirm` on purpose, under this same rule, not
 * because nobody noticed window.confirm's one real gap (next paragraph) --
 * a reversible action can afford it.
 *
 * WHY NOT window.confirm HERE: a browser where the person has ticked
 * "prevent this page from creating more dialogs" makes every later
 * `window.confirm` call return `false` immediately and silently -- the
 * exact same value a declined confirmation returns -- which would turn
 * this button into a nonfunctional one with no explanation (root
 * CLAUDE.md §8: no fake success messages or nonfunctional buttons). There
 * is no reliable way to tell a suppressed dialog apart from a declined
 * one from inside the page (both resolve synchronously to `false`, with
 * nothing else to inspect), so detecting the suppression and falling back
 * to this panel only then isn't a real fix -- doing the confirmation
 * in-page removes the need for any detection at all.
 */
export function DeleteAccountForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[] | null>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const mountedRef = useRef(false);

  // Focus moves TO the panel when it opens and back to the trigger when it
  // closes (cancel, Escape, or a failed attempt resetting back to the
  // trigger) -- a native <dialog>/confirm() does both for free; a plain div
  // does neither unless told to. Skipping this would leave a keyboard user
  // with no indication anything changed, and the destructive button
  // reachable with no announcement -- strictly worse than window.confirm,
  // not just different. Keyed on `confirming` rather than called inline
  // from the click handlers: the trigger/panel don't exist in the DOM yet
  // at the moment state changes, only after React re-renders. Skips the
  // very first run so mounting this component never steals focus.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (confirming) {
      panelHeadingRef.current?.focus();
    } else {
      document.getElementById(TRIGGER_ID)?.focus();
    }
  }, [confirming]);

  function openConfirmation(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setConfirming(true);
  }

  function cancelConfirmation() {
    // Nothing else resets: the password field keeps its value, and no
    // request has been made -- cancelling loses nothing.
    setConfirming(false);
  }

  function onPanelKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelConfirmation();
    }
  }

  async function confirmDelete() {
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
      setConfirming(false);
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
        passenger-driver profile goes offline; any identity documents or CVs you uploaded are removed from your
        account; and messages you&rsquo;ve already sent stay visible to the people you sent them to, exactly as sent.
      </p>
      <p className="mt-2 text-sm text-[color:var(--bmpl-text-muted-strong)]">
        You will be signed out of every device immediately, including this one.
      </p>

      <form onSubmit={openConfirmation} className="mt-4 space-y-4">
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

        {!confirming ? (
          <div className="pt-2">
            <Button id={TRIGGER_ID} type="submit" variant="destructive" disabled={submitting || !currentPassword}>
              Delete account
            </Button>
          </div>
        ) : (
          // The ONE button that actually calls DELETE /me ("Yes, delete my
          // account") does not exist in the DOM until this panel is open --
          // not merely hidden or disabled, genuinely absent -- so it is
          // unreachable by any means until the step has happened.
          <div
            role="group"
            aria-label="Confirm account deletion"
            onKeyDown={onPanelKeyDown}
            className="rounded-lg border border-red-300 bg-red-50 p-4"
          >
            <h3 ref={panelHeadingRef} tabIndex={-1} className="text-sm font-semibold text-red-800 focus:outline-none">
              Anonymize your profile and sign out of every device?
            </h3>
            {/* Acceptance round 2's exact concern, carried into this panel's
                own text rather than only the page copy above: the one fact
                that makes this not a full erasure. */}
            <p className="mt-1 text-sm text-red-700">
              Past orders and shipments keep their recipient name and address. This cannot be undone.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Button type="button" variant="destructive" size="sm" disabled={submitting} onClick={() => void confirmDelete()}>
                {submitting ? 'Deleting…' : 'Yes, delete my account'}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={submitting} onClick={cancelConfirmation}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </form>
    </Card>
  );
}

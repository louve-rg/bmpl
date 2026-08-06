import Link from 'next/link';
import type { MeView } from '../../lib/types';

/**
 * Nudge for users in a role that requires a profile picture but doesn't have one
 * live yet.
 *
 * Deliberately a banner and not a redirect. These are drivers mid-shift, vendors
 * with orders to pack and agents with viewings booked — locking them out of the
 * dashboard over a missing photo would stop real work to fix a profile field. It
 * follows them on every dashboard page until it's resolved, which is pressure
 * enough.
 */
export function AvatarRequiredBanner({ me }: { me: MeView }) {
  if (!me.avatarRequired || me.avatarStatus === 'APPROVED' || me.avatarStatus === 'PENDING') {
    return null;
  }

  const rejected = me.avatarStatus === 'REJECTED';

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-sm text-amber-800 md:px-8">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold">
          {rejected ? 'Your profile photo wasn’t accepted.' : 'Your role requires a profile photo.'}
        </span>
        <span>
          {rejected
            ? me.avatarRejectedReason
            : 'Customers meet you in person, so they need to see who they’re dealing with.'}
        </span>
        <Link href="/dashboard/profile" className="font-semibold underline underline-offset-2">
          {rejected ? 'Try another photo' : 'Add your photo'}
        </Link>
      </div>
    </div>
  );
}

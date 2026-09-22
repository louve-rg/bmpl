import { Alert } from './ui';

/**
 * What a refused admin reads instead of wrong data — BMPL-144.
 *
 * Until #97 the layout bounced every non-users.read admin at the door, so a
 * refusal inside the console was unreachable. Now scoped admins live here,
 * and a screen they lack the grant for must SAY so: an empty table reads as
 * "no users exist" and a zeroed summary card is a wrong answer stated
 * confidently. This renders the server's own sentence when it sent one,
 * matching the Alert pattern the logistics screens already use.
 */
export function AccessNotice({ message }: { message?: string }) {
  return (
    <Alert tone="warning" className="mt-6">
      {message ?? 'You lack the required administrative permission for this screen.'}
    </Alert>
  );
}

'use client';

import { useState } from 'react';
import { resolveLegExceptionSchema, type ResolveLegExceptionInput } from '@bmpl/validation';
import { api, type ApiError } from '../../lib/api';
import { Alert, Button, Textarea } from '../ui';

/**
 * Requirement 10's actual gap: resuming an exceptional leg where it stands, or
 * releasing an assigned driver back to the pool, without a return or reroute.
 * Deliberately a different panel from `ExceptionResolution` (which only covers
 * RETURN/REROUTE) — its name is a coincidence an earlier audit flagged
 * precisely because the two sound alike but call none of the same endpoints.
 *
 * Both resolutions share one endpoint, `POST legs/:id/resolve-exception`,
 * gated `logistics.operate` — the same permission that mounts this panel's
 * only trigger (the EXCEPTION branch in the parent page), so there is no
 * second permission check in here, same convention as `LegAssignModal`.
 *
 * Every refusal (already resolved by someone else, a settled return/reroute,
 * a collected parcel, a line-haul leg with no driver to release, …) is the
 * server's own sentence, surfaced verbatim — this panel does not pre-empt any
 * of them with a guess, it just lets the operator try and reads back why not.
 */

type Resolution = ResolveLegExceptionInput['resolution'];

export function ExceptionRecovery({
  legId,
  legKind,
  onResolved,
}: {
  legId: string;
  /** A transport leg is worked by a carrier, not a driver — the server refuses RELEASE_DRIVER for one by name; hiding the trigger here is the cleaner UI, not a second copy of that rule. */
  legKind: 'FIRST_MILE' | 'LINE_HAUL' | 'LAST_MILE';
  onResolved: () => Promise<void>;
}) {
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<Resolution | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setResolution(null);
    setNote('');
    setErr(null);
  }

  const check = resolution ? resolveLegExceptionSchema.safeParse({ resolution, note: note.trim() }) : null;

  async function submit() {
    if (!resolution || !check?.success) {
      setErr(check && !check.success ? check.error.issues[0]?.message ?? 'Say how it was resolved.' : null);
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await api.post(`/admin/logistics/legs/${legId}/resolve-exception`, check.data);
      setDone(resolution);
      await onResolved();
    } catch (e) {
      setErr((e as ApiError).message ?? 'That action was refused.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <Alert tone="success" title={done === 'RESUME' ? 'Leg resumed' : 'Driver released'}>
        {done === 'RESUME'
          ? 'The leg continues where it stood.'
          : 'The driver was released and the leg is back in the dispatch pool.'}
      </Alert>
    );
  }

  if (resolution === null) {
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setResolution('RESUME')}>
          Resume
        </Button>
        {legKind !== 'LINE_HAUL' && (
          <Button variant="outline" size="sm" onClick={() => setResolution('RELEASE_DRIVER')}>
            Release driver
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="bmpl-panel mt-3 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[color:var(--bmpl-text)]">
          {resolution === 'RESUME' ? 'Resume this leg' : 'Release the assigned driver'}
        </h3>
        <button type="button" onClick={reset} className="text-xs font-medium text-[color:var(--bmpl-text-muted)] hover:underline">
          Cancel
        </button>
      </div>

      <p className="mt-1 text-xs text-[color:var(--bmpl-text-muted)]">
        {resolution === 'RESUME'
          ? 'The leg continues from where it stood. If the exception was a PIN lockout, the attempt counter is cleared.'
          : 'Only possible while the parcel has not yet been collected — the leg goes back to the dispatch pool.'}
      </p>

      <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-[color:var(--bmpl-text-muted)]" htmlFor={`recovery-note-${legId}`}>
        Note
      </label>
      <Textarea
        id={`recovery-note-${legId}`}
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What was done to resolve this?"
        className="mt-1"
      />

      {err && <p className="mt-2 text-sm font-medium text-red-600">{err}</p>}

      <Button size="sm" className="mt-3" onClick={() => void submit()} disabled={submitting || !check?.success}>
        {submitting ? 'Submitting…' : resolution === 'RESUME' ? 'Resume leg' : 'Release driver'}
      </Button>
    </div>
  );
}

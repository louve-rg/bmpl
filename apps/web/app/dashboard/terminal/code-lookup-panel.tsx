/**
 * EDW-P2 (requirement 1/2, code-led handoff): DRAFT, NOT WIRED IN YET.
 *
 * Nothing imports this file. Pam's lookup endpoint does not exist yet, so
 * there is nothing for this to call -- god's explicit instruction
 * (2026-11-26T19-45-39-781Z-ceb724) was to draft the copy and the candidate
 * card now, ahead of the endpoint, because the field set and wording below
 * are already settled policy, not something Pam's answer can change:
 *
 *   - Q1 (binding): `broughtBy`/`courier` are EXCLUDED from a candidate --
 *     a person's name has no disambiguation value and discloses who is
 *     expected at a terminal to anyone fishing with a guessed code.
 *     `reference` IS included -- Edward's own requirement to disambiguate
 *     by shipment reference is what buys that one field's exposure.
 *   - Q3 (binding): the lookup response is deliberately OPAQUE between
 *     "no match anywhere" and "matches a leg at a different hub" -- at
 *     this surface the caller holds only a code and has identified
 *     nothing yet, so distinguishing the two would disclose which
 *     shipments are live at other terminals. Requirement 4's six feedback
 *     states live on the HANDOFF ACTION (already built, PR #903), never on
 *     this lookup -- this panel intentionally has FEWER states than that.
 *   - Q5 (binding): a lookup can never burn the leg's own 5-try
 *     `handoffPinAttempts` counter -- no leg is identified yet, so there is
 *     nothing to charge. The copy here never mentions leg lockout. The
 *     lookup instead has its own PER-CALLER rate limit (Pam/god's security
 *     envelope, not this file's concern) -- `limitApproaching`/
 *     `limitReached` exist so that limit is never an unexplained dead end.
 *   - Q6 (binding): a candidate can go stale between lookup and the actual
 *     submit (claimed, departed, arrived, locked). This panel does NOT
 *     guard against that itself -- a second check here would be a second
 *     source of truth that can disagree with the real one. The existing
 *     `/handoff` endpoint already refuses each of those races distinctly;
 *     selecting a candidate hands off to that same submit flow, unchanged.
 *   - Q2/Q7 (Pam's, not yet answered): the exact field set beyond
 *     reference/parcel/from, and the threshold for `tooMany`. Per god's
 *     own framing, adding a field Pam's answer turns out to need is a
 *     smaller change than removing one this file had already designed
 *     around -- so the candidate type below is deliberately minimal.
 *
 * The lookup IDENTIFIES, it does not AUTHORISE: picking a candidate must
 * never be treated as a completed receipt. `onSelectCandidate` exists so a
 * future caller can carry the chosen legId into the existing handoff
 * confirm/submit flow (page.tsx's own `requestHandoffConfirm`/`handoff`) --
 * it never completes anything by itself.
 */
import { Alert, Button, Card, Field, Input } from '../../../components/ui';

export interface CodeLookupCandidate {
  legId: string;
  reference: string;
  parcel: string;
  from: string;
}

export type CodeLookupState =
  | { kind: 'idle' }
  | { kind: 'invalid' }
  | { kind: 'loading' }
  | { kind: 'notFound' }
  | { kind: 'tooMany' }
  | { kind: 'limitApproaching'; remaining: number }
  | { kind: 'limitReached' }
  | { kind: 'error'; message: string }
  | { kind: 'found'; candidates: CodeLookupCandidate[] };

const CODE_PATTERN = /^\d{4,8}$/;

/** Exported so a future caller can gate the lookup call itself, not just this panel's rendering. */
export function isValidLookupCode(value: string): boolean {
  return CODE_PATTERN.test(value.trim());
}

export function CodeLookupPanel({
  code,
  onCodeChange,
  onLookup,
  state,
  onSelectCandidate,
}: {
  code: string;
  onCodeChange: (value: string) => void;
  onLookup: () => void;
  state: CodeLookupState;
  onSelectCandidate: (candidate: CodeLookupCandidate) => void;
}) {
  const invalid = state.kind === 'invalid';
  const loading = state.kind === 'loading';

  return (
    <div className="space-y-3">
      <p className="text-xs text-[color:var(--bmpl-text-muted)]">
        Ask the courier or driver for the code on their own device, and type it in to find the parcel.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="Code presented" htmlFor="code-lookup-input" error={invalid ? 'Enter a 4-8 digit code.' : undefined}>
          <Input
            id="code-lookup-input"
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            inputMode="numeric"
            className="w-full font-mono text-base sm:w-28"
            placeholder="1234"
          />
        </Field>
        <Button onClick={onLookup} disabled={loading} className="w-full sm:w-auto">
          {loading ? 'Looking up…' : 'Find parcel'}
        </Button>
      </div>

      {state.kind === 'notFound' && <Alert tone="neutral">No parcel expecting that code at your location.</Alert>}

      {state.kind === 'tooMany' && (
        <Alert tone="neutral">Too many parcels match that code here. Search by the shipment reference instead, on the Lookup tab.</Alert>
      )}

      {state.kind === 'limitApproaching' && (
        <Alert tone="warning">
          {state.remaining} code {state.remaining === 1 ? 'lookup' : 'lookups'} left before you will need to wait.
        </Alert>
      )}

      {state.kind === 'limitReached' && <Alert tone="warning">Too many code lookups. Wait a moment before trying again.</Alert>}

      {state.kind === 'error' && <Alert tone="error">{state.message}</Alert>}

      {state.kind === 'found' && (
        <div className="space-y-2">
          {state.candidates.map((c) => (
            <Card key={c.legId} className="p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold text-[color:var(--bmpl-text)]">{c.reference}</p>
                  <p className="mt-0.5 break-words text-sm text-[color:var(--bmpl-text-secondary)]">{c.parcel}</p>
                  <p className="mt-0.5 text-sm text-[color:var(--bmpl-text-muted-strong)]">From {c.from}</p>
                </div>
                <Button variant="outline" onClick={() => onSelectCandidate(c)} className="shrink-0">
                  Use this one
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

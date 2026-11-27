/**
 * EDW-P2 (requirement 1/2, code-led handoff): WIRED, against the real
 * `POST /terminal/legs/lookup-by-code` (Pam, PR #909 -- branch
 * feat/edw-p2-terminal-lookup-by-code, `ShipmentService.lookupByHandoffCode`
 * in apps/api/src/shipping/shipment.service.ts). This file's own 7-field
 * candidate type and the 1-5/6+ threshold were designed ahead of the
 * endpoint and reconciled against it unchanged -- confirmed field-for-field
 * against a booted app + real Postgres (Pam's own 10-test integration spec,
 * `terminal-lookup-by-code.integration.spec.ts`, run directly, plus a
 * throwaway dump spec for the raw JSON, deleted after) rather than against
 * prose or this file's own unit tests. Two things the real endpoint settled
 * that this file did NOT have right until this pass:
 *
 *   - `tooMany`/`limitReached` now carry the server's own verbatim message
 *     (optional `message` field, falling back to this file's original copy
 *     when absent, so every pre-existing test keeps passing unchanged) --
 *     the server's literal strings ('Too many parcels match that code. Ask
 *     for the shipment reference instead.' / 'Too many lookups. Wait a
 *     moment and try again.') are now the authoritative text; the copy
 *     written before the endpoint existed was a placeholder, not a design
 *     decision worth keeping over the real source.
 *   - `limitApproaching` has NO real trigger: the endpoint's rate limiter
 *     (`checkLookupRate`, a plain Redis fixed-window counter) returns
 *     nothing on a successful call that would let a caller know how close
 *     to the limit it is -- only a hard 429 once the limit is exceeded. This
 *     state is therefore currently UNREACHABLE from page.tsx's wiring. Left
 *     in place rather than deleted (reported to god as a gap, not silently
 *     removed or guessed into existence) because it is still exercised by
 *     this file's own tests and a future server change could add the signal.
 *
 * The field set and wording below are the settled policy this reconciled
 * against:
 *
 *   - Q1 (binding): `broughtBy`/`courier` are EXCLUDED from a candidate --
 *     a person's name has no disambiguation value and discloses who is
 *     expected at a terminal to anyone fishing with a guessed code.
 *     `reference` IS included -- Edward's own requirement to disambiguate
 *     by shipment reference is what buys that one field's exposure. `kind`
 *     is excluded too -- every eligible leg is LINE_HAUL by construction,
 *     so it is a constant that carries no information.
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
 *   - Q7/Q8 (Pam's, now answered, corrected onto this file
 *     2026-11-26T19-55-40-078Z-9e4498): the lookup is scoped to EVERY hub
 *     the caller holds (Q8), so a result set can legitimately span two
 *     terminals -- a correctness gap in god's own earlier ruling, caught by
 *     Pam, is why `hub` below is now a required field, not an omission.
 *     `arrivedAt` is already visible on the existing terminal queue, so
 *     showing it here is no new disclosure, and it lets staff pick the
 *     more recent of two near-identical candidates. `locked` is a DERIVED
 *     boolean, never the raw `handoffPinAttempts` count -- the raw count
 *     would disclose how close a leg is to lockout, the boolean tells
 *     staff only the one thing they need: this leg cannot be received by
 *     code right now, go to the admin override instead of walking back and
 *     forth on a doomed submit.
 *   - Threshold (Pam's, now settled): the full candidate list renders for
 *     1-5 matches; 6+ renders `tooMany` instead and points at the
 *     reference-based Lookup tab. 5 is still eyeballable against the
 *     parcel in hand; past that it reads as a hub manifest. This matters
 *     because it is a real case, not a defensive hypothetical:
 *     `handoffPin` is a bare 4-digit random value with no uniqueness
 *     constraint, so a collision is neither prevented nor detected --
 *     roughly 2% across 20 eligible legs, 12% across 50.
 *
 * The lookup IDENTIFIES, it does not AUTHORISE: picking a candidate must
 * never be treated as a completed receipt. `onSelectCandidate` exists so a
 * future caller can carry the chosen legId into the existing handoff
 * confirm/submit flow (page.tsx's own `requestHandoffConfirm`/`handoff`) --
 * it never completes anything by itself. A `locked` candidate cannot be
 * selected at all -- there is no submit flow worth handing off to.
 */
import { Alert, Badge, Button, Card, Field, Input } from '../../../components/ui';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-BZ', { dateStyle: 'medium', timeStyle: 'short' }) : null);

export interface CodeLookupCandidate {
  legId: string;
  reference: string;
  parcel: string;
  from: string;
  hub: { code: string; name: string };
  arrivedAt: string | null;
  locked: boolean;
}

export type CodeLookupState =
  | { kind: 'idle' }
  | { kind: 'invalid' }
  | { kind: 'loading' }
  | { kind: 'notFound' }
  | { kind: 'tooMany'; message?: string }
  | { kind: 'limitApproaching'; remaining: number }
  | { kind: 'limitReached'; message?: string }
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

      {/* No "at your location" or similar -- the server's own miss response is
          deliberately byte-identical for "no such code" and "that code is at
          a terminal you don't hold" (confirmed directly against the real
          endpoint), so this copy must not imply the parcel exists elsewhere. */}
      {state.kind === 'notFound' && <Alert tone="neutral">No parcel matches that code.</Alert>}

      {state.kind === 'tooMany' && (
        <Alert tone="neutral">
          {state.message ?? 'More than 5 parcels match that code here. Search by the shipment reference instead, on the Lookup tab.'}
        </Alert>
      )}

      {/* checkLookupRate() in apps/api/src/shipping/shipment.service.ts returns
          nothing on a successful call -- only a hard 429 past the limit -- so
          there is no near-limit signal to dispatch to today. This state is
          intentionally unreachable from page.tsx's wiring. Follow-up filed to
          Pam to add either a remaining-count or remove this state (precedent:
          the same service already exposes collectionPinAttemptsRemaining to
          staff as remaining-not-raw). Do not wire this to a guess. */}
      {state.kind === 'limitApproaching' && (
        <Alert tone="warning">
          {state.remaining} code {state.remaining === 1 ? 'lookup' : 'lookups'} left before you will need to wait.
        </Alert>
      )}

      {state.kind === 'limitReached' && (
        <Alert tone="warning">{state.message ?? 'Too many code lookups. Wait a moment before trying again.'}</Alert>
      )}

      {state.kind === 'error' && <Alert tone="error">{state.message}</Alert>}

      {state.kind === 'found' && (
        <div className="space-y-2">
          {state.candidates.map((c) => (
            <Card key={c.legId} className="p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-sm font-semibold text-[color:var(--bmpl-text)]">{c.reference}</p>
                    {c.locked && <Badge tone="warning">Locked</Badge>}
                  </div>
                  <p className="mt-0.5 break-words text-sm text-[color:var(--bmpl-text-secondary)]">{c.parcel}</p>
                  <p className="mt-0.5 text-sm text-[color:var(--bmpl-text-muted-strong)]">From {c.from}</p>
                  <p className="mt-0.5 text-sm text-[color:var(--bmpl-text-muted-strong)]">
                    At {c.hub.code} — {c.hub.name}
                  </p>
                  <p className="mt-0.5 text-sm text-[color:var(--bmpl-text-muted)]">{c.arrivedAt ? `Arrived ${when(c.arrivedAt)}` : 'Not yet arrived'}</p>
                  {c.locked && (
                    <p className="mt-1 text-sm text-[color:var(--bmpl-text-muted-strong)]">
                      Too many failed codes on this parcel. Use the admin override instead.
                    </p>
                  )}
                </div>
                <Button variant="outline" onClick={() => onSelectCandidate(c)} disabled={c.locked} className="shrink-0">
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

import type { SweepReading, SweepResult, SweepTextElement, SweepIconElement } from './contrast-sweep';

/**
 * The ratchet allowlist for requirement 7
 * (`hive/agents/god/CONTRAST-STANDARD.md`) — approved design, see
 * `hive/agents/jim-mv09alb5/priority7-contrast-ci-approach-2026-10-16.md`
 * §4. Existing, dated, named debt reports but does not block; anything NOT
 * on this list — any new or modified component shipping a contrast
 * violation — fails the build immediately, which is requirement 7's own
 * literal text.
 *
 * ENTRY KEY: {app, route, viewport, accessibleRole, accessibleName} —
 * Playwright's own getByRole(role, {name}) semantics, not a CSS selector
 * (breaks silently on an unrelated markup refactor) and not a file+index
 * key (a reordered list can make an index key match a different, unrelated
 * element and silently misreport it, rather than failing loud). `nameMatches`
 * marks `accessibleName` as a regex source instead of an exact string, for
 * the rare case a label embeds genuinely variable content.
 *
 * MATCH SEMANTICS: one entry may cover MULTIPLE elements sharing the same
 * role+name on a page (a repeated table/card label) — it stays alive as
 * long as AT LEAST ONE matched instance still fails; it goes stale (build
 * fails, demanding its removal) once EVERY matched instance passes, or once
 * nothing matches at all. This is deliberate: remediation here is almost
 * always one shared token/style fix landing for every instance at once, not
 * instance by instance.
 *
 * FRAGILITY, STATED PLAINLY: an accessible-name key breaks (goes stale,
 * fails loud — intended) on any copy change. It cannot express "this
 * specific instance is still broken but a sibling was fixed differently" —
 * same-role-same-name elements are treated as one class. An element with no
 * accessible role or name has no key under this scheme; `keyType:
 * "css-fallback"` plus `cssSelector` is the named-as-weak fallback for that
 * case (flag it in the entry, not silently).
 *
 * `measuredRatio` IS EVIDENCE, NOT IDENTITY (god's direct question,
 * 2026-10-20) — it is never compared when deciding whether an entry
 * matches a reading (that is role+name alone, so a style change that
 * shifts the ratio but not the name never makes an entry silently stop
 * matching). It exists so `checkRatchet` can flag a REGRESSION: the same
 * named element, still covered by the same entry, now reading meaningfully
 * worse than when the entry was added. Without this, a worsening on an
 * already-accepted violation is indistinguishable from a stable one — both
 * just "still fails, still covered" — and nobody would notice the element
 * got worse, not better, under its own allowlist entry.
 */
export interface KnownViolationEntry {
  route: string;
  viewport: number;
  reason: string;
  dateAdded: string;
  ticket?: string;
  keyType?: 'role-name' | 'css-fallback';
  accessibleRole?: string;
  accessibleName?: string;
  nameMatches?: boolean;
  cssSelector?: string;
  /** The ratio recorded when this entry was added -- evidence, not identity. See the file header. */
  measuredRatio?: number;
}

/** A reading's ratio dropped by more than this below the entry's own recorded `measuredRatio` -- float noise tolerance, not a meaningful-regression judgment call beyond "clearly worse, not the same measurement twice." */
const REGRESSION_MARGIN = 0.1;

export interface RatchetCheckResult {
  newViolations: Array<{ element: SweepTextElement | SweepIconElement; ratio: number; requiredRatio: number; suggestedEntry: KnownViolationEntry; lowConfidence: boolean }>;
  staleEntries: KnownViolationEntry[];
  regressions: Array<{ entry: KnownViolationEntry; previousRatio: number; currentRatio: number }>;
}

function nameMatchesEntry(entry: KnownViolationEntry, accessibleName: string | null): boolean {
  if (entry.accessibleName === undefined) return false;
  if (!accessibleName) return false;
  if (entry.nameMatches) return new RegExp(entry.accessibleName).test(accessibleName);
  return entry.accessibleName === accessibleName;
}

function roleMatchesEntry(entry: KnownViolationEntry, accessibleRole: string | null): boolean {
  if (entry.accessibleRole === undefined) return true; // role unspecified -- name alone is the key
  return entry.accessibleRole === accessibleRole;
}

/**
 * Compares one page/role/viewport sweep against the subset of the
 * allowlist already scoped to that (route, viewport) by the caller.
 *
 * Checks THREE things, all at once, in one message when it throws:
 * 1. Every FAIL reading not covered by any entry -- new violations.
 * 2. Every entry that no longer matches a real failure -- stale (god's
 *    required addition: matches nothing, or matches only now-passing
 *    elements, must fail, or the file stops shrinking while looking like
 *    it's working).
 * 3. Every covered reading whose ratio is now meaningfully WORSE than the
 *    entry's own recorded `measuredRatio` -- a regression on already-
 *    accepted debt, which "still covered, still failing" alone would hide.
 *
 * AMBIGUOUS READINGS ARE NOT SILENTLY SKIPPED (god, 2026-10-21): the
 * original three-bucket design never scores an ambiguous reading
 * PASS/FAIL to avoid a false clean -- but that also meant an ambiguous
 * reading whose computed ratio is clearly below the required threshold
 * (low confidence in exactly WHICH background pixel is dominant, not low
 * confidence that the ratio is bad) was reported in its own count and then
 * never checked against the allowlist at all -- neither a violation nor
 * covered debt, just invisible to this function. Fixed by feeding any
 * ambiguous reading whose ratio already fails the threshold through the
 * same pipeline as a confirmed FAIL, flagged `lowConfidence: true` so the
 * message says to verify by eye (same caveat `assertSufficientContrast`
 * already uses for a single low-share reading) rather than claiming
 * certainty it doesn't have.
 */
export function checkRatchet(result: SweepResult, scopedEntries: KnownViolationEntry[], context: { route: string; viewport: number }): RatchetCheckResult {
  const entryStillFails = new Map<KnownViolationEntry, boolean>();
  for (const entry of scopedEntries) {
    entryStillFails.set(entry, false);
  }

  const newViolations: RatchetCheckResult['newViolations'] = [];
  const regressions: RatchetCheckResult['regressions'] = [];
  const regressedEntries = new Set<KnownViolationEntry>();

  function belowThreshold<E>(readings: Array<SweepReading<E>>): Array<SweepReading<E>> {
    return readings.filter((r) => r.ratio < r.requiredRatio);
  }

  function processFailBucket(
    failReadings: Array<SweepReading<SweepTextElement> | SweepReading<SweepIconElement>>,
    lowConfidence: boolean,
  ) {
    for (const reading of failReadings) {
      let covered = false;
      for (const entry of scopedEntries) {
        if (entry.keyType === 'css-fallback') continue; // matched by discovery elsewhere if ever needed -- not reachable from role/name here
        if (roleMatchesEntry(entry, reading.element.accessibleRole) && nameMatchesEntry(entry, reading.element.accessibleName)) {
          covered = true;
          entryStillFails.set(entry, true);
          if (entry.measuredRatio !== undefined && reading.ratio < entry.measuredRatio - REGRESSION_MARGIN && !regressedEntries.has(entry)) {
            regressedEntries.add(entry);
            regressions.push({ entry, previousRatio: entry.measuredRatio, currentRatio: reading.ratio });
          }
        }
      }
      if (!covered) {
        newViolations.push({
          element: reading.element,
          ratio: reading.ratio,
          requiredRatio: reading.requiredRatio,
          lowConfidence,
          suggestedEntry: {
            route: context.route,
            viewport: context.viewport,
            reason: 'TODO: why this is accepted debt, not a regression',
            dateAdded: new Date().toISOString().slice(0, 10),
            keyType: 'role-name',
            accessibleRole: reading.element.accessibleRole ?? undefined,
            accessibleName: reading.element.accessibleName ?? undefined,
            measuredRatio: reading.ratio,
          },
        });
      }
    }
  }

  processFailBucket(result.text.fail, false);
  processFailBucket(result.icon.fail, false);
  processFailBucket(belowThreshold(result.text.ambiguous), true);
  processFailBucket(belowThreshold(result.icon.ambiguous), true);

  const staleEntries = scopedEntries.filter((e) => e.keyType !== 'css-fallback' && !entryStillFails.get(e));
  // css-fallback entries can't be auto-verified by this matcher (no stable
  // locator to re-resolve generically here) -- they are never reported
  // stale automatically; a human reviews them on their own schedule, named
  // as a limitation in the approach doc rather than silently assumed safe.

  return { newViolations, staleEntries, regressions };
}

/**
 * Throws with a single, complete, actionable message covering every new
 * violation and every stale entry at once -- not one failure per entry,
 * which would hide how many problems a run actually found.
 */
export function assertRatchet(result: SweepResult, scopedEntries: KnownViolationEntry[], context: { route: string; viewport: number }): void {
  const { newViolations, staleEntries, regressions } = checkRatchet(result, scopedEntries, context);
  if (newViolations.length === 0 && staleEntries.length === 0 && regressions.length === 0) return;

  const lines: string[] = [];
  if (newViolations.length > 0) {
    lines.push(`${newViolations.length} NEW contrast violation(s) not on the known-violations allowlist (${context.route} @ ${context.viewport}px):`);
    for (const v of newViolations) {
      const confidenceNote = v.lowConfidence
        ? ' LOW-CONFIDENCE READ (ambiguous dominantShare) -- verify by eye before trusting this ratio, but it is NOT silently passed either.'
        : '';
      lines.push(
        `  - role=${v.suggestedEntry.accessibleRole ?? '(none)'} name="${v.suggestedEntry.accessibleName ?? '(none)'}" ratio=${v.ratio} (needs ${v.requiredRatio}).${confidenceNote} ` +
          `If this is real, fix it. If it's accepted debt, add this entry to contrast-known-violations.json: ${JSON.stringify(v.suggestedEntry)}`,
      );
    }
  }
  if (staleEntries.length > 0) {
    lines.push(`${staleEntries.length} STALE known-violations entry(ies) — fixed, renamed, or removed; delete them:`);
    for (const e of staleEntries) {
      lines.push(`  - route=${e.route} viewport=${e.viewport} role=${e.accessibleRole ?? '(none)'} name="${e.accessibleName ?? '(none)'}" (added ${e.dateAdded}, reason: ${e.reason})`);
    }
  }
  if (regressions.length > 0) {
    lines.push(`${regressions.length} REGRESSED known-violations entry(ies) -- still covered, but worse than when accepted:`);
    for (const r of regressions) {
      lines.push(
        `  - route=${r.entry.route} viewport=${r.entry.viewport} name="${r.entry.accessibleName ?? '(none)'}": was ${r.previousRatio} on ${r.entry.dateAdded}, now ${r.currentRatio}. ` +
          `Update measuredRatio in the entry if this is still accepted debt at its new severity, or fix it.`,
      );
    }
  }
  throw new Error(lines.join('\n'));
}

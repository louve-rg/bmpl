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
}

export interface RatchetCheckResult {
  newViolations: Array<{ element: SweepTextElement | SweepIconElement; ratio: number; requiredRatio: number; suggestedEntry: KnownViolationEntry }>;
  staleEntries: KnownViolationEntry[];
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
 * allowlist already scoped to that (route, viewport) by the caller. Returns
 * every FAIL reading not covered by any entry (new violations — these fail
 * the build) and every entry that no longer matches a real failure (stale —
 * these ALSO fail the build, per god's required addition: an allowlist
 * entry that matches nothing, or matches only now-passing elements, must
 * fail, or the file stops shrinking while looking like it's working).
 */
export function checkRatchet(result: SweepResult, scopedEntries: KnownViolationEntry[], context: { route: string; viewport: number }): RatchetCheckResult {
  const allTextReadings = [...result.text.pass, ...result.text.fail, ...result.text.ambiguous];
  const allIconReadings = [...result.icon.pass, ...result.icon.fail, ...result.icon.ambiguous];

  const entryStillFails = new Map<KnownViolationEntry, boolean>();
  const entryMatchedAnything = new Map<KnownViolationEntry, boolean>();
  for (const entry of scopedEntries) {
    entryStillFails.set(entry, false);
    entryMatchedAnything.set(entry, false);
  }

  const newViolations: RatchetCheckResult['newViolations'] = [];

  function processFailBucket(failReadings: Array<SweepReading<SweepTextElement> | SweepReading<SweepIconElement>>) {
    for (const reading of failReadings) {
      let covered = false;
      for (const entry of scopedEntries) {
        if (entry.keyType === 'css-fallback') continue; // matched by discovery elsewhere if ever needed -- not reachable from role/name here
        if (roleMatchesEntry(entry, reading.element.accessibleRole) && nameMatchesEntry(entry, reading.element.accessibleName)) {
          covered = true;
          entryStillFails.set(entry, true);
        }
      }
      if (!covered) {
        newViolations.push({
          element: reading.element,
          ratio: reading.ratio,
          requiredRatio: reading.requiredRatio,
          suggestedEntry: {
            route: context.route,
            viewport: context.viewport,
            reason: 'TODO: why this is accepted debt, not a regression',
            dateAdded: new Date().toISOString().slice(0, 10),
            keyType: 'role-name',
            accessibleRole: reading.element.accessibleRole ?? undefined,
            accessibleName: reading.element.accessibleName ?? undefined,
          },
        });
      }
    }
  }

  // Mark entries that match ANY reading (pass/fail/ambiguous) so a
  // zero-match stale case (element gone/renamed) is distinguishable from an
  // all-now-passing stale case (element fixed) -- both fail, but the
  // message should say which.
  for (const reading of allTextReadings) {
    for (const entry of scopedEntries) {
      if (entry.keyType === 'css-fallback') continue;
      if (roleMatchesEntry(entry, reading.element.accessibleRole) && nameMatchesEntry(entry, reading.element.accessibleName)) {
        entryMatchedAnything.set(entry, true);
      }
    }
  }
  for (const reading of allIconReadings) {
    for (const entry of scopedEntries) {
      if (entry.keyType === 'css-fallback') continue;
      if (roleMatchesEntry(entry, reading.element.accessibleRole) && nameMatchesEntry(entry, reading.element.accessibleName)) {
        entryMatchedAnything.set(entry, true);
      }
    }
  }

  processFailBucket(result.text.fail);
  processFailBucket(result.icon.fail);

  const staleEntries = scopedEntries.filter((e) => e.keyType !== 'css-fallback' && !entryStillFails.get(e));
  // css-fallback entries can't be auto-verified by this matcher (no stable
  // locator to re-resolve generically here) -- they are never reported
  // stale automatically; a human reviews them on their own schedule, named
  // as a limitation in the approach doc rather than silently assumed safe.

  return { newViolations, staleEntries };
}

/**
 * Throws with a single, complete, actionable message covering every new
 * violation and every stale entry at once -- not one failure per entry,
 * which would hide how many problems a run actually found.
 */
export function assertRatchet(result: SweepResult, scopedEntries: KnownViolationEntry[], context: { route: string; viewport: number }): void {
  const { newViolations, staleEntries } = checkRatchet(result, scopedEntries, context);
  if (newViolations.length === 0 && staleEntries.length === 0) return;

  const lines: string[] = [];
  if (newViolations.length > 0) {
    lines.push(`${newViolations.length} NEW contrast violation(s) not on the known-violations allowlist (${context.route} @ ${context.viewport}px):`);
    for (const v of newViolations) {
      lines.push(
        `  - role=${v.suggestedEntry.accessibleRole ?? '(none)'} name="${v.suggestedEntry.accessibleName ?? '(none)'}" ratio=${v.ratio} (needs ${v.requiredRatio}). ` +
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
  throw new Error(lines.join('\n'));
}

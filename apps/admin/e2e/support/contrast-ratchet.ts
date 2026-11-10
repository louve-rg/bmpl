import * as fs from 'node:fs';
import * as path from 'node:path';
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
  newViolations: Array<{ element: SweepTextElement | SweepIconElement; ratio: number; requiredRatio: number; suggestedEntry: KnownViolationEntry }>;
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
 * AMBIGUOUS READINGS NEVER FAIL THE BUILD (god, 2026-10-21, reversing an
 * earlier version of this comment from the same date): an earlier revision
 * fed any ambiguous reading whose ratio already failed the threshold
 * through the same pipeline as a confirmed FAIL, reasoning that "ambiguous"
 * meant "low confidence, but probably still bad." That reasoning was
 * wrong. contrast-sweep.ts's own header already defines the ambiguous
 * bucket correctly: low `dominantShare` means the element sits on a
 * composite surface -- a gradient, image, or glass/blur -- where no single
 * background colour can be resolved at all, not "probably a violation
 * measured with low confidence." Once routed into newViolations, that
 * distinction was lost on `assertRatchet`, which throws the words "NEW
 * contrast violation(s)" over a reading that only means "I could not
 * measure this" -- the exact category error being policed everywhere else
 * on this effort. Empirical support: of 4 ambiguous readings independently
 * hand-verified against the live rendered pixels this run (Dwight,
 * 2026-10-21), all 4 were artifacts of the glass/mural surface, none were
 * real violations -- a 100% false-positive rate on the only sample
 * measured so far. Ambiguous readings are now treated exactly like
 * `compositeGraphics` in contrast-sweep.ts: reported, named (in
 * `formatSweepReport`), counted in the accounting invariant exactly as
 * before -- and never scored into a build failure or added to the
 * allowlist (allowlisting would misrecord "could not measure" as "accepted
 * debt", the same lie in the other direction). The FAIL bucket -- high
 * dominantShare, a resolvable solid background -- is unaffected and still
 * fails the build; this is where the instrument is trustworthy.
 * KNOWN CONSEQUENCE, stated plainly rather than hidden: this removes false
 * failures, it does not add true detection. There is currently no working
 * automated check for contrast on a glass/translucent surface -- most of
 * this platform's own chrome. Real glass-surface defects the owner found by
 * eye (CONTRAST-STANDARD.md: StorefrontView sidebar, ReviewList,
 * SaveJobButton) would be measured as ambiguous by this sweep and, after
 * this change, would not fail the build either. The eventual fix is a
 * different method -- sampling actual rendered pixels behind the text from
 * a screenshot rather than walking computed styles -- scoped as its own
 * card, not bundled into this change.
 */
export function checkRatchet(result: SweepResult, scopedEntries: KnownViolationEntry[], context: { route: string; viewport: number }): RatchetCheckResult {
  const entryStillFails = new Map<KnownViolationEntry, boolean>();
  for (const entry of scopedEntries) {
    entryStillFails.set(entry, false);
  }

  const newViolations: RatchetCheckResult['newViolations'] = [];
  const regressions: RatchetCheckResult['regressions'] = [];
  const regressedEntries = new Set<KnownViolationEntry>();

  function processFailBucket(failReadings: Array<SweepReading<SweepTextElement> | SweepReading<SweepIconElement>>) {
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

  processFailBucket(result.text.fail);
  processFailBucket(result.icon.fail);
  // Ambiguous readings deliberately do NOT feed this function at all any
  // more -- see this file's own header comment, dated 2026-10-21.

  const staleEntries = scopedEntries.filter((e) => e.keyType !== 'css-fallback' && !entryStillFails.get(e));
  // css-fallback entries can't be auto-verified by this matcher (no stable
  // locator to re-resolve generically here) -- they are never reported
  // stale automatically; a human reviews them on their own schedule, named
  // as a limitation in the approach doc rather than silently assumed safe.

  return { newViolations, staleEntries, regressions };
}

/**
 * MDF-678 addition (god, 2026-11-10, same turn he endorsed PR #660): a
 * width that never ran at all looks EXACTLY like a width that ran and
 * passed -- same shape as the count-drop guard above, a second symptom of
 * the same defect class. Found live on the admin dispatch DETAIL route's
 * own `test.afterAll` recorder: 5 of 9 widths showed as Playwright-skipped
 * ("-", not a failure) and nothing before this addition ever complained.
 *
 * `contributedCount` (each spec file's own, incremented once per width
 * that reached `recordPassNames`/`sweepContrast`) already existed in every
 * one of these spec files before this card -- it just only ever fed an
 * informational console.log ("contributed=N/9"), never an assertion. This
 * function is what a spec file's own `test.afterAll` now calls with that
 * existing counter, turning an easy-to-miss log line into a hard failure.
 *
 * Deliberately agnostic about WHY a width is missing -- a real
 * `test.skip()`, a worker restart after an earlier test's failure
 * reloading this module and resetting the counter (this file's own
 * existing comments already document that mechanism), or anything else not
 * yet named. The guard's job is to notice the gap, not diagnose it; see
 * this file's own header comment on `checkDiscoveryDrop` for the matching
 * philosophy on the count-drop half of this same card.
 */
export function assertAllWidthsExamined(contributedCount: number, totalWidths: number, context: { route: string }): void {
  if (contributedCount >= totalWidths) return;
  throw new Error(
    `contrast sweep for ${context.route}: only ${contributedCount}/${totalWidths} width(s) were actually examined by the end of this run -- ` +
      `${totalWidths - contributedCount} width(s) never ran at all (skipped, or lost to a worker restart after an earlier failure). ` +
      `A width that never ran reports nothing, which looks identical to a width that ran and passed -- do not treat that silence as clean.`,
  );
}

const DISCOVERY_BASELINE_PATH = path.join(__dirname, '..', 'contrast-discovery-baseline.json');

function loadDiscoveryBaseline(): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(DISCOVERY_BASELINE_PATH, 'utf8')) as Record<string, number>;
  } catch {
    return {};
  }
}

/**
 * CONTRAST-DISCOVERY-DROP (god, 2026-11-10): an element the sweep once
 * SCORED (pass, fail, or ambiguous -- any of the three) can later vanish
 * from the sweep entirely -- zero appearances, in no bucket -- and nothing
 * else in this file notices, because `checkRatchet` above only ever looks
 * at the FAIL bucket. A scored violation quietly turning into "not
 * discovered at all" reads as the violation being FIXED, when the real
 * cause is the instrument no longer looking at that element at all. MDF-390
 * names the general principle: absence of a violation line is not a pass.
 *
 * This is a BLUNT, total-count guard, not a per-element one: it compares
 * the total number of elements `discoverElements()` found at a given
 * (route, viewport) -- scored (pass/fail/ambiguous) PLUS excluded-but-
 * accounted-for (disabled text, composite icons) -- against the last count
 * this same (route, viewport) committed to `contrast-discovery-baseline.json`.
 * It cannot say WHICH element disappeared (the NDJSON results file
 * (`contrast-results.ndjson`) from the run that regressed is the place to
 * look for that, by diffing its role+name set against a known-good run) --
 * only THAT the total dropped, which is already enough to stop a silent
 * drop from reading as a fix.
 *
 * A missing baseline entry (new route/viewport, never recorded) is NOT a
 * failure -- there is nothing to compare against yet. GROWTH is also not a
 * failure -- new UI legitimately adds elements to measure, and this guard
 * exists to catch the instrument looking at LESS than before, never more.
 * Both cases print a line naming the exact JSON entry to add/update; the
 * baseline is maintained the same way `contrast-known-violations.json` is --
 * a human (or an agent, same as this one) copies the printed suggestion in,
 * deliberately, same as adding a known violation. Nothing here auto-writes
 * the file -- a test run that silently rewrote its own baseline on every
 * pass could not ever catch a drop, because the baseline would always equal
 * whatever the last (possibly-regressed) run just saw.
 */
export function checkDiscoveryDrop(
  result: SweepResult,
  context: { route: string; viewport: number },
  baselineOverride?: Record<string, number>,
): string | null {
  const textDiscovered = result.text.pass.length + result.text.fail.length + result.text.ambiguous.length + result.text.excludedDisabledCount;
  const iconDiscovered = result.icon.pass.length + result.icon.fail.length + result.icon.ambiguous.length + result.icon.compositeGraphics.length;
  const discovered = textDiscovered + iconDiscovered;
  const key = `${context.route}@${context.viewport}`;
  const known = (baselineOverride ?? loadDiscoveryBaseline())[key];

  if (known === undefined) {
    // eslint-disable-next-line no-console
    console.log(`[contrast-discovery] ${key}: first time seen, ${discovered} element(s) discovered (text ${textDiscovered} + icon ${iconDiscovered}) -- not yet in contrast-discovery-baseline.json. Add: "${key}": ${discovered}`);
    return null;
  }
  if (discovered > known) {
    // eslint-disable-next-line no-console
    console.log(`[contrast-discovery] ${key}: discovery count grew (${known} -> ${discovered}) -- update contrast-discovery-baseline.json when convenient ("${key}": ${discovered}), not required.`);
    return null;
  }
  if (discovered === known) return null;

  return (
    `DISCOVERY COUNT DROPPED for ${key}: was ${known}, now ${discovered} (text ${textDiscovered} + icon ${iconDiscovered}) -- ` +
    `${known - discovered} element(s) that used to be discovered (in SOME bucket -- pass, fail, or ambiguous) are gone entirely, not in any bucket. ` +
    `A scored violation disappearing like this looks exactly like the violation being fixed; it usually means the instrument stopped looking at it. ` +
    `Diff this run's contrast-results.ndjson role+name set against a known-good run's to find which element(s). Do NOT lower the baseline number ` +
    `to make this pass unless you have confirmed by hand that the missing element(s) are gone from the page on purpose.`
  );
}

/**
 * Throws with a single, complete, actionable message covering every new
 * violation and every stale entry at once -- not one failure per entry,
 * which would hide how many problems a run actually found.
 */
export function assertRatchet(result: SweepResult, scopedEntries: KnownViolationEntry[], context: { route: string; viewport: number }): void {
  const { newViolations, staleEntries, regressions } = checkRatchet(result, scopedEntries, context);
  const discoveryDrop = checkDiscoveryDrop(result, context);
  if (newViolations.length === 0 && staleEntries.length === 0 && regressions.length === 0 && !discoveryDrop) return;

  const lines: string[] = [];
  if (discoveryDrop) {
    lines.push(discoveryDrop);
  }
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

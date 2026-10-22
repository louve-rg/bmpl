import type { Page } from '@playwright/test';
import { openPixelSampler, contrastRatioOf, compositeOver, type RGB } from './contrast';

/**
 * Requirement 7 (`hive/agents/god/CONTRAST-STANDARD.md`) — page-wide
 * contrast sweep for apps/admin. Identical to apps/web/e2e/support/
 * contrast-sweep.ts; see that file's header for the full reasoning (why the
 * existing pixel sampler over a DOM walker, the three PASS/FAIL/AMBIGUOUS
 * buckets, why border-only essential graphics are named as NOT MEASURED
 * rather than silently dropped, why icon findings are experimental and
 * reported separately from text). Duplicated rather than shared for the
 * same reason as every other file in this directory — no shared package
 * exists between the two apps' e2e trees today.
 *
 * COMPOSITE GRAPHICS (e.g. this app's own daily-sales chart, role="img"
 * wrapping a bar row AND an orders-strip row as one element) get their own
 * named bucket, never a scored reading -- see apps/web's own copy of this
 * file for the full reasoning and the structural (not size-based) test.
 *
 * KNOWN GAP, shared with apps/web: `hasOwnFillDescendant` only detects a
 * CSS-painted composite, not an SVG-painted one (apps/web's
 * StarRating.tsx is the known instance -- five SVG stars painted via
 * fill/clipPath, no CSS background anywhere). Not live on any route this
 * app sweeps today. Must be widened before route expansion reaches any
 * page that renders a star rating or similar SVG composite.
 */

export const WCAG_NORMAL_TEXT_MIN_RATIO = 4.5;
export const WCAG_LARGE_TEXT_MIN_RATIO = 3;
export const WCAG_ICON_MIN_RATIO = 3;

/**
 * Ambiguity cutoff for `dominantShare`. Calibrated on apps/web's own
 * dashboard (see that app's contrast-sweep.ts for the three real readings
 * this number is grounded in — 0.78 solid vs 0.17/0.22 mural/gradient).
 * Reused here rather than recalibrated separately: both apps share the
 * exact same `packages/ui/src/glass.css` token/mural definitions and the
 * same sampler grid shape, so the same background-paint categories (solid
 * raised fill vs mural/gradient vs glass edge) apply to admin's own glass
 * scope (`AdminShell.tsx`) without needing an independent measurement.
 */
export const AMBIGUOUS_DOMINANT_SHARE_CUTOFF = 0.5;

/**
 * Minimum share an icon's "ink" cluster must hold before it is trusted as
 * the icon's real fill rather than a stray sample. See apps/web's identical
 * copy of this constant for the full reasoning (god/Jim, 2026-10-22,
 * MDF-376) -- the existing cutoff above keys on the BACKGROUND cluster's
 * share, not on whether the second cluster is representative, so a
 * confident-looking background share can hide a single lucky anti-aliased
 * edge pixel being read as the icon's ink. The grid is a fixed 18 points
 * (contrast.ts's `clusterAt`), so 2/18 is the smallest guard that rules out
 * a lone-pixel fluke.
 */
export const MIN_ICON_INK_SHARE = 2 / 18;

// WCAG's own "large text" definition (>=24px regular, or >=18.66px bold) is
// applied as literal numbers inside discoverElements' page.evaluate() below
// — a page.evaluate callback runs in the browser and cannot close over a
// Node-side const without passing it through the function's own argument
// object, so a module-level constant here would be unused, not reused.

export interface SweepTextElement {
  kind: 'text';
  tag: string;
  accessibleRole: string | null;
  accessibleName: string | null;
  textSnippet: string;
  isLargeText: boolean;
  box: { x: number; y: number; width: number; height: number };
  /** Raw CSS color, read during discovery -- see discoverElements' own comment for why this replaced an elementFromPoint lookup. */
  color: string;
}

export interface SweepIconElement {
  kind: 'icon';
  tag: string;
  accessibleRole: string | null;
  accessibleName: string | null;
  box: { x: number; y: number; width: number; height: number };
}

export interface SweepCompositeGraphic {
  kind: 'composite';
  tag: string;
  accessibleRole: string | null;
  accessibleName: string | null;
  box: { x: number; y: number; width: number; height: number };
}

export interface SweepReading<E> {
  element: E;
  ratio: number;
  dominantShare: number;
  foreground: RGB;
  dominantBackground: RGB;
  requiredRatio: number;
}

export interface SweepBucket<E> {
  pass: SweepReading<E>[];
  fail: SweepReading<E>[];
  ambiguous: SweepReading<E>[];
}

export interface SweepResult {
  text: SweepBucket<SweepTextElement> & { excludedDisabledCount: number; measuredCount: number };
  icon: SweepBucket<SweepIconElement> & { measuredCount: number; compositeGraphics: SweepCompositeGraphic[] };
  borderOnlyNotMeasured: true;
}

type DiscoveredText = SweepTextElement & { disabled: boolean };
type DiscoveredIcon = SweepIconElement & { composite: boolean };

async function discoverElements(page: Page): Promise<{ text: DiscoveredText[]; icon: DiscoveredIcon[] }> {
  return page.evaluate(() => {
    const NON_TEXT_TAGS = new Set(['SCRIPT', 'STYLE', 'SVG', 'PATH', 'CIRCLE', 'RECT', 'NOSCRIPT']);

    function isExempt(el: Element): boolean {
      return !!el.closest('[aria-hidden="true"], [data-contrast-exempt="decorative"]');
    }

    // Found live (god/Jim, 2026-10-22, MDF-376) on apps/web's identical copy
    // of this file -- see that file for the full mechanism. `role="img"`
    // routes the whole element into the icon pipeline regardless of what it
    // contains; a wrapper that hides its real, visible text in an
    // `aria-hidden` child (to avoid announcing it twice to a screen reader)
    // is deduplicating the ACCESSIBILITY TREE, not marking the content
    // visually decorative. `isExemptForText` keeps the original exemption
    // for genuinely decorative aria-hidden content with no role="img"
    // ancestor, and un-exempts only the deduplication case -- `isExempt`
    // itself is untouched and still gates icon/svg discovery as before.
    function isExemptForText(el: Element): boolean {
      if (el.closest('[data-contrast-exempt="decorative"]')) return true;
      const hiddenAncestor = el.closest('[aria-hidden="true"]');
      if (!hiddenAncestor) return false;
      if (hiddenAncestor.closest('[role="img"]')) return false;
      return true;
    }

    // Structural composite-graphic test -- see apps/web's own copy of this
    // file for the full reasoning. False for every genuine icon (svg
    // path/circle children paint via fill/stroke, never CSS background);
    // true for a wrapper that actually contains other filled content.
    function hasOwnFillDescendant(el: Element): boolean {
      for (const child of el.querySelectorAll('*')) {
        const cs = getComputedStyle(child);
        if (cs.backgroundImage !== 'none') return true;
        if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') return true;
      }
      return false;
    }

    function isDisabled(el: Element): boolean {
      const control = el.closest('button, input, select, textarea, [role="button"], [aria-disabled]');
      if (!control) return false;
      if ((control as HTMLButtonElement).disabled) return true;
      return control.getAttribute('aria-disabled') === 'true';
    }

    function accessibleRoleOf(el: Element): string | null {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) return 'heading';
      if (tag === 'a' && el.hasAttribute('href')) return 'link';
      if (tag === 'button') return 'button';
      return null;
    }

    function accessibleNameOf(el: Element, fallbackText: string | null): string | null {
      const label = el.getAttribute('aria-label');
      if (label) return label;
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const target = document.getElementById(labelledBy);
        if (target?.textContent) return target.textContent.trim();
      }
      return fallbackText;
    }

    // Cluster F root cause -- see apps/web/e2e/support/contrast-sweep.ts's
    // identical copy of this comment for the full mechanism (found on web's
    // Header.tsx/CategoryNav.tsx; admin has no Cluster F instance today, but
    // the same closed-<details> pattern would produce the same artifact
    // anywhere it's used, so both apps' sweeps carry the same guard rather
    // than drifting into two different measurements again).
    function isInsideClosedDetails(el: Element): boolean {
      let node: Element | null = el.parentElement;
      while (node) {
        if (node.tagName === 'DETAILS' && !node.hasAttribute('open')) {
          const summary = node.querySelector(':scope > summary');
          if (!summary || !summary.contains(el)) return true;
        }
        node = node.parentElement;
      }
      return false;
    }

    const textOut: Array<{
      kind: 'text';
      tag: string;
      accessibleRole: string | null;
      accessibleName: string | null;
      textSnippet: string;
      isLargeText: boolean;
      box: { x: number; y: number; width: number; height: number };
      disabled: boolean;
      color: string;
    }> = [];
    const iconOut: Array<{
      kind: 'icon';
      tag: string;
      accessibleRole: string | null;
      accessibleName: string | null;
      box: { x: number; y: number; width: number; height: number };
      composite: boolean;
    }> = [];

    for (const el of document.body.querySelectorAll('*')) {
      if ((el.tagName === 'SVG' || el.getAttribute('role') === 'img') && !el.closest('svg svg')) {
        if (isExempt(el)) continue; // decorative icon exemption -- unchanged, scoped to this branch only now
        if (el.tagName !== 'SVG' && el.closest('svg')) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const box = el.getBoundingClientRect();
        if (box.width < 2 || box.height < 2) continue;
        if (isInsideClosedDetails(el)) continue; // real box, nothing painted -- see isInsideClosedDetails' own comment
        iconOut.push({
          kind: 'icon',
          tag: el.tagName,
          accessibleRole: accessibleRoleOf(el),
          accessibleName: accessibleNameOf(el, null),
          box: { x: box.x, y: box.y, width: box.width, height: box.height },
          composite: hasOwnFillDescendant(el),
        });
        continue;
      }

      if (el.children.length !== 0) continue;
      const text = (el.textContent || '').trim();
      if (!text) continue;
      if (NON_TEXT_TAGS.has(el.tagName)) continue;
      if (el.classList.contains('sr-only')) continue;
      if (isExemptForText(el)) continue;

      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;

      const box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue;
      if (isInsideClosedDetails(el)) continue; // real box, nothing painted -- see isInsideClosedDetails' own comment

      const fontSizePx = parseFloat(cs.fontSize);
      const fontWeight = parseInt(cs.fontWeight, 10) || 400;
      const isLargeText = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);

      textOut.push({
        kind: 'text',
        tag: el.tagName,
        accessibleRole: accessibleRoleOf(el),
        accessibleName: accessibleNameOf(el, text.slice(0, 120)),
        textSnippet: text.slice(0, 120),
        isLargeText,
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        disabled: isDisabled(el),
        color: cs.color,
      });
    }

    return { text: textOut, icon: iconOut };
  });
}

export async function sweepContrast(page: Page, ambiguousShareCutoff: number = AMBIGUOUS_DOMINANT_SHARE_CUTOFF): Promise<SweepResult> {
  const { text: textCandidates, icon: iconCandidates } = await discoverElements(page);

  const disabled = textCandidates.filter((t) => t.disabled);
  const measurableText = textCandidates.filter((t) => !t.disabled);

  const sampler = await openPixelSampler(page);
  try {
    const textBucket: SweepBucket<SweepTextElement> = { pass: [], fail: [], ambiguous: [] };
    for (const t of measurableText) {
      // Foreground color is read during discovery (t.color), not via a
      // document.elementFromPoint lookup here -- found live (2026-10-21, PR
      // #469): elementFromPoint only resolves points inside the CURRENTLY
      // RENDERED viewport. Any element below the first screenful returned
      // null, which this loop used to silently `continue` past -- counted in
      // measuredCount, never scored in any bucket, no error. That is how
      // "By revenue" (and 5 other elements the same run) vanished without a
      // trace instead of landing in fail or ambiguous.
      const fgParsed = parseRgbLocal(t.color);
      if (!fgParsed) continue;

      const { rgb: bg, share } = await sampler.sampleDominant(t.box);
      const fg = compositeOver(fgParsed.rgb, fgParsed.alpha, bg);
      const ratio = Math.round(contrastRatioOf(fg, bg) * 100) / 100;
      const requiredRatio = t.isLargeText ? WCAG_LARGE_TEXT_MIN_RATIO : WCAG_NORMAL_TEXT_MIN_RATIO;
      const element: SweepTextElement = {
        kind: 'text',
        tag: t.tag,
        accessibleRole: t.accessibleRole,
        accessibleName: t.accessibleName,
        textSnippet: t.textSnippet,
        isLargeText: t.isLargeText,
        box: t.box,
        color: t.color,
      };
      const reading: SweepReading<SweepTextElement> = { element, ratio, dominantShare: share, foreground: fg, dominantBackground: bg, requiredRatio };
      if (share < ambiguousShareCutoff) textBucket.ambiguous.push(reading);
      else if (ratio < requiredRatio) textBucket.fail.push(reading);
      else textBucket.pass.push(reading);
    }

    const compositeIcons = iconCandidates.filter((ic) => ic.composite);
    const measurableIcons = iconCandidates.filter((ic) => !ic.composite);

    const iconBucket: SweepBucket<SweepIconElement> = { pass: [], fail: [], ambiguous: [] };
    for (const ic of measurableIcons) {
      const clusters = await sampler.sampleClustersOrdered(ic.box);
      if (clusters.length === 0) continue;
      const bg = clusters[0]!.rgb;
      const share = clusters[0]!.share;
      const fg = clusters[1]?.rgb ?? bg;
      const ratio = Math.round(contrastRatioOf(fg, bg) * 100) / 100;
      // See apps/web's identical copy of this block for the full reasoning.
      const inkShare = clusters[1]?.share ?? 0;
      const inkUnreliable = inkShare < MIN_ICON_INK_SHARE;
      const reportedShare = inkUnreliable && share >= ambiguousShareCutoff ? inkShare : share;
      const element: SweepIconElement = { kind: 'icon', tag: ic.tag, accessibleRole: ic.accessibleRole, accessibleName: ic.accessibleName, box: ic.box };
      const reading: SweepReading<SweepIconElement> = { element, ratio, dominantShare: reportedShare, foreground: fg, dominantBackground: bg, requiredRatio: WCAG_ICON_MIN_RATIO };
      if (share < ambiguousShareCutoff || inkUnreliable) iconBucket.ambiguous.push(reading);
      else if (ratio < WCAG_ICON_MIN_RATIO) iconBucket.fail.push(reading);
      else iconBucket.pass.push(reading);
    }

    // Hard accounting invariant, not a warning -- found live (2026-10-21):
    // a silent drop (the elementFromPoint bug fixed above) counted an
    // element in measuredCount while scoring it in NO bucket, and up to 30%
    // of a run's sample went missing with no error, in output already
    // quoted as a complete result. Every discovered element must land in
    // exactly one of: scored (pass/fail/ambiguous) or excluded-disabled. A
    // sweep that cannot account for its own sample must refuse to report,
    // because this guard exists precisely to catch causes neither of us has
    // thought of yet, not just the one bug just fixed.
    const textAccountedFor = textBucket.pass.length + textBucket.fail.length + textBucket.ambiguous.length + disabled.length;
    if (textAccountedFor !== textCandidates.length) {
      throw new Error(
        `sweepContrast: text accounting mismatch -- discovered ${textCandidates.length} elements but ` +
          `pass(${textBucket.pass.length})+fail(${textBucket.fail.length})+ambiguous(${textBucket.ambiguous.length})+excludedDisabled(${disabled.length}) ` +
          `= ${textAccountedFor}, leaving ${textCandidates.length - textAccountedFor} silently unaccounted for.`,
      );
    }
    const iconAccountedFor = iconBucket.pass.length + iconBucket.fail.length + iconBucket.ambiguous.length + compositeIcons.length;
    if (iconAccountedFor !== iconCandidates.length) {
      throw new Error(
        `sweepContrast: icon accounting mismatch -- discovered ${iconCandidates.length} elements but ` +
          `pass(${iconBucket.pass.length})+fail(${iconBucket.fail.length})+ambiguous(${iconBucket.ambiguous.length})+compositeNotMeasured(${compositeIcons.length}) ` +
          `= ${iconAccountedFor}, leaving ${iconCandidates.length - iconAccountedFor} silently unaccounted for.`,
      );
    }

    const compositeGraphics: SweepCompositeGraphic[] = compositeIcons.map((ic) => ({
      kind: 'composite',
      tag: ic.tag,
      accessibleRole: ic.accessibleRole,
      accessibleName: ic.accessibleName,
      box: ic.box,
    }));

    return {
      text: { ...textBucket, excludedDisabledCount: disabled.length, measuredCount: measurableText.length },
      icon: { ...iconBucket, measuredCount: measurableIcons.length, compositeGraphics },
      borderOnlyNotMeasured: true,
    };
  } finally {
    await sampler.close();
  }
}

/**
 * Mirrors `parseRgb` in `./contrast` — see the web copy of this file for
 * why alpha must be carried through to `compositeOver` rather than
 * discarded here.
 */
function parseRgbLocal(css: string): { rgb: RGB; alpha: number } | null {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m || m[1] === undefined) return null;
  const [r, g, b, a] = m[1].split(',').map((n) => parseFloat(n));
  if (r === undefined || g === undefined || b === undefined) return null;
  return { rgb: { r, g, b }, alpha: a === undefined ? 1 : a };
}

export function formatSweepReport(label: string, result: SweepResult): string {
  const lines = [
    `[contrast] ${label}`,
    `  text: measured=${result.text.measuredCount} pass=${result.text.pass.length} fail=${result.text.fail.length} ambiguous=${result.text.ambiguous.length} excludedDisabled=${result.text.excludedDisabledCount}`,
    `  icon (EXPERIMENTAL METHOD): measured=${result.icon.measuredCount} pass=${result.icon.pass.length} fail=${result.icon.fail.length} ambiguous=${result.icon.ambiguous.length} compositeNotMeasured=${result.icon.compositeGraphics.length}`,
    `  border-only essential graphics: NOT MEASURED`,
  ];
  if (result.icon.compositeGraphics.length > 0) {
    lines.push(`  composite graphics (contains its own filled content, not a single fg/bg pair -- NOT MEASURED, not silently dropped):`);
    for (const g of result.icon.compositeGraphics) {
      lines.push(`    - role=${g.accessibleRole ?? '(none)'} name="${g.accessibleName ?? '(none)'}"`);
    }
  }
  // See apps/web's identical copy of this comment (god, 2026-10-21): low
  // dominantShare means "composite/glass surface, cannot resolve a single
  // background colour" -- NOT a confidence-weighted guess at a violation.
  // The ratchet never scores these into a build failure any more -- 4 of 4
  // independently hand-verified ambiguous readings this run were artifacts
  // of the glass surface (Dwight, 2026-10-21).
  // EVERY ambiguous reading is printed, regardless of which side of its own
  // threshold the ratio falls on (god, 2026-10-21) -- an un-allowlisted
  // ambiguous reading used to be promoted to a build failure ONLY when its
  // ratio already failed (contrast-ratchet.ts's belowThreshold), so an
  // ambiguous reading whose ratio happened to pass was invisible
  // everywhere: not a violation, not text.pass (bucketed ambiguous), not in
  // recordPassNames (reads text.pass only). That is the literal mechanism
  // behind an element going from "discovered and flagged at every width" to
  // "appears nowhere" on nothing more than a colour change that pushed its
  // ratio across the threshold while dominantShare never moved -- see this
  // app's analytics.spec.ts PageHeader-description investigation. The
  // PASS/FAIL side is stated explicitly per reading, not left for a reader
  // to infer from two numbers.
  if (result.text.ambiguous.length > 0) {
    lines.push(`  ambiguous text (low dominantShare -- composite/glass surface, cannot resolve a single background colour -- NOT MEASURED, does NOT fail the build, not silently dropped):`);
    for (const r of result.text.ambiguous) {
      const side = r.ratio >= r.requiredRatio ? 'PASS' : 'FAIL';
      lines.push(`    - role=${r.element.accessibleRole ?? '(none)'} name="${r.element.accessibleName ?? '(none)'}" ratio=${r.ratio} (needs ${r.requiredRatio}) dominantShare=${r.dominantShare} -- ambiguous, ratio would ${side}`);
    }
  }
  if (result.icon.ambiguous.length > 0) {
    lines.push(`  ambiguous icon (EXPERIMENTAL METHOD, same NOT-failing treatment as ambiguous text above):`);
    for (const r of result.icon.ambiguous) {
      const side = r.ratio >= r.requiredRatio ? 'PASS' : 'FAIL';
      lines.push(`    - role=${r.element.accessibleRole ?? '(none)'} name="${r.element.accessibleName ?? '(none)'}" ratio=${r.ratio} (needs ${r.requiredRatio}) dominantShare=${r.dominantShare} -- ambiguous, ratio would ${side}`);
    }
  }
  return lines.join('\n');
}

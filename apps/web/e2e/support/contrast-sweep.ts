import type { Page } from '@playwright/test';
import { openPixelSampler, contrastRatioOf, type RGB } from './contrast';

/**
 * Requirement 7 (`hive/agents/god/CONTRAST-STANDARD.md`) — a page-wide
 * contrast sweep, built on `contrast.ts`'s existing dense-grid pixel
 * sampler rather than a DOM ancestor-walker (see that file and
 * `hive/agents/jim-mv09alb5/priority7-contrast-ci-approach-2026-10-16.md`
 * for why: composited pixels are the ground truth, and the sampler already
 * solves the "background sits several ancestors up" case by construction).
 *
 * THREE REPORTING BUCKETS, NOT TWO — approved by god 2026-10-16: PASS, FAIL,
 * and AMBIGUOUS (low `dominantShare` — a gradient, image, or glass/blur
 * edge under the element, common on this platform's Liquid Glass theme, not
 * rare). An ambiguous reading is never folded into PASS; that would be the
 * exact "0 violations because nothing matched" false-clean this standard's
 * acceptance criterion calls out, one level finer (per-element instead of
 * per-selector).
 *
 * BORDER-ONLY ESSENTIAL GRAPHICS (checkbox/radio/toggle outlines) ARE NOT
 * MEASURED HERE, ON PURPOSE — the grid samples fractional INTERIOR points
 * only (stays clear of border-radius artifacts), so it cannot see a 1-2px
 * border color. Named as a gap in the sweep's own report output
 * (`borderOnlyNotMeasured: true`), not silently dropped — requirement 5
 * covers these at 3:1 and this is a real uncovered class under a standard
 * whose acceptance criterion demands honest unverified-coverage reporting.
 *
 * ICON READINGS ARE EXPERIMENTAL AND REPORTED IN THEIR OWN BUCKET, SEPARATE
 * FROM TEXT — the method (sample the element's own dense grid, take the
 * two most common color clusters, treat the second as the icon's own ink)
 * is new and unproven, unlike the text method, which just reads CSS
 * `color`. Kept apart so an unproven technique cannot contaminate the
 * numbers everyone trusts for text.
 */

export const WCAG_NORMAL_TEXT_MIN_RATIO = 4.5;
export const WCAG_LARGE_TEXT_MIN_RATIO = 3;
export const WCAG_ICON_MIN_RATIO = 3;

// WCAG's own "large text" definition: >=18pt (24px) regular, or >=14pt
// (~18.66px) bold — applied as literal numbers inside discoverElements'
// page.evaluate() below, not as a reference to a module-level constant: a
// page.evaluate callback is stringified and run in the browser, so it
// cannot close over a Node-side const without explicitly passing it through
// the function's own argument object (as `box` already is) — a bare
// reference here would throw a ReferenceError in the browser, not warn at
// compile time.

/**
 * Ambiguity cutoff for `dominantShare` below which a reading is reported as
 * AMBIGUOUS rather than scored PASS/FAIL. Calibrated against three real
 * readings on the local seeded dev stack, logged in as SUPER_ADMIN,
 * `/dashboard` under the Liquid Glass theme (2026-10-16):
 *   - Heading text inside a `<Card>` (solid raised fill): share 0.78
 *   - PageHeader title, rendered directly on the `.bml-mural` gradient
 *     background (no card wrapper): share 0.17
 *   - PageHeader eyebrow, same mural background, smaller text: share 0.22
 * A real, wide gap between the one confident/solid reading (0.78) and the
 * two genuinely-ambiguous mural readings (0.17-0.22) — 0.5 sits in the
 * middle of that observed gap, not picked blind. Three samples is a small
 * n; if a future real page lands a confident reading below ~0.6 or an
 * ambiguous one above ~0.4, that's new evidence to revisit this cutoff
 * against, not a reason to silently widen the gap assumption further.
 */
export const AMBIGUOUS_DOMINANT_SHARE_CUTOFF = 0.5;

export interface SweepTextElement {
  kind: 'text';
  tag: string;
  accessibleRole: string | null;
  accessibleName: string | null;
  textSnippet: string;
  isLargeText: boolean;
  box: { x: number; y: number; width: number; height: number };
}

export interface SweepIconElement {
  kind: 'icon';
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
  icon: SweepBucket<SweepIconElement> & { measuredCount: number };
  borderOnlyNotMeasured: true;
}

/**
 * Finds every visible text leaf and every visible icon on the page,
 * excluding `aria-hidden="true"` subtrees (an existing, real convention —
 * 76 files use it today), `data-contrast-exempt="decorative"` subtrees (the
 * one new, explicit, per-element opt-out this check introduces — never a
 * class- or ancestor-based blanket escape), and `sr-only` text (screen-
 * reader-only content legitimately has no visual box). Disabled
 * controls/text are found but flagged, not dropped at discovery — WCAG's
 * own inactive-component exception applies to the SCORE, and the sweep
 * reports how many it excluded for that reason rather than silently
 * shrinking the count.
 */
type DiscoveredText = SweepTextElement & { disabled: boolean };

async function discoverElements(page: Page): Promise<{ text: DiscoveredText[]; icon: SweepIconElement[] }> {
  return page.evaluate(() => {
    const NON_TEXT_TAGS = new Set(['SCRIPT', 'STYLE', 'SVG', 'PATH', 'CIRCLE', 'RECT', 'NOSCRIPT']);

    function isExempt(el: Element): boolean {
      return !!el.closest('[aria-hidden="true"], [data-contrast-exempt="decorative"]');
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

    const textOut: Array<{
      kind: 'text';
      tag: string;
      accessibleRole: string | null;
      accessibleName: string | null;
      textSnippet: string;
      isLargeText: boolean;
      box: { x: number; y: number; width: number; height: number };
      disabled: boolean;
    }> = [];
    const iconOut: Array<{
      kind: 'icon';
      tag: string;
      accessibleRole: string | null;
      accessibleName: string | null;
      box: { x: number; y: number; width: number; height: number };
    }> = [];

    for (const el of document.body.querySelectorAll('*')) {
      if (isExempt(el)) continue;

      // Icons: svg / [role=img], counted once at the outer element — never
      // descend into an svg's own <path>/<circle> children as separate
      // candidates.
      if ((el.tagName === 'SVG' || el.getAttribute('role') === 'img') && !el.closest('svg svg')) {
        if (el.tagName !== 'SVG' && el.closest('svg')) continue; // a [role=img] nested inside an svg we already counted
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const box = el.getBoundingClientRect();
        if (box.width < 2 || box.height < 2) continue;
        iconOut.push({
          kind: 'icon',
          tag: el.tagName,
          accessibleRole: accessibleRoleOf(el),
          accessibleName: accessibleNameOf(el, null),
          box: { x: box.x, y: box.y, width: box.width, height: box.height },
        });
        continue;
      }

      if (el.children.length !== 0) continue; // leaf elements only, same as zeroWidthTextFindings
      const text = (el.textContent || '').trim();
      if (!text) continue;
      if (NON_TEXT_TAGS.has(el.tagName)) continue;
      if (el.classList.contains('sr-only')) continue;

      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;

      const box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue; // a genuinely invisible render is a different defect class (zeroWidthTextFindings), not this check's job

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
      });
    }

    return { text: textOut, icon: iconOut };
  });
}

/**
 * Runs the full sweep against the page's CURRENT state (navigate, log in,
 * and settle the page before calling this — same determinism prerequisites
 * as the pixel-baseline suite, minus the screenshot-diff-specific ones).
 * One screenshot, one decode, every element sampled against it.
 */
export async function sweepContrast(page: Page, ambiguousShareCutoff: number = AMBIGUOUS_DOMINANT_SHARE_CUTOFF): Promise<SweepResult> {
  const { text: textCandidates, icon: iconCandidates } = await discoverElements(page);

  const disabled = textCandidates.filter((t) => t.disabled);
  const measurableText = textCandidates.filter((t) => !t.disabled);

  const sampler = await openPixelSampler(page);
  try {
    const textBucket: SweepBucket<SweepTextElement> = { pass: [], fail: [], ambiguous: [] };
    for (const t of measurableText) {
      const fgColor = await page.evaluate(
        ({ x, y, width, height }) => {
          const el = document.elementFromPoint(x + width / 2, y + height / 2);
          return el ? getComputedStyle(el).color : null;
        },
        t.box,
      );
      if (!fgColor) continue;
      const fg = parseRgbLocal(fgColor);
      if (!fg) continue;

      const { rgb: bg, share } = await sampler.sampleDominant(t.box);
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
      };
      const reading: SweepReading<SweepTextElement> = { element, ratio, dominantShare: share, foreground: fg, dominantBackground: bg, requiredRatio };
      if (share < ambiguousShareCutoff) textBucket.ambiguous.push(reading);
      else if (ratio < requiredRatio) textBucket.fail.push(reading);
      else textBucket.pass.push(reading);
    }

    const iconBucket: SweepBucket<SweepIconElement> = { pass: [], fail: [], ambiguous: [] };
    for (const ic of iconCandidates) {
      const clusters = await sampler.sampleClustersOrdered(ic.box);
      if (clusters.length === 0) continue;
      const bg = clusters[0]!.rgb;
      const share = clusters[0]!.share;
      // Second-most-common cluster as the icon's own ink -- unproven
      // extension, see file header. A single-cluster icon (no second
      // color at all) means the icon's own fill IS the dominant cluster --
      // reported as a direct self-contrast reading (ratio 1.0) rather than
      // skipped, because an icon indistinguishable from its own background
      // is itself a real finding, not a measurement gap.
      const fg = clusters[1]?.rgb ?? bg;
      const ratio = Math.round(contrastRatioOf(fg, bg) * 100) / 100;
      const element: SweepIconElement = { kind: 'icon', tag: ic.tag, accessibleRole: ic.accessibleRole, accessibleName: ic.accessibleName, box: ic.box };
      const reading: SweepReading<SweepIconElement> = { element, ratio, dominantShare: share, foreground: fg, dominantBackground: bg, requiredRatio: WCAG_ICON_MIN_RATIO };
      if (share < ambiguousShareCutoff) iconBucket.ambiguous.push(reading);
      else if (ratio < WCAG_ICON_MIN_RATIO) iconBucket.fail.push(reading);
      else iconBucket.pass.push(reading);
    }

    return {
      text: { ...textBucket, excludedDisabledCount: disabled.length, measuredCount: measurableText.length },
      icon: { ...iconBucket, measuredCount: iconCandidates.length },
      borderOnlyNotMeasured: true,
    };
  } finally {
    await sampler.close();
  }
}

function parseRgbLocal(css: string): RGB | null {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m || m[1] === undefined) return null;
  const [r, g, b] = m[1].split(',').map((n) => parseFloat(n));
  if (r === undefined || g === undefined || b === undefined) return null;
  return { r, g, b };
}

/**
 * Prints the honesty-first report line every page/role/viewport run needs
 * in job output per the owner's "unverified coverage must be reported
 * honestly" acceptance criterion -- counts first, buckets second, the named
 * uncovered class last, always, not just on failure.
 */
export function formatSweepReport(label: string, result: SweepResult): string {
  const lines = [
    `[contrast] ${label}`,
    `  text: measured=${result.text.measuredCount} pass=${result.text.pass.length} fail=${result.text.fail.length} ambiguous=${result.text.ambiguous.length} excludedDisabled=${result.text.excludedDisabledCount}`,
    `  icon (EXPERIMENTAL METHOD): measured=${result.icon.measuredCount} pass=${result.icon.pass.length} fail=${result.icon.fail.length} ambiguous=${result.icon.ambiguous.length}`,
    `  border-only essential graphics: NOT MEASURED`,
  ];
  return lines.join('\n');
}

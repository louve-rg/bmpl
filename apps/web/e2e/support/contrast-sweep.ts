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
 *
 * COMPOSITE GRAPHICS GET THEIR OWN NAMED BUCKET, NEVER A SCORED READING —
 * found live (2026-10-21): admin's daily-sales chart wraps a bar row AND a
 * separate orders-strip row in ONE `role="img"` element
 * (apps/admin/app/dashboard/analytics/page.tsx:293), so the icon branch
 * sampled the whole chart region, not a bar. With little data the fill
 * occupies a small fraction of that box, the grid lands mostly on
 * background, both color clusters resolve to the same value, and the
 * two-color icon-ink method above reports a confident, wrong ratio=1 --
 * "fg equals bg" read as "this icon has no contrast" instead of "this
 * region isn't a single fg/bg pair at all." `isCompositeGraphic` below is
 * a STRUCTURAL test, not a size cutoff deliberately: the distinguishing
 * property of a composite is that it contains OTHER rendered content with
 * its own fill (bars, strips), where a real icon is a leaf. A real
 * <svg>'s path/circle children paint via the `fill`/`stroke` SVG
 * attributes, not CSS `background-color` or `background-image`, so this
 * test is sourced in DOM structure rather than a chosen pixel constant —
 * it would classify the same $22 chart correctly even if it rendered
 * small. Composite elements are discovered, counted, and reported, but
 * never sampled or scored PASS/FAIL/AMBIGUOUS — "this graphic cannot be
 * measured as one color pair" is itself the honest finding.
 *
 * KNOWN GAP IN THIS TEST, found live (2026-10-21) before it caused a wrong
 * reading anywhere: `hasOwnFillDescendant` only detects a CSS-PAINTED
 * composite (a descendant with its own `background-color`/`background-
 * image`), not an SVG-PAINTED one. `components/reviews/StarRating.tsx`
 * is exactly that case the principle above covers but this test does not
 * — a `role="img"` span wrapping five `<Star>` SVGs, each painted via
 * `fill`/`clipPath` with no CSS background anywhere, so the whole span
 * would be sampled as one leaf icon, the same aggregate-over-a-container
 * error this bucket exists to catch, through the one door this test
 * doesn't cover. Not live today — StarRating is never rendered on either
 * currently-swept route — but it becomes live the moment route expansion
 * reaches reviews, products, or storefront, and the composite test must
 * be widened to cover SVG composites BEFORE any of those routes is added,
 * not discovered after by a silent wrong ratio.
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
type DiscoveredIcon = SweepIconElement & { composite: boolean };

async function discoverElements(page: Page): Promise<{ text: DiscoveredText[]; icon: DiscoveredIcon[] }> {
  return page.evaluate(() => {
    const NON_TEXT_TAGS = new Set(['SCRIPT', 'STYLE', 'SVG', 'PATH', 'CIRCLE', 'RECT', 'NOSCRIPT']);

    function isExempt(el: Element): boolean {
      return !!el.closest('[aria-hidden="true"], [data-contrast-exempt="decorative"]');
    }

    // Structural composite-graphic test -- see this file's header comment
    // for why this is a DOM-structure check, not a size cutoff. A real
    // icon's descendants (svg path/circle/etc) paint via `fill`/`stroke`,
    // never CSS background -- so this is false for every genuine icon and
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

    // Cluster F root cause, found live (god, 2026-10-21, same session as the
    // `clusterAt` KNOWN LIMITATION in contrast.ts): a closed native
    // `<details>` preserves its non-summary content's LAYOUT BOX (a
    // content-visibility-style skip-paint, not `display: none`) --
    // getBoundingClientRect() on a link inside Header.tsx's desktop
    // dropdown panel or CategoryNav.tsx's mobile disclosure returns a real,
    // non-zero box while the `<details>` is closed and nothing is actually
    // painted there. The sampler then reads whatever full-page-screenshot
    // pixel IS there (the page behind it) and reports that as the
    // element's background -- a real box with no real paint, not a
    // measurement of the element at all. This is EXACT, not probabilistic:
    // a `<details>` element's `open` attribute is a boolean DOM fact, so
    // there is no "maybe" case a fail-closed default would need to guard --
    // either an ancestor is a closed `<details>` and this element is not
    // inside its always-rendered `<summary>`, or it isn't, with nothing in
    // between. Explains both Cluster F instances with one mechanism: the
    // main-nav links are Header.tsx's desktop `<details>` group panels
    // (closed by default); the category links are CategoryNav.tsx's mobile
    // `<details>` disclosure (also closed by default) -- the SAME
    // CategoryLinks() markup rendered a second time in the desktop
    // `<aside>`, which is excluded correctly already by the box.width<2
    // guard below whenever Tailwind's `hidden`/`md:block` makes IT the
    // zero-box copy instead.
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

      if (el.children.length !== 0) continue; // leaf elements only, same as zeroWidthTextFindings
      const text = (el.textContent || '').trim();
      if (!text) continue;
      if (NON_TEXT_TAGS.has(el.tagName)) continue;
      if (el.classList.contains('sr-only')) continue;

      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;

      const box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue; // a genuinely invisible render is a different defect class (zeroWidthTextFindings), not this check's job
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
      // Foreground color is read during discovery (t.color), not via a
      // document.elementFromPoint lookup here -- found live (2026-10-21, PR
      // #469): elementFromPoint only resolves points inside the CURRENTLY
      // RENDERED viewport. Any element below the first screenful returned
      // null, which this loop used to silently `continue` past -- counted in
      // measuredCount, never scored in any bucket, no error. That is how
      // "By revenue" (and 7 other elements the same run) vanished without a
      // trace instead of landing in fail or ambiguous.
      const fg = parseRgbLocal(t.color);
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
    `  icon (EXPERIMENTAL METHOD): measured=${result.icon.measuredCount} pass=${result.icon.pass.length} fail=${result.icon.fail.length} ambiguous=${result.icon.ambiguous.length} compositeNotMeasured=${result.icon.compositeGraphics.length}`,
    `  border-only essential graphics: NOT MEASURED`,
  ];
  if (result.icon.compositeGraphics.length > 0) {
    lines.push(`  composite graphics (contains its own filled content, not a single fg/bg pair -- NOT MEASURED, not silently dropped):`);
    for (const g of result.icon.compositeGraphics) {
      lines.push(`    - role=${g.accessibleRole ?? '(none)'} name="${g.accessibleName ?? '(none)'}"`);
    }
  }
  // NAMED, same treatment as compositeGraphics above, and for the same
  // reason (god, 2026-10-21): low dominantShare means "sits on a
  // composite/glass surface, cannot resolve a single background colour" --
  // this file's own earlier header comment already said so. The ratchet
  // (contrast-ratchet.ts) deliberately never scores these into a build
  // failure any more -- 4 of 4 independently hand-verified ambiguous
  // readings this run turned out to be artifacts of the glass surface, not
  // real violations (Dwight, 2026-10-21).
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

/**
 * One-shot falsifiable check for the `.bmpl-eyebrow` / `--bmpl-accent`
 * defect (god, 2026-10-21): the sweep's ratio alone is consistent with
 * "#0ea5e9 text on a near-white background" but does not prove it -- an
 * actual rgb(14, 165, 233) reading does, and if the foreground comes back
 * as something else the whole account of this defect is wrong regardless
 * of the ratio. Reads the FIRST `.bmpl-eyebrow` match only (not every one)
 * -- this answers one specific prediction, it is not a new detection
 * mechanism and not a general-purpose instrument like `sweepContrast`.
 */
export async function measureFirstEyebrowForeground(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.querySelector('.bmpl-eyebrow');
    return el ? getComputedStyle(el).color : null;
  });
}

/**
 * Same one-shot method, pointed at a different question (god, 2026-10-21):
 * MDF-357's store-preview sweep reports TWO readings sharing the accessible
 * name "uat-vendor@bzemarketplace.com" (one outright pass, one ambiguous-
 * would-pass) at very different ratios -- which one is the hardcoded
 * `text-slate-600` line (the actual MDF-357 defect element, predicted
 * rgb(71, 85, 105)) and which is some other, token-driven instance of the
 * same text is not knowable from the ratio alone. Finds every LEAF element
 * (no children) whose trimmed text content exactly matches `text` and
 * returns each one's computed foreground colour, in DOM order.
 */
export async function measureForegroundColorsByText(page: Page, text: string): Promise<string[]> {
  return page.evaluate((target) => {
    const matches = Array.from(document.querySelectorAll('*')).filter(
      (el) => el.children.length === 0 && el.textContent?.trim() === target,
    );
    return matches.map((el) => getComputedStyle(el).color);
  }, text);
}

/**
 * Same method, pointed at the element's OWN declared background rather than
 * its foreground (god, 2026-10-21, the ONE sanctioned exception to "no new
 * instrument work" tonight -- two selectors, existing machinery). Settles
 * finding #1 (desktop header nav links reading ratio ~1.05-1.22): back-
 * solving the measured ratio against `text-blue-100` (#dbeafe) implies the
 * sampler resolved a background at or indistinguishable from pure white, not
 * `bg-belize-navy/95` -- which means the LINK ITSELF may be painting a
 * background over the header's navy locally. This reads that directly,
 * rather than inferring it from the ratio a second time.
 */
export async function measureBackgroundColorsByText(page: Page, text: string): Promise<string[]> {
  return page.evaluate((target) => {
    const matches = Array.from(document.querySelectorAll('*')).filter(
      (el) => el.children.length === 0 && el.textContent?.trim() === target,
    );
    return matches.map((el) => getComputedStyle(el).backgroundColor);
  }, text);
}

/**
 * Third and narrowest exception (god, 2026-10-21): `discoverElements` below
 * already skips any text leaf whose `getBoundingClientRect()` is under 2px
 * in either dimension (see its own `box.width < 2 || box.height < 2` guard)
 * -- a descendant of a `display:none` ancestor (e.g. inside a closed
 * `<details>`) gets an all-zero rect regardless of its own declared
 * `display`, so that guard should already have kept these two elements out
 * of the sweep entirely. They were reported in the FAIL bucket with real
 * ratios anyway. This answers which half of that contradiction is true:
 * zero box -> the existing guard is somehow being bypassed (a discovery
 * bug); non-zero box -> the element really was rendered, and the open
 * question moves to what pixel `clusterAt` sampled there, not whether the
 * element existed. Same leaf-selection rule as `discoverElements` and the
 * two colour prints above, so this measures the identical node.
 */
export async function measureBoxSizeByText(page: Page, text: string): Promise<Array<{ width: number; height: number }>> {
  return page.evaluate((target) => {
    const matches = Array.from(document.querySelectorAll('*')).filter(
      (el) => el.children.length === 0 && el.textContent?.trim() === target,
    );
    return matches.map((el) => {
      const box = el.getBoundingClientRect();
      return { width: box.width, height: box.height };
    });
  }, text);
}

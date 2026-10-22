import type { Locator, Page } from '@playwright/test';

/**
 * Real-pixel contrast sampling, turned into a reusable assertion from a
 * one-off script: hive/agents/bmpl-qa-mtmcz0m1/liquid-glass-verify/
 * targeted-contrast-recheck.js (Dwight, 2026-10-16, during the Liquid Glass
 * gate-4 contrast review). Ported deliberately rather than reinvented —
 * CLAUDE.md §12 — so this suite and Dwight's own ad-hoc checks measure
 * contrast the same way instead of two different ways that could disagree.
 *
 * WHY A DENSE GRID OVER THE DOMINANT COLOR, NOT A SINGLE PIXEL OR A NAIVE
 * "FURTHEST FROM FOREGROUND" READING — both were tried on this floor
 * tonight and both produced false readings: a single corner/center sample
 * can land on a glyph stroke or an anti-aliased edge; "furthest from fg"
 * picks whichever sampled pixel happens to differ most, which a single
 * stray glyph-stroke pixel can win outright. Sampling a fractional interior
 * grid (constant POINT COUNT regardless of element size — pixel-additive
 * step sizes degenerate to one point on small chips/badges, exactly the
 * elements most at risk here) and clustering by rounded color to find the
 * fill that actually dominates the element's own box is what survives both
 * failure modes.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface ContrastReading {
  /** WCAG 2.x contrast ratio between the declared foreground color and the sampled dominant background. */
  ratio: number;
  /** The foreground actually used for `ratio` — alpha-composited over `dominantBackground` when the declared color was translucent, so it always matches what `ratio` was computed from. */
  foreground: RGB;
  dominantBackground: RGB;
  /** 0..1 — the fraction of sampled grid points that matched the dominant color. Low means an ambiguous read (gradient, image, glass edge) — check by eye before trusting the ratio. */
  dominantShare: number;
  /** 0..1 — the fraction of the grid that fell outside the sampler's own canvas before clamping. High means the box does not correspond to anything actually rendered where it was sampled (e.g. clipped by a scrolling ancestor's overflow) — a different failure from a low `dominantShare`, and the stronger of the two reasons not to trust `ratio`. */
  outOfBoundsShare: number;
}

export const WCAG_AA_NORMAL_TEXT_MIN_RATIO = 4.5;

function parseRgb(css: string): { rgb: RGB; alpha: number } | null {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m || m[1] === undefined) return null;
  const [r, g, b, a] = m[1].split(',').map((n) => parseFloat(n));
  if (r === undefined || g === undefined || b === undefined) return null;
  return { rgb: { r, g, b }, alpha: a === undefined ? 1 : a };
}

/**
 * Alpha-composites a translucent foreground over the real sampled
 * background pixel it is painted on, so the ratio below is computed from
 * the glyph's actual rendered color, not the declared `color` value taken
 * at face value. Found live (2026-10-21, god/Oscar): `parseRgb` used to
 * discard a `rgba()` foreground's alpha entirely, so e.g. `text-white/80`
 * was scored as if fully opaque — always overstating the ratio, since a
 * translucent foreground blended with its background can only sit between
 * the two extremes, never past the opaque foreground's own ratio. The
 * background side of this was already correct (it's a sampled real pixel,
 * never a declared color), which is why this went unnoticed on every node
 * whose text happens to be fully opaque — nearly all of them.
 */
export function compositeOver(fg: RGB, alpha: number, bg: RGB): RGB {
  if (alpha >= 1) return fg;
  return {
    r: alpha * fg.r + (1 - alpha) * bg.r,
    g: alpha * fg.g + (1 - alpha) * bg.g,
    b: alpha * fg.b + (1 - alpha) * bg.b,
  };
}

function relativeLuminance({ r, g, b }: RGB): number {
  const [sr, sg, sb] = [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))) as [
    number,
    number,
    number,
  ];
  return 0.2126 * sr + 0.7152 * sg + 0.0722 * sb;
}

export function contrastRatioOf(fg: RGB, bg: RGB): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * Decodes one full-page screenshot once and lets the caller sample the
 * dominant background fill under as many element boxes as it needs against
 * that single decode — the piece Phase 1's `sampleContrast(locator)` didn't
 * need (it only ever samples one hand-picked locator) but a requirement-7
 * sweep does: a page with dozens of measured text/icon elements would
 * otherwise take one full-page screenshot AND one decode per element.
 *
 * `sampleDominant` returns the SAME dense-grid dominant-color-cluster read
 * `sampleContrast` always has — fractional interior grid (6x3), clustered by
 * rounded color — just reusable across many boxes instead of one.
 */
export interface SampleOptions {
  /**
   * True when the element (or an ancestor) is `position: fixed` -- see
   * `openPixelSampler`'s own comment on `ensureViewportSampler` for why
   * this needs an entirely different screenshot, not just a coordinate
   * offset. Defaults to false: a true no-op for every caller that doesn't
   * know or doesn't care, same convention as the scrollOffset fix above.
   */
  fixedPosition?: boolean;
}

export interface PixelSampler {
  /** `outOfBoundsShare` (0..1): the fraction of the 18-point grid that fell outside this sampler's own canvas before clamping -- see `clusterAt`'s own comment. High means the box does not correspond to anything actually rendered here; the caller should refuse to trust the color, not just the share. */
  sampleDominant(box: { x: number; y: number; width: number; height: number }, opts?: SampleOptions): Promise<{ rgb: RGB; share: number; outOfBoundsShare: number }>;
  /** Every color cluster found in the grid, sorted most-common first, plus `outOfBoundsShare` (see `sampleDominant`) as a property on the returned array. Used by the icon sweep (contrast-sweep.ts) to take the second-most-common cluster as an icon's own ink, distinct from its background fill. */
  sampleClustersOrdered(box: { x: number; y: number; width: number; height: number }, opts?: SampleOptions): Promise<Array<{ rgb: RGB; share: number }> & { outOfBoundsShare: number }>;
  close(): Promise<void>;
}

export async function openPixelSampler(page: Page): Promise<PixelSampler> {
  // { fullPage: true } is load-bearing, not decoration -- found live
  // (2026-10-21, PR #469's first real run): a bare page.screenshot() only
  // captures the current viewport, but every box this sampler is handed
  // comes from getBoundingClientRect(), which is ALWAYS relative to the top
  // of the full document when scrollY is 0 (true here -- discovery runs
  // right after page.goto with no manual scroll). That scrollY=0 assumption
  // was documented but not ENFORCED -- a 2026-10-22 live bug (MDF-376) found
  // a wrong-but-confident reading the moment a caller scrolled before
  // sampling. See the scrollOffset capture right below: it makes a scrolled
  // box correct instead of merely asserting it never happens. Without fullPage, any
  // element below the first screenful decoded against a short, viewport-only
  // image, and clusterAt's own clamping (Math.min(canvas.height - 1, ...))
  // silently read the image's BOTTOM EDGE instead of that element's real
  // background -- a wrong answer, not a thrown error. Combined with the
  // elementFromPoint fix in contrast-sweep.ts (same root cause, the
  // foreground half), this is why "By revenue" went completely unmeasured
  // rather than merely ambiguous on admin's first live run.
  const fullPageBuffer = await page.screenshot({ fullPage: true });
  // Found live (frontend owner/god, 2026-10-22, MDF-376): `{ fullPage: true }`
  // captures the FULL DOCUMENT regardless of current scroll position (CDP
  // renders beyond the viewport without physically scrolling), so pixel
  // (0,0) in the decoded image is always the document's top-left -- but
  // every box this sampler is handed comes from `getBoundingClientRect()`
  // or Playwright's `boundingBox()`, which are VIEWPORT-relative at
  // whatever scroll position was current when they were read. The two
  // coordinate systems agree only when scrollY/scrollX are 0 at that
  // moment -- true for every CALLER IN THIS REPO TODAY (discoverElements
  // below never scrolls; confirmed by grep, zero `scroll` occurrences in
  // either app's contrast-sweep.ts or contrast spec files) but not
  // guaranteed for a future caller, and `sampleContrast`'s own single-
  // locator convenience wrapper calls `locator.boundingBox()`, which can
  // trigger an auto-scroll-into-view as a side effect. Capturing the
  // scroll offset here, right alongside the screenshot it describes, and
  // adding it to every sampled box below converts a viewport-relative box
  // into the screenshot's own document-absolute space -- correct whether
  // or not the page is scrolled, and a true no-op (offset 0,0) for every
  // existing caller, which never scrolls.
  const scrollOffset = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));

  /** Decodes one PNG onto a fresh blank page's `<canvas>`, shared by the eager fullPage setup below and the lazy viewport sampler. */
  async function createCanvasPage(pngBase64: string): Promise<Page> {
    const canvasPage = await page.context().newPage();
    await canvasPage.setContent('<img id="shot" /><canvas id="cv"></canvas>');
    await canvasPage.evaluate((base64) => {
      const img = document.getElementById('shot') as HTMLImageElement;
      img.src = `data:image/png;base64,${base64}`;
    }, pngBase64);
    await canvasPage.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const img = document.getElementById('shot') as HTMLImageElement;
          const finish = () => {
            const canvas = document.getElementById('cv') as HTMLCanvasElement;
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            canvas.getContext('2d')!.drawImage(img, 0, 0);
            resolve();
          };
          if (img.complete && img.naturalWidth > 0) finish();
          else img.onload = finish;
        }),
    );
    return canvasPage;
  }

  const sampler = await createCanvasPage(fullPageBuffer.toString('base64'));

  // Lazy, created only on the first fixed-position request -- most pages
  // have none, and this is a second screenshot + decode. Found live
  // (frontend owner/god, 2026-10-22, MDF-376, FullScreenMapModal): a
  // `position: fixed` element (here, the map modal's own `fixed inset-0`
  // shell) is sized and positioned relative to the VIEWPORT, but `{
  // fullPage: true }` makes Chromium render the page as if the viewport
  // were resized to the full document height for that one capture --
  // `boundingBox()` still reports the element's real, small-viewport rect,
  // but in the fullPage image that same fixed element is laid out relative
  // to a viewport many times taller, so anything positioned within it by
  // percentage, flex-grow, or distance-from-an-edge (a bottom action bar, a
  // vertically centered body) ends up at a DIFFERENT pixel row in the
  // fullPage image than where it is actually drawn on screen. This is not
  // a coordinate OFFSET like the scrollX/Y fix above -- there is no single
  // number that converts one into the other, because the two renderings of
  // the same fixed element are different SIZES. The only correct fix is to
  // sample a plain, viewport-only screenshot for fixed-position content:
  // its pixel (0,0) is the real viewport's top-left, exactly what
  // `boundingBox()`/`getBoundingClientRect()` are already relative to, so
  // no offset is needed at all -- offset {0,0} below is exact, not a
  // default.
  let viewportSamplerPage: Page | null = null;
  async function ensureViewportSampler(): Promise<Page> {
    if (!viewportSamplerPage) {
      const viewportBuffer = await page.screenshot({ fullPage: false });
      viewportSamplerPage = await createCanvasPage(viewportBuffer.toString('base64'));
    }
    return viewportSamplerPage;
  }

  /**
   * RESOLVED (god, 2026-10-21, same requirement-7 thread) for both worked
   * examples below: root-caused to a closed native `<details>` preserving
   * its content's layout box while painting nothing -- see
   * `isInsideClosedDetails` in contrast-sweep.ts's `discoverElements`,
   * which now excludes that content at discovery time, the same tier as
   * the existing zero-geometry guard. This comment's forensic record below
   * is kept because the underlying LIMITATION of `clusterAt` itself is
   * still real -- it still reports the topmost painted pixel, not
   * necessarily an element's own background -- the fix above only removes
   * the one DISCOVERABLE class of false-positive this specific limitation
   * was producing (real-but-unpainted boxes). A different cause could
   * still produce the same symptom and would not be caught by this guard.
   *
   * KNOWN LIMITATION (god + Dwight + Oscar, 2026-10-21, requirement 7):
   * `clusterAt` pixel-samples a composited screenshot at an element's
   * computed box coordinates. It therefore reports the TOPMOST PAINTED
   * PIXEL at those coordinates, which is NOT always that element's own
   * background. An element can be laid out with a real, non-zero box while
   * something else is painted over it, or while its own surface is not
   * painted at all and the page shows through.
   *
   * Two worked examples from one live run (products.spec.ts, route
   * `/products`, run 39552489306 @ `0c56037`), both still red:
   *   - `role=link name="Become a Marketplace Vendor"` @1440px: rendered
   *     box 208x56 (real, non-zero), ratio 1.17 against its own
   *     `text-blue-100`. The foreground's luminance back-solves to a
   *     background around L=0.957 -- indistinguishable from the page's own
   *     `bg-slate-50` canvas (L=0.9536, which computes to 1.1661), not the
   *     element's actual ancestor (`bg-belize-navy`, which computes to
   *     ~7.85:1 against the same foreground).
   *   - `role=link name="Camping & Hiking"` @375px: TWO leaf matches, one
   *     325x40 (real) and one 0x0 (correctly excluded by the box.width<2/
   *     height<2 guard in contrast-sweep.ts's `discoverElements` -- that
   *     guard is working correctly here, it simply does not govern the
   *     other match). The real one reads ratio 3.75 against its own
   *     `text-slate-600`; the foreground's luminance back-solves to a
   *     background around L=0.4696 (~#b6b6b6), which matches neither the
   *     element's own declared surface nor anything else in its cascade.
   *
   * Five independent instruments agree this is a sampler artifact, not a
   * real defect, for both elements above: (1) both boxes are real and
   * non-zero, so discovery is not being bypassed; (2) both back-solved
   * backgrounds fail to match the sampled element's own declared surface;
   * (3) a live CDP `CSS.getMatchedStylesForNode` dump on the category
   * link's ancestor returned `rgb(255, 255, 255)`, the correct resting
   * colour; (4) screenshots of both dropdown panels while genuinely
   * OPENED show solid navy with crisp, legible white text; (5) an
   * independent hand computation from source gives ~14:1 for the nav
   * link's real contrast. WHY the sampler reads a different pixel than the
   * element's own surface in either specific case -- a scrim, an overlay,
   * z-order, paint timing -- is NOT established; do not read this note as
   * confirming one.
   *
   * This is a narrow limitation, not a reason to distrust the sweep: the
   * same dense-grid method caught a genuine, previously-unnoticed defect
   * the same night (#480, `text-belize-light` on the header's real 80%-
   * alpha-navy composite, measured 3.767:1 against a hand computation of
   * 3.767:1 to the thousandth), and separately confirmed a merged fix live
   * (#479's `--bmpl-accent` replacement reading exactly as predicted at
   * every width). The tool is right far more often than it is wrong; this
   * note names where it is wrong and why, so a reviewer who hits it again
   * does not have to re-derive any of the above.
   */
  async function clusterAt(
    samplerPage: Page,
    box: { x: number; y: number; width: number; height: number },
    offset: { x: number; y: number },
  ): Promise<{ clusters: Array<{ rgb: RGB; count: number; total: number }>; outOfBoundsShare: number }> {
    const { pts: grid, outOfBounds } = await samplerPage.evaluate(({ rect, offset }) => {
      const canvas = document.getElementById('cv') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      const pts: { r: number; g: number; b: number }[] = [];
      let outOfBounds = 0;
      // Fractional interior grid (6x3 points), not pixel-additive — keeps
      // point count constant regardless of element size, and stays 2px+
      // inside each edge to avoid border-radius artifacts.
      const fxs = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9];
      const fys = [0.2, 0.5, 0.8];
      // `offset` converts `rect` (viewport-relative) into this screenshot's
      // document-absolute space -- see openPixelSampler's own comment.
      for (const fx of fxs) {
        for (const fy of fys) {
          const rawX = rect.x + offset.x + fx * rect.width;
          const rawY = rect.y + offset.y + fy * rect.height;
          // Found live (god/frontend owner, 2026-10-22, MDF-376, the
          // dispatch list table's `overflow-x-auto`): an element clipped
          // away by a scrolling ANCESTOR's own overflow still returns a
          // real, non-zero `getBoundingClientRect()` -- the browser
          // reports where the box WOULD be if unclipped, not whether it
          // is actually painted anywhere. Content clipped this way is
          // never rasterized at that position in ANY screenshot, so no
          // coordinate fix can recover it; the only correct move is to
          // know the sample landed outside this canvas at all and say so
          // (see the `OUT_OF_BOUNDS_SHARE_CUTOFF` caller in
          // contrast-sweep.ts). The existing `Math.max`/`Math.min` clamp
          // below still runs after this check -- it has to produce SOME
          // pixel for the clustering math -- but clamping to the nearest
          // edge is exactly how a clipped box used to read a confident,
          // wrong color instead of refusing to answer.
          if (rawX < 0 || rawX >= canvas.width || rawY < 0 || rawY >= canvas.height) outOfBounds += 1;
          const x = Math.max(0, Math.min(canvas.width - 1, Math.round(rawX)));
          const y = Math.max(0, Math.min(canvas.height - 1, Math.round(rawY)));
          const data = ctx.getImageData(x, y, 1, 1).data;
          pts.push({ r: data[0] ?? 0, g: data[1] ?? 0, b: data[2] ?? 0 });
        }
      }
      return { pts, outOfBounds };
    }, { rect: box, offset });

    const counts = new Map<string, { count: number; rgb: RGB }>();
    for (const p of grid) {
      const key = `${Math.round(p.r / 8) * 8},${Math.round(p.g / 8) * 8},${Math.round(p.b / 8) * 8}`;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { count: 1, rgb: p });
    }
    if (counts.size === 0) {
      throw new Error('clusterAt: no pixels sampled -- the grid should always produce at least one point.');
    }
    return {
      clusters: [...counts.values()].sort((a, b) => b.count - a.count).map((c) => ({ rgb: c.rgb, count: c.count, total: grid.length })),
      outOfBoundsShare: Math.round((outOfBounds / grid.length) * 100) / 100,
    };
  }

  async function clustersFor(box: { x: number; y: number; width: number; height: number }, opts?: SampleOptions) {
    if (opts?.fixedPosition) return clusterAt(await ensureViewportSampler(), box, { x: 0, y: 0 });
    return clusterAt(sampler, box, scrollOffset);
  }

  return {
    async sampleDominant(box, opts) {
      const { clusters, outOfBoundsShare } = await clustersFor(box, opts);
      const dominant = clusters[0]!;
      return { rgb: dominant.rgb, share: Math.round((dominant.count / dominant.total) * 100) / 100, outOfBoundsShare };
    },
    async sampleClustersOrdered(box, opts) {
      const { clusters, outOfBoundsShare } = await clustersFor(box, opts);
      const ordered = clusters.map((c) => ({ rgb: c.rgb, share: Math.round((c.count / c.total) * 100) / 100 })) as Array<{ rgb: RGB; share: number }> & {
        outOfBoundsShare: number;
      };
      ordered.outOfBoundsShare = outOfBoundsShare;
      return ordered;
    },
    close: async () => {
      await sampler.close();
      if (viewportSamplerPage) await viewportSamplerPage.close();
    },
  };
}

/**
 * Samples the real rendered pixels behind a single text element and returns
 * its contrast ratio against the dominant background fill. Convenience
 * wrapper over `openPixelSampler` for the one-locator call site — for
 * sampling many elements on the same page, open one sampler and call
 * `sampleDominant` directly instead of calling this in a loop (each call
 * re-screenshots and re-decodes the whole page).
 */
export async function sampleContrast(locator: Locator): Promise<ContrastReading> {
  const page = locator.page();
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('sampleContrast: locator has no visible box — assert visibility before calling this.');
  }

  const fgColor = await locator.evaluate((el) => getComputedStyle(el).color);
  const fgParsed = parseRgb(fgColor);
  if (!fgParsed) {
    throw new Error(`sampleContrast: could not parse foreground color "${fgColor}".`);
  }

  // See openPixelSampler's `ensureViewportSampler` comment for why a
  // position:fixed ancestor needs an entirely different screenshot.
  const fixedPosition = await locator.evaluate((el) => {
    let node: Element | null = el;
    while (node) {
      if (getComputedStyle(node).position === 'fixed') return true;
      node = node.parentElement;
    }
    return false;
  });

  const sampler = await openPixelSampler(page);
  try {
    const { rgb: dominant, share, outOfBoundsShare } = await sampler.sampleDominant(box, { fixedPosition });
    const effectiveFg = compositeOver(fgParsed.rgb, fgParsed.alpha, dominant);
    return {
      ratio: Math.round(contrastRatioOf(effectiveFg, dominant) * 100) / 100,
      foreground: effectiveFg,
      dominantBackground: dominant,
      dominantShare: share,
      outOfBoundsShare,
    };
  } finally {
    await sampler.close();
  }
}

/**
 * One-call assertion for the common case. Throws (rather than returning a
 * boolean) so the failure message carries the actual sampled colors and
 * ratio — exactly what a reviewer needs to judge a visual-diff failure
 * without re-running anything.
 */
export function assertSufficientContrast(reading: ContrastReading, minRatio: number = WCAG_AA_NORMAL_TEXT_MIN_RATIO): void {
  if (reading.outOfBoundsShare > 0.5) {
    throw new Error(
      `sampleContrast: most of the sample grid (${Math.round(reading.outOfBoundsShare * 100)}%) fell outside the screenshot's own canvas — ` +
        `the box does not correspond to anything actually rendered there (e.g. clipped by a scrolling ancestor's overflow). This is not a low-confidence read, it is no read at all; do not trust this ratio.`,
    );
  }
  if (reading.dominantShare < 0.5) {
    throw new Error(
      `sampleContrast: low-confidence background read (dominant fill was only ${Math.round(reading.dominantShare * 100)}% of sampled pixels) — ` +
        `the element may sit over a gradient, image, or a glass/blur edge. Verify by eye before trusting this ratio.`,
    );
  }
  if (reading.ratio < minRatio) {
    throw new Error(
      `Contrast ratio ${reading.ratio} is below the minimum ${minRatio} — ` +
        `foreground rgb(${reading.foreground.r},${reading.foreground.g},${reading.foreground.b}) vs dominant background ` +
        `rgb(${reading.dominantBackground.r},${reading.dominantBackground.g},${reading.dominantBackground.b}), ` +
        `sampled over ${Math.round(reading.dominantShare * 100)}% of the grid.`,
    );
  }
}

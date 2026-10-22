import type { Locator, Page } from '@playwright/test';

/**
 * Real-pixel contrast sampling for apps/admin — identical to
 * apps/web/e2e/support/contrast.ts (itself ported from Dwight's
 * hive/agents/bmpl-qa-mtmcz0m1/liquid-glass-verify/targeted-contrast-recheck.js,
 * 2026-10-16). See that file for the full reasoning on why a dense
 * dominant-color grid, not a single pixel or a naive "furthest from
 * foreground" reading. Duplicated rather than shared for the same reason as
 * visual.ts in this same directory — no shared package exists between the
 * two apps' e2e trees today. Keep in sync by hand if either changes.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface ContrastReading {
  ratio: number;
  /** The foreground actually used for `ratio` — alpha-composited over `dominantBackground` when the declared color was translucent, so it always matches what `ratio` was computed from. */
  foreground: RGB;
  dominantBackground: RGB;
  dominantShare: number;
  /** 0..1 -- see the web copy of this file for the full reasoning. High means the box does not correspond to anything actually rendered where it was sampled. */
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
 * background pixel it is painted on — see the web copy of this file for
 * the full reasoning (the bug this fixes, and why it went unnoticed).
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
 * that single decode — see the web copy of this file for the full reasoning
 * (a requirement-7 sweep measures dozens of elements per page; one decode
 * per element would be wasteful).
 */
export interface SampleOptions {
  /** True when the element (or an ancestor) is `position: fixed` -- see the web copy of this file for the full reasoning. Defaults to false, a true no-op for every caller that doesn't pass it. */
  fixedPosition?: boolean;
}

export interface PixelSampler {
  /** `outOfBoundsShare` -- see the web copy of this file for the full reasoning. */
  sampleDominant(box: { x: number; y: number; width: number; height: number }, opts?: SampleOptions): Promise<{ rgb: RGB; share: number; outOfBoundsShare: number }>;
  /** Every color cluster found in the grid, sorted most-common first, plus `outOfBoundsShare` as a property on the returned array. Used by the icon sweep (contrast-sweep.ts) to take the second-most-common cluster as an icon's own ink, distinct from its background fill. */
  sampleClustersOrdered(box: { x: number; y: number; width: number; height: number }, opts?: SampleOptions): Promise<Array<{ rgb: RGB; share: number }> & { outOfBoundsShare: number }>;
  close(): Promise<void>;
}

export async function openPixelSampler(page: Page): Promise<PixelSampler> {
  // { fullPage: true } is load-bearing, not decoration -- see apps/web's own
  // copy of this file for the full reasoning (found live, 2026-10-21, PR
  // #469: a below-the-fold element decoded against a viewport-only
  // screenshot silently reads the image's bottom edge instead of its real
  // background -- exactly why "By revenue" went completely unmeasured).
  const fullPageBuffer = await page.screenshot({ fullPage: true });
  // Scroll-offset capture -- see apps/web's identical copy of this file for
  // the full reasoning (frontend owner/god, 2026-10-22, MDF-376): fullPage
  // screenshots are document-absolute regardless of current scroll
  // position, but every box this sampler is handed is viewport-relative.
  // Capturing the offset here and adding it to every sampled box converts
  // one into the other -- correct whether or not the page is scrolled, and
  // a true no-op for every existing caller, which never scrolls.
  const scrollOffset = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));

  /** Decodes one PNG onto a fresh blank page's `<canvas>` -- see the web copy of this file for the full reasoning. Shared by the eager fullPage setup below and the lazy viewport sampler. */
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

  // Lazy, created only on the first fixed-position request -- see the web
  // copy of this file for the full reasoning (frontend owner/god,
  // 2026-10-22, MDF-376, FullScreenMapModal): a `position: fixed` element
  // needs a plain viewport-only screenshot, not an offset into the
  // fullPage one, because fullPage renders it at a different SIZE, not
  // just a different position.
  let viewportSamplerPage: Page | null = null;
  async function ensureViewportSampler(): Promise<Page> {
    if (!viewportSamplerPage) {
      const viewportBuffer = await page.screenshot({ fullPage: false });
      viewportSamplerPage = await createCanvasPage(viewportBuffer.toString('base64'));
    }
    return viewportSamplerPage;
  }

  /**
   * KNOWN LIMITATION -- see the web copy of this file (apps/web/e2e/support/
   * contrast.ts) for the full writeup (god + Dwight + Oscar, 2026-10-21,
   * requirement 7): `clusterAt` pixel-samples a composited screenshot at an
   * element's computed box coordinates, so it reports the TOPMOST PAINTED
   * PIXEL there, which is not always that element's own background. An
   * element can have a real, non-zero box while something else is painted
   * over it, or while its own surface is not painted at all and the page
   * shows through. Confirmed narrow, not systemic: the same method caught a
   * genuine defect the same night (#480, measured to the thousandth against
   * a hand computation) and confirmed a merged fix live (#479). Keep in
   * sync by hand if the web copy's writeup changes, same as the rest of
   * this file.
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
      const fxs = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9];
      const fys = [0.2, 0.5, 0.8];
      for (const fx of fxs) {
        for (const fy of fys) {
          const rawX = rect.x + offset.x + fx * rect.width;
          const rawY = rect.y + offset.y + fy * rect.height;
          // See the web copy of this file's identical comment for the full
          // reasoning -- an element clipped away by a scrolling ancestor's
          // own overflow still returns a real, non-zero
          // `getBoundingClientRect()`, and that content is never
          // rasterized anywhere, so this has to be caught here, not fixed
          // with a coordinate offset.
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
 * Samples the real rendered pixels behind a single text element — see the
 * web copy for the full reasoning. Convenience wrapper over
 * `openPixelSampler` for a one-locator call; for many elements on one page,
 * open a sampler once and call `sampleDominant` directly instead.
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

  // See the web copy of this file's `ensureViewportSampler` comment for
  // why a position:fixed ancestor needs an entirely different screenshot.
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

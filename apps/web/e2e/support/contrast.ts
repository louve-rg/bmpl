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
  foreground: RGB;
  dominantBackground: RGB;
  /** 0..1 — the fraction of sampled grid points that matched the dominant color. Low means an ambiguous read (gradient, image, glass edge) — check by eye before trusting the ratio. */
  dominantShare: number;
}

export const WCAG_AA_NORMAL_TEXT_MIN_RATIO = 4.5;

function parseRgb(css: string): RGB | null {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m || m[1] === undefined) return null;
  const [r, g, b] = m[1].split(',').map((n) => parseFloat(n));
  if (r === undefined || g === undefined || b === undefined) return null;
  return { r, g, b };
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
export interface PixelSampler {
  sampleDominant(box: { x: number; y: number; width: number; height: number }): Promise<{ rgb: RGB; share: number }>;
  /** Every color cluster found in the grid, sorted most-common first. Used by the icon sweep (contrast-sweep.ts) to take the second-most-common cluster as an icon's own ink, distinct from its background fill. */
  sampleClustersOrdered(box: { x: number; y: number; width: number; height: number }): Promise<Array<{ rgb: RGB; share: number }>>;
  close(): Promise<void>;
}

export async function openPixelSampler(page: Page): Promise<PixelSampler> {
  // { fullPage: true } is load-bearing, not decoration -- found live
  // (2026-10-21, PR #469's first real run): a bare page.screenshot() only
  // captures the current viewport, but every box this sampler is handed
  // comes from getBoundingClientRect(), which is ALWAYS relative to the top
  // of the full document when scrollY is 0 (true here -- discovery runs
  // right after page.goto with no manual scroll). Without fullPage, any
  // element below the first screenful decoded against a short, viewport-only
  // image, and clusterAt's own clamping (Math.min(canvas.height - 1, ...))
  // silently read the image's BOTTOM EDGE instead of that element's real
  // background -- a wrong answer, not a thrown error. Combined with the
  // elementFromPoint fix in contrast-sweep.ts (same root cause, the
  // foreground half), this is why "By revenue" went completely unmeasured
  // rather than merely ambiguous on admin's first live run.
  const fullPageBuffer = await page.screenshot({ fullPage: true });
  const sampler = await page.context().newPage();
  await sampler.setContent('<img id="shot" /><canvas id="cv"></canvas>');
  await sampler.evaluate((base64) => {
    const img = document.getElementById('shot') as HTMLImageElement;
    img.src = `data:image/png;base64,${base64}`;
  }, fullPageBuffer.toString('base64'));
  await sampler.evaluate(
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

  async function clusterAt(box: { x: number; y: number; width: number; height: number }): Promise<Array<{ rgb: RGB; count: number; total: number }>> {
    const grid = await sampler.evaluate(({ rect }) => {
      const canvas = document.getElementById('cv') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      const pts: { r: number; g: number; b: number }[] = [];
      // Fractional interior grid (6x3 points), not pixel-additive — keeps
      // point count constant regardless of element size, and stays 2px+
      // inside each edge to avoid border-radius artifacts.
      const fxs = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9];
      const fys = [0.2, 0.5, 0.8];
      for (const fx of fxs) {
        for (const fy of fys) {
          const x = Math.max(0, Math.min(canvas.width - 1, Math.round(rect.x + fx * rect.width)));
          const y = Math.max(0, Math.min(canvas.height - 1, Math.round(rect.y + fy * rect.height)));
          const data = ctx.getImageData(x, y, 1, 1).data;
          pts.push({ r: data[0] ?? 0, g: data[1] ?? 0, b: data[2] ?? 0 });
        }
      }
      return pts;
    }, { rect: box });

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
    return [...counts.values()].sort((a, b) => b.count - a.count).map((c) => ({ rgb: c.rgb, count: c.count, total: grid.length }));
  }

  return {
    async sampleDominant(box) {
      const clusters = await clusterAt(box);
      const dominant = clusters[0]!;
      return { rgb: dominant.rgb, share: Math.round((dominant.count / dominant.total) * 100) / 100 };
    },
    async sampleClustersOrdered(box) {
      const clusters = await clusterAt(box);
      return clusters.map((c) => ({ rgb: c.rgb, share: Math.round((c.count / c.total) * 100) / 100 }));
    },
    close: () => sampler.close(),
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
  const fg = parseRgb(fgColor);
  if (!fg) {
    throw new Error(`sampleContrast: could not parse foreground color "${fgColor}".`);
  }

  const sampler = await openPixelSampler(page);
  try {
    const { rgb: dominant, share } = await sampler.sampleDominant(box);
    return {
      ratio: Math.round(contrastRatioOf(fg, dominant) * 100) / 100,
      foreground: fg,
      dominantBackground: dominant,
      dominantShare: share,
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

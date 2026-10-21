import type { Page } from '@playwright/test';

/**
 * Determinism primitives for apps/admin's pixel-baseline visual-regression
 * suite (Priority 6, owner directive 2026-10-16). Identical to
 * apps/web/e2e/support/visual.ts — duplicated rather than shared because
 * there is no existing shared package between the two apps' e2e harnesses
 * (apps/web/e2e/support/auth.ts and server.ts are already duplicated the
 * same way, for the same reason: each app's e2e tree is self-contained by
 * convention here). Keep the two files in sync by hand if either changes.
 */

// The six (god's ruling, 2026-10-16, Phase 2) — see apps/web/e2e/support/visual.ts
// for the full rationale; kept identical here by hand, same convention as
// the rest of this file.
export const VISUAL_VIEWPORTS = {
  mobileNarrow: { width: 320, height: 568 },
  mobile: { width: 375, height: 812 },
  smBreakpoint: { width: 640, height: 960 },
  tablet: { width: 768, height: 1024 },
  laptop: { width: 1024, height: 768 },
  desktop: { width: 1440, height: 900 },
} as const;

// CONTRAST_VIEWPORTS -- a different, nine-width set, NOT the same as the
// six above. See apps/web/e2e/support/visual.ts for the full rationale:
// VISUAL_VIEWPORTS answers "does the layout break at a Tailwind
// breakpoint"; this answers "is this readable at a real device width" --
// the owner's required verification widths, recorded only in
// hive/agents/bmpl-qa-mtmcz0m1/gate-4-2026-10-16/EDWARD-SIX-DEFECTS.md and
// that agent's memory until now, nowhere in this repo. Kept identical to
// web's copy by hand, same convention as the rest of this file.
export const CONTRAST_VIEWPORTS = [320, 375, 390, 430, 640, 768, 834, 1024, 1440] as const;

export const FROZEN_NOW_ISO = '2026-01-15T12:00:00.000Z';

export async function freezeClock(page: Page, isoTime: string = FROZEN_NOW_ISO): Promise<void> {
  await page.clock.install({ time: new Date(isoTime) });
}

const DISABLE_ANIMATIONS_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    scroll-behavior: auto !important;
  }
`;

/**
 * Call once per page, AFTER navigation, immediately before a screenshot
 * assertion. See apps/web/e2e/support/visual.ts for the full reasoning on
 * all three steps (animation kill, font-ready wait tied to the `b82c3af`
 * Inter fix, one settled animation frame).
 */
export async function settleForSnapshot(page: Page): Promise<void> {
  await page.addStyleTag({ content: DISABLE_ANIMATIONS_CSS });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

export async function prepareForSnapshot(page: Page, isoTime: string = FROZEN_NOW_ISO): Promise<void> {
  await freezeClock(page, isoTime);
}

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

export const VISUAL_VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
} as const;

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

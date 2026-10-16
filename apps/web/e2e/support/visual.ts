import type { Page } from '@playwright/test';

/**
 * Determinism primitives for the pixel-baseline visual-regression suite
 * (Priority 6, owner directive 2026-10-16). Every visual spec calls these —
 * never `page.goto()` then `toHaveScreenshot()` directly — because a
 * screenshot captures whatever is true at the moment it is taken, including
 * every source of run-to-run variance this file exists to remove.
 *
 * NOT a determinism tool: the viewport width/height. Pass those through
 * Playwright's own `test.use({ viewport })`/`browser.newContext({ viewport })` —
 * VISUAL_VIEWPORTS below just names the three canonical profiles so every
 * spec uses the same three, not five slightly different ones.
 */

export const VISUAL_VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
} as const;

/**
 * A single fixed instant, used by every visual spec that renders a relative
 * time ("2 minutes ago") or today's date. Deliberately a real, memorable,
 * documented value rather than `new Date(0)` — a baseline reviewer should be
 * able to recognise it on sight rather than wonder whether it was chosen for
 * a reason.
 */
export const FROZEN_NOW_ISO = '2026-01-15T12:00:00.000Z';

/**
 * Freezes the page's clock BEFORE navigation. Must be called before
 * `page.goto()`, not after — a component that reads `Date.now()` during its
 * initial render would already have captured the real wall-clock time if
 * the clock were installed afterward. Playwright's `page.clock` (built in
 * since 1.45; this repo is on ^1.63 per both apps' package.json) fakes every
 * Date/setTimeout/setInterval call the page makes from this point on.
 */
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
 * assertion. Three separate sources of nondeterminism, closed together
 * because a spec that remembers two of three still produces a flaky
 * baseline:
 *   1. Any in-flight CSS transition/animation is killed, not merely sped up
 *      — a mid-transition screenshot is nondeterministic by construction.
 *   2. `document.fonts.ready` is awaited — directly tied to tonight's
 *      `b82c3af` finding ("Inter is declared, never loaded"). A baseline
 *      captured while a fallback font is still showing would enshrine the
 *      wrong render as correct, exactly the failure this wait exists to
 *      prevent, generalized beyond that one specific bug.
 *   3. One animation frame is allowed to pass so the injected stylesheet
 *      above has actually taken effect before the screenshot — a style tag
 *      landing and a frame actually painting with it are not the same
 *      instant.
 */
export async function settleForSnapshot(page: Page): Promise<void> {
  await page.addStyleTag({ content: DISABLE_ANIMATIONS_CSS });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

/**
 * The one-call convenience most specs want: freeze the clock, navigate, wait
 * for the page's own real readiness marker is NOT this function's job (that
 * stays with the harness's global dev-server check) — this only settles
 * rendering state on a page already navigated to. Kept as two separate
 * exported functions above (rather than folding goto in here) because some
 * specs need to mock an API response via `page.route()` between freezing the
 * clock and navigating — an all-in-one helper would force an awkward
 * callback or hide that ordering requirement.
 */
export async function prepareForSnapshot(page: Page, isoTime: string = FROZEN_NOW_ISO): Promise<void> {
  await freezeClock(page, isoTime);
}

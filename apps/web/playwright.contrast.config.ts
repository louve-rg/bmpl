import { defineConfig } from '@playwright/test';
import { CONTRAST_BASE_URL } from './e2e/support/server';

/**
 * Requirement 7 contrast check (`hive/agents/god/CONTRAST-STANDARD.md`,
 * now `docs/design/CONTRAST-STANDARD.md`) -- separate config and testDir
 * from both playwright.config.ts (cheap DOM/overflow checks) and
 * playwright.visual.config.ts (pixel baselines), same reasoning as why
 * those two are already split: a different instrument with different
 * pass/fail semantics deserves its own job step, not a shared one.
 *
 * A pixel baseline detects CHANGE and needs OS/font-rendering determinism
 * above all else. This check detects WRONGNESS against WCAG ratios computed
 * from real composited pixels -- it reuses the pixel-baseline suite's
 * settleForSnapshot() for the same reason (animations/fonts settled before
 * sampling) but needs no `toHaveScreenshot` config and no committed PNGs.
 *
 * Runs against the SAME live API + seeded database as the visual-regression
 * job (see .github/workflows/ci.yml, "Visual regression baseline") -- not a
 * second services block. Locally, needs a running dev server + live API +
 * seeded dev database, same prerequisites as the other authenticated
 * local-only specs in this tree.
 *
 * Its own dev server, on its own CONTRAST_PORT, via its own global-setup --
 * not the visual suite's PORT/global-setup.ts. Found live (2026-10-21, PR
 * #469) that sharing PORT across two same-job steps depended on the visual
 * suite's teardown freeing it first, which failed on its first real exercise
 * on a CI runner (EADDRINUSE). See e2e/support/server.ts's CONTRAST_PORT
 * comment and e2e/support/global-setup.contrast.ts.
 */
export default defineConfig({
  testDir: './e2e/contrast',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: CONTRAST_BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  globalSetup: require.resolve('./e2e/support/global-setup.contrast.ts'),
});

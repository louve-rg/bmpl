import { test, expect, type Page, type Browser } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { tryLogin, UAT_DRIVER_EMAIL, UAT_DRIVER_PASSWORD } from './support/auth';

/**
 * MDF-247 follow-up: apps/admin's shared `Alert` (components/ui.tsx) was found
 * to silently overflow its own box on an unbroken free-text word with no
 * flex/grid ancestor involved at all (#430) — a plain `<div role="alert">`
 * with no `break-words`. `apps/web`'s `Alert` has the byte-identical missing
 * `break-words`, but no confirmed free-text call site had been reproduced in
 * this app yet (#430's own commit message names this gap explicitly).
 *
 * `/dashboard/driver/documents` is that call site:
 * `data.application.reviewerNote` (an admin's free-text note on a driver's
 * role application) renders through `<Alert tone="info" title="Note from
 * reviewer">{reviewerNote}</Alert>` (apps/web/app/dashboard/driver/documents/page.tsx:70-74)
 * with no `break-words` anywhere in the chain. Notably, the SAME page
 * already wraps two OTHER free-text fields in `break-words` directly
 * (`application.message` at line 69, a vehicle's `rejectionReason` at line
 * 113) — only the one routed through the shared `Alert` primitive was
 * missed, exactly the "hidden inside a shared component" shape #430
 * describes for admin.
 *
 * [LOCAL ONLY] Needs a live API + seeded dev database with the UAT driver
 * fixture (packages/database/prisma/seed-uat-logistics.ts) logged in for
 * real, so the dashboard shell's server-side `/me` call (apps/web/app/dashboard/layout.tsx,
 * a Next.js Server Component — `page.route()` cannot intercept it) succeeds.
 * Once logged in, the page's own data call (`GET /driver/dashboard`) is
 * mocked via `page.route()` with a fixture `reviewerNote` carrying one
 * unbroken word, same technique as admin's vendor-detail-rejection-reason
 * and order-detail-free-text overflow specs.
 */

const WIDTHS = [320, 375, 768, 1024, 1440];
const LONG_WORD = 'A'.repeat(80);
const STORAGE_PATH = path.join(os.tmpdir(), `bmpl-e2e-uat-driver-state-mdf247-${process.pid}.json`);

let loginOk = false;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  loginOk = await tryLogin(page, UAT_DRIVER_EMAIL, UAT_DRIVER_PASSWORD);
  if (loginOk) await context.storageState({ path: STORAGE_PATH });
  await context.close();
});

test.afterAll(() => {
  fs.rmSync(STORAGE_PATH, { force: true });
});

function dashboard() {
  return {
    hasProfile: true,
    roleStatus: 'APPROVED',
    application: {
      id: 'app-1',
      status: 'APPROVED',
      message: null,
      createdAt: new Date().toISOString(),
      reviewerNote: `Please upload a clearer licence photo ${LONG_WORD}`,
    },
    profile: {
      legalName: 'UAT Driver',
      displayName: 'UAT Driver',
      phone: '+501 600 0000',
      homeDistrict: 'BELIZE',
      licenceNumber: 'DL-0001',
      licenceExpiry: null,
      licenceExpiryStatus: 'VALID',
      vehicleOwnership: 'OWNED',
      availability: 'OFFLINE',
      hasProfilePhoto: true,
    },
    vehicles: [],
    serviceAreas: [],
    eligibility: { canGoOnline: true, reasons: [] },
  };
}

async function authedPage(browser: Browser, width: number): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: STORAGE_PATH, viewport: { width, height: 1200 } });
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

test.describe('[LOCAL ONLY, skips without a UAT driver session -- see file header] driver documents reviewer-note Alert never overflows its own box', () => {
  for (const width of WIDTHS) {
    test(`the "Note from reviewer" alert stays inside its own box at ${width}px`, async ({ browser }) => {
      test.skip(!loginOk, 'Needs a live API + seeded dev database with the UAT driver fixture -- not provisioned in CI. See file header.');
      const { page, close } = await authedPage(browser, width);
      await page.route('**/api/driver/dashboard', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: dashboard() }) : r.continue()));
      await page.goto('/dashboard/driver/documents');
      await expect(page.getByText('Note from reviewer')).toBeVisible({ timeout: 5000 });

      const measured = await page.evaluate(() => {
        const alert = document.querySelector('[role="alert"]');
        return alert ? { scrollWidth: alert.scrollWidth, clientWidth: alert.clientWidth } : null;
      });
      await close();

      expect(measured, 'alert element not found').not.toBeNull();
      expect(
        measured!.scrollWidth,
        `alert scrollWidth ${measured!.scrollWidth} vs its own clientWidth ${measured!.clientWidth} at ${width}px`,
      ).toBeLessThanOrEqual(measured!.clientWidth + 1);
    });
  }
});

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { tryLogin, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD } from './support/auth';

/**
 * *** NEVER RUNS IN CI -- same shape as every other *.local-only.spec.ts in
 * *** this directory. Needs a live local API + seeded database with
 * *** UAT_SEED_PASSWORD set.
 *
 * MSG-1 live-behaviour verification, part (a) -- god's dispatch,
 * conv-98ad66, 2026-11-10. See msg1-text-rerender-verify.local-only.spec.ts
 * for part (b), the thread Edward actually reported.
 *
 * NO DATABASE WRITE OF ANY KIND. An earlier version of this file believed
 * MessageAttachment.scanStatus permanently gated an image attachment behind
 * "unavailable" (no scan worker ever clears PENDING), and performed a
 * god-authorized scoped manual DB write to work around it. That premise was
 * wrong, confirmed with a throwaway no-DB-write probe: AttachmentView
 * (apps/web/app/dashboard/messages/page.tsx) only gates rendering on
 * scanStatus === 'FLAGGED' for an image; PENDING renders the <img>
 * immediately. The four "no flicker, no rotation" results from the earlier
 * version of this file were real but measured the wrong DOM nodes -- its
 * `img[alt]` selector only matches elements with an alt ATTRIBUTE present,
 * and the real attachment's alt is `null` (omitted entirely by React)
 * because resolveAttachments() in apps/api/src/messaging/messaging.service.ts
 * never persists fileName on the row -- so the selector matched two
 * unrelated logo <img> elements (both with a literal alt="") instead.
 * Reported as a correction, conv-98ad66. This version selects the
 * attachment image by its actual Tailwind classes instead.
 *
 * NO MOCKS, NO REAL CUSTOMER/SHIPMENT DATA. One new SUPPORT_CASE
 * conversation under the existing uat-customer fixture, closed at the end.
 */

test.setTimeout(480_000);

const STORAGE_PATH = path.join(os.tmpdir(), `bmpl-e2e-msg1-verify-customer-${process.pid}.json`);
const RUN_TAG = `${Date.now()}-${process.pid}`;
const PHOTO_FILENAME = `bmpl-e2e-msg1-verify-${RUN_TAG}.png`;
const TEST_PHOTO_PATH = path.join(os.tmpdir(), PHOTO_FILENAME);
// Smallest possible valid PNG (1x1, opaque red) -- a real decodable image,
// not a placeholder blob, so the server's image-mime path runs for real.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

let loginOk = false;

test.beforeAll(async ({ browser }) => {
  fs.writeFileSync(TEST_PHOTO_PATH, Buffer.from(TINY_PNG_BASE64, 'base64'));
  if (!UAT_FIXTURE_PASSWORD) return;
  const context = await browser.newContext();
  const page = await context.newPage();
  loginOk = await tryLogin(page, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD);
  if (loginOk) await context.storageState({ path: STORAGE_PATH });
  await context.close();
});

test.afterAll(() => {
  fs.rmSync(STORAGE_PATH, { force: true });
  fs.rmSync(TEST_PHOTO_PATH, { force: true });
});

/**
 * The attachment <img> as AttachmentView actually renders it (className
 * "h-32 w-32 object-cover", hardcoded there) -- distinct from the two
 * avatar/logo <img> elements elsewhere on the page, which share
 * "object-cover" but not the h-32/w-32 sizing. Its alt attribute is
 * genuinely absent (fileName is never persisted server-side); do not
 * select by alt text.
 */
async function currentImgSrc(page: Page): Promise<string | null> {
  const img = page.locator('img.h-32.w-32.object-cover').first();
  if ((await img.count()) === 0) return null;
  return img.getAttribute('src');
}

async function fetchStatus(page: Page, url: string): Promise<number> {
  return page.evaluate(async (u) => {
    const res = await fetch(u);
    return res.status;
  }, url);
}

test('(a) a rendered attachment photo: stable src past the 15s poll, correctly adopted (not pinned) past the 300s TTL, no 403, bounded requests, both viewports', async ({ browser }) => {
  test.skip(!UAT_FIXTURE_PASSWORD || !loginOk, 'Needs a live local API + seeded database with UAT_SEED_PASSWORD set. See file header.');

  const desktopCtx = await browser.newContext({ storageState: STORAGE_PATH, viewport: { width: 1280, height: 900 } });
  const desktop = await desktopCtx.newPage();

  let conversationApiHits = 0;
  desktop.on('response', (res) => {
    if (/\/conversations\/[^/]+$/.test(new URL(res.url()).pathname) && res.request().method() === 'GET') {
      conversationApiHits++;
    }
  });

  await desktop.goto('/dashboard/messages');
  await desktop.getByRole('button', { name: 'Contact support' }).click();
  await desktop.getByLabel('Subject').fill(`MSG-1 verification ${RUN_TAG} -- synthetic, local only, safe to close`);
  await desktop.getByLabel('Message').first().fill('Synthetic verification message for MSG-1 (attachment-flicker fix). No real issue.');
  await desktop.getByRole('button', { name: 'Send to support' }).click();

  await desktop.getByLabel('Attach a file').setInputFiles(TEST_PHOTO_PATH);
  await expect(desktop.getByText(PHOTO_FILENAME)).toBeVisible({ timeout: 15_000 }); // pending-upload chip, pre-send only
  const messageBox = desktop.getByLabel('Message', { exact: true });
  await messageBox.fill('Photo attached for MSG-1 verification.');
  await desktop.getByRole('button', { name: 'Send', exact: true }).click();

  await expect.poll(async () => currentImgSrc(desktop), { timeout: 20_000, intervals: [1_000] }).not.toBeNull();
  const desktopSrc0 = (await currentImgSrc(desktop)) as string;

  const mobileCtx = await browser.newContext({ storageState: STORAGE_PATH, viewport: { width: 375, height: 800 } });
  const mobile = await mobileCtx.newPage();
  await mobile.goto('/dashboard/messages');
  await mobile.getByRole('button', { name: new RegExp(RUN_TAG) }).click();
  await expect.poll(async () => currentImgSrc(mobile), { timeout: 20_000, intervals: [1_000] }).not.toBeNull();
  const mobileSrc0 = (await currentImgSrc(mobile)) as string;

  const checkpoints = Array.from({ length: 27 }, (_, i) => (i + 1) * 15); // 15..405
  let desktopChangedBefore90s = false;
  let mobileChangedBefore90s = false;
  let desktopRotatedAtS: number | null = null;
  let mobileRotatedAtS: number | null = null;
  let desktopSrcFinal = desktopSrc0;
  let mobileSrcFinal = mobileSrc0;
  let lastCheckpointS = 0;
  for (const s of checkpoints) {
    await desktop.waitForTimeout((s - lastCheckpointS) * 1000);
    lastCheckpointS = s;
    const dSrc = await currentImgSrc(desktop);
    const mSrc = await currentImgSrc(mobile);
    if (s <= 90 && dSrc !== desktopSrc0) desktopChangedBefore90s = true;
    if (s <= 90 && mSrc !== mobileSrc0) mobileChangedBefore90s = true;
    if (desktopRotatedAtS === null && dSrc !== desktopSrc0) desktopRotatedAtS = s;
    if (mobileRotatedAtS === null && mSrc !== mobileSrc0) mobileRotatedAtS = s;
    desktopSrcFinal = dSrc ?? desktopSrcFinal;
    mobileSrcFinal = mSrc ?? mobileSrcFinal;
  }
  const desktopRotated = desktopRotatedAtS !== null;
  const mobileRotated = mobileRotatedAtS !== null;

  const desktopDownloadStatus = await fetchStatus(desktop, desktopSrcFinal);
  const mobileDownloadStatus = await fetchStatus(mobile, mobileSrcFinal);

  await desktop.getByRole('button', { name: /^(Close|Reopen)$/ }).click();
  await desktopCtx.close();
  await mobileCtx.close();

  console.log('MSG-1 PART (a) RESULT -- LOCAL-browser evidence, NO database write:');
  console.log(`  desktop src changed within first 90s (should be FALSE): ${desktopChangedBefore90s}`);
  console.log(`  mobile   src changed within first 90s (should be FALSE): ${mobileChangedBefore90s}`);
  console.log(`  desktop src rotated by 405s, and at which tick (null = never rotated in this run): ${desktopRotated} @ ${desktopRotatedAtS}s`);
  console.log(`  mobile   src rotated by 405s, and at which tick (null = never rotated in this run): ${mobileRotated} @ ${mobileRotatedAtS}s`);
  console.log(`  desktop final-URL download status (must be 200, not 403): ${desktopDownloadStatus}`);
  console.log(`  mobile   final-URL download status (must be 200, not 403): ${mobileDownloadStatus}`);
  console.log(`  GET /conversations/:id hits over ~405s (bounded-pattern check, desktop only): ${conversationApiHits}`);

  expect(desktopChangedBefore90s, 'attachment image re-flashed within 90s, before any legitimate TTL rotation').toBe(false);
  expect(mobileChangedBefore90s, 'attachment image re-flashed within 90s on mobile viewport, before any legitimate TTL rotation').toBe(false);
  expect(desktopDownloadStatus, 'the currently-displayed attachment URL must still download, not 403').toBe(200);
  expect(mobileDownloadStatus, 'the currently-displayed attachment URL must still download, not 403').toBe(200);
  expect(conversationApiHits, 'request pattern must be bounded (~1 per 15s poll), not an uncontrolled loop').toBeLessThan(60);
});

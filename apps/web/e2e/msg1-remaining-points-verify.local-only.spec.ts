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
 * MSG-1 live-behaviour verification, the six points the first two rounds
 * (msg1-attachment-flicker-verify, msg1-text-rerender-verify) never
 * measured -- god's mapping against the owner's ten acceptance points
 * (conv-391e7e, 2026-11-10): (1) opening a conversation without a flash,
 * (3) sending doesn't reset the conversation, (5) switching conversations,
 * (6) an attachment-only message (no text body) -- a distinct render path,
 * (7) a real customer<->courier (shipment-scoped) conversation, not just
 * SUPPORT_CASE, (9) headers/text/controls stay visible throughout.
 *
 * NO MOCKS, real local API/DB. Reuses the uat-customer fixture; creates one
 * throwaway SUPPORT_CASE conversation (closed at the end) for points
 * 1/3/5/6/9, and for point 7 finds and reuses an EXISTING open
 * shipment-scoped conversation already in the dev database (left behind by
 * a prior real dispatch-journey run, e.g. MDF-587's spec) rather than
 * running a full shipment+dispatch+driver-acceptance journey itself just to
 * get one -- the thread pane's rendering code
 * (apps/web/app/dashboard/messages/page.tsx) has no branch anywhere on
 * conversation type/contextLabel, so a real shipment conversation exercises
 * the identical ThreadPane/Composer/MessageBubble code a SUPPORT_CASE does;
 * this test's job is to confirm that generalization empirically, not to
 * fabricate a fresh courier journey. Skips gracefully, not a hard failure,
 * if no open shipment conversation exists in this environment right now.
 */

test.setTimeout(180_000);

const STORAGE_PATH = path.join(os.tmpdir(), `bmpl-e2e-msg1-remaining-customer-${process.pid}.json`);
const THREAD_SELECTOR = 'div.overflow-y-auto.bg-slate-50\\/50';
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

let loginOk = false;

test.beforeAll(async ({ browser }) => {
  if (!UAT_FIXTURE_PASSWORD) return;
  const context = await browser.newContext();
  const page = await context.newPage();
  loginOk = await tryLogin(page, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD);
  if (loginOk) await context.storageState({ path: STORAGE_PATH });
  await context.close();
});

test.afterAll(() => {
  fs.rmSync(STORAGE_PATH, { force: true });
});

async function sendText(page: Page, text: string) {
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator(THREAD_SELECTOR).getByText(text, { exact: true })).toBeVisible({ timeout: 10_000 });
}

test('(1)(3)(5)(9): opening, sending and switching conversations, headers/controls stay visible throughout', async ({ browser }) => {
  test.skip(!UAT_FIXTURE_PASSWORD || !loginOk, 'Needs a live local API + seeded database with UAT_SEED_PASSWORD set. See file header.');
  const RUN_TAG = `${Date.now()}-${process.pid}`;
  const ctx = await browser.newContext({ storageState: STORAGE_PATH, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  let detailApiHitsFor: Record<string, number> = {};
  page.on('response', (res) => {
    const m = new URL(res.url()).pathname.match(/\/conversations\/([^/]+)$/);
    const id = m?.[1];
    if (id && res.request().method() === 'GET') detailApiHitsFor[id] = (detailApiHitsFor[id] ?? 0) + 1;
  });

  await page.goto('/dashboard/messages');
  // ---- (1) open a PRE-EXISTING conversation first, so there is old content on screen that a flash would leak forward ----
  const existingRows = page.locator('ul[aria-label="Conversations"] > li > button');
  await existingRows.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  const existingCount = await existingRows.count();
  test.skip(existingCount === 0, 'No pre-existing conversation to use as the "old content" baseline for the open-flash check.');
  await existingRows.first().click();
  await expect(page.getByRole('button', { name: /^(Close|Reopen)$/ })).toBeVisible({ timeout: 15_000 });
  const firstOpenedSubject = (await page.locator(THREAD_SELECTOR).locator('..').locator('p').first().textContent())?.trim() ?? '';

  // ---- create the throwaway conversation this test actually drives ----
  await page.getByRole('button', { name: 'Contact support' }).click();
  await page.getByLabel('Subject').fill(`MSG-1 remaining ${RUN_TAG} -- synthetic, local only, safe to close`);
  await page.getByLabel('Message').first().fill('Synthetic verification message for MSG-1 remaining points. No real issue.');
  await page.getByRole('button', { name: 'Send to support' }).click();
  // (1) opening without a flash: the just-created thread's header must appear,
  // and the PREVIOUS conversation's subject text must never reappear inside
  // the thread pane while this one is loading/settling.
  await expect(page.getByRole('button', { name: /^(Close|Reopen)$/ })).toBeVisible({ timeout: 15_000 });
  if (firstOpenedSubject) {
    expect(await page.locator(THREAD_SELECTOR).locator('..').textContent(), 'the previous conversation\'s header must not bleed into the newly opened one').not.toContain(firstOpenedSubject);
  }
  const newConvApiHitsAtOpen = Object.values(detailApiHitsFor).reduce((a, b) => a + b, 0);

  // ---- (3) sending must not reset/remount the conversation ----
  const FIRST_MARKER = `probe-first-${RUN_TAG}`;
  await sendText(page, FIRST_MARKER);
  const tagged = await page.locator(THREAD_SELECTOR).evaluate((root, marker) => {
    const el = [...root.querySelectorAll('p')].find((n) => n.textContent === marker);
    if (!el) return false;
    (el as HTMLElement).dataset.msg1Probe = 'stable';
    return true;
  }, FIRST_MARKER);
  expect(tagged, 'must have found and tagged the first message bubble').toBe(true);

  await sendText(page, `second message ${RUN_TAG}`);
  const survivedSend = await page.evaluate(() => !!document.querySelector('[data-msg1-probe="stable"]'));

  // ---- (9) header, status badge and composer stay visible/readable right now ----
  const headerVisible = await page.getByRole('button', { name: /^(Close|Reopen)$/ }).isVisible();
  const composerVisible = await page.getByLabel('Message', { exact: true }).isVisible();
  const headerColor = await page
    .locator(THREAD_SELECTOR)
    .locator('..')
    .locator('p')
    .first()
    .evaluate((el) => getComputedStyle(el).color);

  // ---- (5) switching away and back: the old conversation's poll must stop, and its content must survive the round trip ----
  const newConvUrl = page.url();
  const newConvId = new URL(newConvUrl).searchParams.get('c')!;
  expect(newConvId, 'must have a conversation id in the URL to track its polling').toBeTruthy();

  await existingRows.nth(existingCount > 1 ? 1 : 0).click();
  await expect(page.getByRole('button', { name: /^(Close|Reopen)$/ })).toBeVisible({ timeout: 15_000 });
  const hitsRightAfterSwitch = detailApiHitsFor[newConvId] ?? 0;
  await page.waitForTimeout(17_000); // one full 15s poll cycle while looking at the OTHER conversation
  const hitsAfterOnePollElsewhere = detailApiHitsFor[newConvId] ?? 0;

  await page.goto(newConvUrl);
  await expect(page.getByRole('button', { name: /^(Close|Reopen)$/ })).toBeVisible({ timeout: 15_000 });
  const survivedSwitch = await page.locator(THREAD_SELECTOR).getByText(FIRST_MARKER, { exact: true }).isVisible();

  await page.getByRole('button', { name: /^(Close|Reopen)$/ }).click();
  await ctx.close();

  console.log('MSG-1 REMAINING POINTS (1)(3)(5)(9) RESULT -- LOCAL-browser evidence, head of fix/msg1-remaining-points-and-autoscroll:');
  console.log(`  (1) opened cleanly, no previous-conversation content bled in, GET hits for this conversation during open+settle: ${newConvApiHitsAtOpen > 0}`);
  console.log(`  (3) first message bubble survived sending a second message (no remount): ${survivedSend}`);
  console.log(`  (5) after switching away for ~17s, this conversation's own GET count did not grow while another was open (stopped polling it): before=${hitsRightAfterSwitch}, after=${hitsAfterOnePollElsewhere}`);
  console.log(`  (5) switching back shows the same content intact: ${survivedSwitch}`);
  console.log(`  (9) header/composer visible, header text has a real (non-transparent) computed color: visible=${headerVisible && composerVisible}, color=${headerColor}`);

  expect(survivedSend, 'sending a message must not remount earlier messages').toBe(true);
  expect(hitsAfterOnePollElsewhere, 'a conversation that is no longer open must stop being polled -- its own interval must be cleared on unmount').toBe(hitsRightAfterSwitch);
  expect(survivedSwitch, 'switching back to a conversation must show its real content, not a stale/broken state').toBe(true);
  expect(headerVisible && composerVisible, 'header and composer must stay visible').toBe(true);
  expect(headerColor, 'header text must not be rendered fully transparent').not.toBe('rgba(0, 0, 0, 0)');
});

test('(6): an attachment-only message (no text body) renders and stays stable', async ({ browser }) => {
  test.skip(!UAT_FIXTURE_PASSWORD || !loginOk, 'Needs a live local API + seeded database with UAT_SEED_PASSWORD set. See file header.');
  const RUN_TAG = `${Date.now()}-${process.pid}`;
  const PHOTO_PATH = path.join(os.tmpdir(), `bmpl-e2e-msg1-remaining-photo-${RUN_TAG}.png`);
  fs.writeFileSync(PHOTO_PATH, Buffer.from(TINY_PNG_BASE64, 'base64'));

  const ctx = await browser.newContext({ storageState: STORAGE_PATH, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('/dashboard/messages');
  await page.getByRole('button', { name: 'Contact support' }).click();
  await page.getByLabel('Subject').fill(`MSG-1 attachment-only ${RUN_TAG} -- synthetic, local only, safe to close`);
  await page.getByLabel('Message').first().fill('Synthetic verification -- attachment-only message follows.');
  await page.getByRole('button', { name: 'Send to support' }).click();
  await expect(page.getByRole('button', { name: /^(Close|Reopen)$/ })).toBeVisible({ timeout: 15_000 });

  // Attach the file but leave the message body EMPTY -- the distinct render
  // path: MessageBubble's `{message.body && <p>...}` must not render a
  // paragraph at all, only the AttachmentView row.
  await page.getByLabel('Attach a file').setInputFiles(PHOTO_PATH);
  await expect(page.getByText(path.basename(PHOTO_PATH))).toBeVisible({ timeout: 15_000 });
  const sendBtn = page.getByRole('button', { name: 'Send', exact: true });
  await expect(sendBtn).toBeEnabled({ timeout: 10_000 }); // body empty, file done -> nothingToSend must be false
  await sendBtn.click();

  const img = page.locator(THREAD_SELECTOR).locator('img.h-32.w-32.object-cover').first();
  await expect(img).toBeVisible({ timeout: 15_000 });
  const src0 = await img.getAttribute('src');
  const emptyBodyParagraphCount = await page
    .locator(THREAD_SELECTOR)
    .locator('div.max-w-\\[85\\%\\]')
    .last()
    .locator('p.whitespace-pre-wrap')
    .count();

  await page.waitForTimeout(30_000); // two 15s poll cycles
  const src1 = await img.getAttribute('src');

  await page.getByRole('button', { name: /^(Close|Reopen)$/ }).click();
  await ctx.close();
  fs.rmSync(PHOTO_PATH, { force: true });

  console.log('MSG-1 REMAINING POINT (6) RESULT:');
  console.log(`  attachment-only message rendered an <img>, no stray empty body paragraph: img rendered, body <p> count = ${emptyBodyParagraphCount}`);
  console.log(`  src stable across 30s / two poll cycles with no text body in the message: ${src0 === src1}`);

  expect(emptyBodyParagraphCount, 'an attachment-only message must not render an empty body paragraph').toBe(0);
  expect(src0 === src1, 'an attachment-only message\'s image must not re-flash either').toBe(true);
});

test('(7): a real customer<->courier (shipment-scoped) conversation behaves the same as a support conversation', async ({ browser }) => {
  test.skip(!UAT_FIXTURE_PASSWORD || !loginOk, 'Needs a live local API + seeded database with UAT_SEED_PASSWORD set. See file header.');
  const ctx = await browser.newContext({ storageState: STORAGE_PATH, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  let detailApiHits = 0;
  page.on('response', (res) => {
    if (/\/conversations\/[^/]+$/.test(new URL(res.url()).pathname) && res.request().method() === 'GET') detailApiHits++;
  });

  await page.goto('/dashboard/messages');
  // Find a real, open, shipment-scoped conversation already in the dev
  // database (contextLabel starts with "Shipment", not "Support") -- left
  // behind by a prior genuine dispatch-journey run. See file header for why
  // this test does not run its own dispatch journey.
  const rows = page.locator('ul[aria-label="Conversations"] > li > button');
  await rows.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  const count = await rows.count();
  let targetIndex = -1;
  for (let i = 0; i < count; i++) {
    const text = (await rows.nth(i).textContent()) ?? '';
    if (/^Shipment\b/.test(text.trim()) && !/Closed/.test(text)) {
      targetIndex = i;
      break;
    }
  }
  test.skip(targetIndex === -1, 'No open shipment-scoped conversation exists in this environment right now -- see file header; not a failure, just nothing to observe.');

  await rows.nth(targetIndex).click();
  await expect(page.getByRole('button', { name: /^(Close|Reopen)$/ })).toBeVisible({ timeout: 15_000 });
  const canSendNow = await page.getByLabel('Message', { exact: true }).isVisible().catch(() => false);
  test.skip(!canSendNow, 'This shipment conversation is closed or not sendable right now -- cannot drive the same observation.');

  const RUN_TAG = `${Date.now()}-${process.pid}`;
  await sendText(page, `customer-to-courier verification ${RUN_TAG}`);
  const tagged = await page.locator(THREAD_SELECTOR).evaluate((root, marker) => {
    const el = [...root.querySelectorAll('p')].find((n) => n.textContent === marker);
    if (!el) return false;
    (el as HTMLElement).dataset.msg1Probe = 'stable';
    return true;
  }, `customer-to-courier verification ${RUN_TAG}`);
  expect(tagged).toBe(true);

  await page.waitForTimeout(30_000); // two 15s poll cycles, idle
  const survived = await page.evaluate(() => !!document.querySelector('[data-msg1-probe="stable"]'));

  await ctx.close();

  console.log('MSG-1 REMAINING POINT (7) RESULT (real shipment-scoped conversation, not SUPPORT_CASE):');
  console.log(`  message bubble survived 30s/two idle poll cycles on a real customer<->courier thread (no remount): ${survived}`);
  console.log(`  GET /conversations/:id hits over the run (bounded-pattern check): ${detailApiHits}`);

  expect(survived, 'a real shipment-scoped conversation must behave identically to SUPPORT_CASE -- no remount on idle polling').toBe(true);
  expect(detailApiHits, 'request pattern must be bounded').toBeLessThan(20);
});

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
 * MSG-1 live-behaviour verification, part (b) -- god's dispatch,
 * conv-98ad66, 2026-11-10: whatever Edward actually saw flickering was NOT
 * a photo attachment (no user can see a signed URL rotate on a plain-text
 * message), so this re-targets the observation at what he could actually
 * see: the message list/detail re-rendering, the conversation list, and
 * scroll position jumping while a thread stays open, with a bounded
 * GET /conversations/:id request count. See
 * msg1-attachment-flicker-verify.local-only.spec.ts for part (a), the
 * attachment-photo case this test deliberately does NOT touch -- no
 * attachment is uploaded here at all, so none of that file's scanStatus
 * workaround is needed.
 *
 * FOLLOW-UP (conv-391e7e, same day): the first run of this test found the
 * view snapping to the bottom the instant a new message arrived while the
 * viewer was scrolled up -- an intentional but, per god/the owner, incorrect
 * behaviour. `ThreadPane`'s pin-to-bottom effect (apps/web/app/dashboard/
 * messages/page.tsx) now only re-pins when the viewer was already at/near
 * the bottom (tracked via onScroll). This file now asserts the FIXED
 * behaviour in both directions: scrolled away, a new message must NOT move
 * the view; already at the bottom, a new message still must.
 *
 * NO MOCKS. Talks to the real local API/DB -- a page.route() mock would
 * hide the actual poll timing and reconciliation this is testing.
 *
 * NO REAL CUSTOMER/SHIPMENT DATA. One new SUPPORT_CASE conversation under
 * the existing uat-customer fixture, closed again at the end.
 */

test.setTimeout(240_000);

const STORAGE_PATH = path.join(os.tmpdir(), `bmpl-e2e-msg1-rerender-customer-${process.pid}.json`);

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

// The conversation-list row also shows a live preview of the same text
// (ConversationList's `c.lastMessage.preview`), so an unscoped getByText
// match is ambiguous the instant a message is sent -- scope every lookup to
// the thread's own transcript container.
const THREAD_SELECTOR = 'div.overflow-y-auto.bg-slate-50\\/50';

async function sendText(page: Page, text: string) {
  const box = page.getByLabel('Message', { exact: true });
  await box.fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator(THREAD_SELECTOR).getByText(text, { exact: true })).toBeVisible({ timeout: 10_000 });
}

test('(b) a real text conversation: no full remount of existing bubbles on an idle poll, bounded requests, and whether the pinned-to-bottom auto-scroll jumps the view when a new message arrives while scrolled up', async ({ browser }) => {
  test.skip(!UAT_FIXTURE_PASSWORD || !loginOk, 'Needs a live local API + seeded database with UAT_SEED_PASSWORD set. See file header.');

  const RUN_TAG = `${Date.now()}-${process.pid}`;
  const desktopCtx = await browser.newContext({ storageState: STORAGE_PATH, viewport: { width: 1280, height: 900 } });
  const desktop = await desktopCtx.newPage();

  let detailApiHits = 0;
  let listApiHits = 0;
  desktop.on('response', (res) => {
    const p = new URL(res.url()).pathname;
    if (res.request().method() !== 'GET') return;
    if (/\/conversations\/[^/]+$/.test(p)) detailApiHits++;
    else if (/\/conversations$/.test(p)) listApiHits++;
  });

  await desktop.goto('/dashboard/messages');
  await desktop.getByRole('button', { name: 'Contact support' }).click();
  await desktop.getByLabel('Subject').fill(`MSG-1 part-b ${RUN_TAG} -- synthetic, local only, safe to close`);
  await desktop.getByLabel('Message').first().fill('Synthetic verification message for MSG-1 part (b). No real issue.');
  await desktop.getByRole('button', { name: 'Send to support' }).click();
  // The SupportForm's own "Message" field (same accessible name as the
  // Composer's) briefly coexists with the about-to-mount ThreadPane during
  // this transition -- wait for the thread to actually be open (its header
  // Close/Reopen button only renders once `detail` has loaded) before the
  // first Composer interaction, or `getByLabel('Message')` can resolve to
  // the old form field a render tick before it unmounts.
  await expect(desktop.getByRole('button', { name: /^(Close|Reopen)$/ })).toBeVisible({ timeout: 15_000 });

  // Enough messages to make the thread's own scroll container overflow its
  // max-height -- kept to 7 total sends (well under the POST
  // :id/messages StrictThrottle limit, default 10/60s, THROTTLE_AUTH_LIMIT)
  // by padding each line long enough to wrap across 2-3 lines instead of
  // relying on raw message count.
  const FIRST_MARKER = `probe-first-${RUN_TAG}`;
  await sendText(desktop, FIRST_MARKER);
  for (let i = 0; i < 6; i++) {
    await sendText(desktop, `filler line ${i} ${RUN_TAG} -- padded with enough extra words to reliably wrap across two or three lines in the thread pane so six of these plus the marker message actually overflow the scroll container`);
  }

  // Tag the actual DOM node of the first message with a plain (non-React) attribute.
  // A full remount of the message list would create a brand-new node and lose this;
  // key-based reconciliation keeping the same node would not. Scoped to the
  // thread container itself -- the list pane sits earlier in the DOM and
  // would otherwise match its own preview text first.
  const scrollContainer = desktop.locator(THREAD_SELECTOR);
  const tagged = await scrollContainer.evaluate((root, marker) => {
    const el = [...root.querySelectorAll('p')].find((n) => n.textContent === marker);
    if (!el) return false;
    (el as HTMLElement).dataset.msg1Probe = 'stable';
    return true;
  }, FIRST_MARKER);
  expect(tagged, 'must have found and tagged the first message bubble before observing').toBe(true);

  // Scroll the thread's own scroll container all the way to the TOP -- not
  // merely "the middle", which (depending on how little a short thread
  // actually overflows) can still land within the pin effect's own
  // NEAR_BOTTOM_PX(80) threshold and make this whole check a false pass.
  // The top is the one position guaranteed to be far from the bottom
  // whenever there is overflow at all.
  const scrollInfo0 = await scrollContainer.evaluate((el) => ({ scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  expect(scrollInfo0.scrollHeight, 'thread must overflow by comfortably more than the pin effect\'s own 80px near-bottom threshold, or scrolling to the top would not be a real test of it').toBeGreaterThan(scrollInfo0.clientHeight + 150);
  await scrollContainer.evaluate((el) => { el.scrollTop = 0; });
  await desktop.waitForTimeout(200);
  const scrollTopAfterManualScroll = await scrollContainer.evaluate((el) => el.scrollTop);

  // ---- idle window: six 15s poll cycles, nobody sends anything ----
  let remountedDuringIdle = false;
  let scrollJumpedDuringIdle = false;
  for (let i = 0; i < 6; i++) {
    await desktop.waitForTimeout(15_000);
    const probeStillThere = await desktop.evaluate(() => {
      const el = document.querySelector('[data-msg1-probe="stable"]');
      return !!el;
    });
    if (!probeStillThere) remountedDuringIdle = true;
    const st = await scrollContainer.evaluate((el) => el.scrollTop);
    if (Math.abs(st - scrollTopAfterManualScroll) > 5) scrollJumpedDuringIdle = true;
  }
  const scrollTopAfterIdle = await scrollContainer.evaluate((el) => el.scrollTop);

  // ---- a genuinely new message arrives while still scrolled up: does the pinned-to-bottom effect jump the view? ----
  const NEW_MSG = `new-arrival-${RUN_TAG}`;
  const senderCtx = await browser.newContext({ storageState: STORAGE_PATH, viewport: { width: 1280, height: 900 } });
  const sender = await senderCtx.newPage();
  await sender.goto('/dashboard/messages');
  await sender.getByRole('button', { name: new RegExp(RUN_TAG) }).first().click();
  await sendText(sender, NEW_MSG);
  await senderCtx.close();

  await expect(desktop.locator(THREAD_SELECTOR).getByText(NEW_MSG, { exact: true })).toBeVisible({ timeout: 20_000 });
  const scrollTopAfterNewMessage = await scrollContainer.evaluate((el) => el.scrollTop);
  const scrollHeightAfterNewMessage = await scrollContainer.evaluate((el) => el.scrollHeight);
  const clientHeightAfterNewMessage = await scrollContainer.evaluate((el) => el.clientHeight);
  const jumpedToBottomOnNewMessage =
    scrollHeightAfterNewMessage - clientHeightAfterNewMessage - scrollTopAfterNewMessage < 5;

  // ---- complementary check, opposite direction: already at the bottom, a new message must still pin ----
  await scrollContainer.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await desktop.waitForTimeout(200);
  const NEW_MSG_2 = `new-arrival-2-${RUN_TAG}`;
  const senderCtx2 = await browser.newContext({ storageState: STORAGE_PATH, viewport: { width: 1280, height: 900 } });
  const sender2 = await senderCtx2.newPage();
  await sender2.goto('/dashboard/messages');
  await sender2.getByRole('button', { name: new RegExp(RUN_TAG) }).first().click();
  await sendText(sender2, NEW_MSG_2);
  await senderCtx2.close();

  await expect(desktop.locator(THREAD_SELECTOR).getByText(NEW_MSG_2, { exact: true })).toBeVisible({ timeout: 20_000 });
  const stillPinnedWhenAtBottom = await scrollContainer.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop < 5);

  await desktop.getByRole('button', { name: /^(Close|Reopen)$/ }).click();
  await desktopCtx.close();

  console.log('MSG-1 PART (b) RESULT -- LOCAL-browser evidence, head of fix/msg1-remaining-points-and-autoscroll (post auto-scroll fix):');
  console.log(`  first message bubble's DOM node survived ~90s of idle background polling (should be TRUE, i.e. no full remount): ${!remountedDuringIdle}`);
  console.log(`  scroll position stayed put during idle polling, nothing new arriving (should be TRUE): ${!scrollJumpedDuringIdle}`);
  console.log(`  scrollTop: manual=${scrollTopAfterManualScroll}, after idle=${scrollTopAfterIdle}, after a genuinely new message arrived=${scrollTopAfterNewMessage}`);
  console.log(`  view stayed where the viewer left it when a new message arrived while scrolled up (should now be TRUE, post-fix): ${!jumpedToBottomOnNewMessage}`);
  console.log(`  still pins to the bottom when a new message arrives and the viewer WAS already there (should be TRUE -- fix must not break the normal case): ${stillPinnedWhenAtBottom}`);
  console.log(`  GET /conversations/:id hits over the run (bounded-pattern check): ${detailApiHits}`);
  console.log(`  GET /conversations (list) hits over the run (should be small -- list is not on a polling interval, only mount + own mutations): ${listApiHits}`);

  expect(remountedDuringIdle, 'an idle background poll (no new message) must not recreate existing message DOM nodes').toBe(false);
  expect(scrollJumpedDuringIdle, 'an idle background poll (no new message) must not move the scroll position').toBe(false);
  expect(jumpedToBottomOnNewMessage, 'a viewer scrolled away from the bottom must not be yanked down when a new message arrives').toBe(false);
  expect(stillPinnedWhenAtBottom, 'a viewer already at the bottom must still land on a genuinely new message').toBe(true);
  expect(detailApiHits, 'request pattern must be bounded (~1 per 15s poll), not an uncontrolled loop').toBeLessThan(40);
  // One GET per deliberate mutation (mount, support-create, each of the 7
  // sends, close) is expected and correct -- bounded by actions taken, not
  // time elapsed. 20 gives headroom while still catching an actual
  // time-based polling loop, which would be in the hundreds over ~2 minutes.
  expect(listApiHits, 'the conversation list must not be on its own polling interval').toBeLessThan(20);
});

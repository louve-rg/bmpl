import { test, expect, type Page, type Browser } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { tryLogin, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD } from './support/auth';

/**
 * *** THESE 4 TESTS NEVER RUN IN CI, SAME SHAPE AS
 * *** authenticated-dashboard-geometry.local-only.spec.ts -- see that file's
 * *** header for the full explanation. Short version: /dashboard/messages is
 * *** authenticated, CI's browser step provisions no live API/seeded
 * *** database, and the owner has twice declined to build one just for this.
 * *** Every test below calls `test.skip()` on every CI run, by design.
 *
 * MDF-195 (owner-required, 2026-10-10): the messages two-pane split's back
 * button was only ever verified by SOURCE INSPECTION -- tracing both
 * `onClick={onBack}` handlers to the same real `backToList` callback
 * (apps/web/app/dashboard/messages/page.tsx). The owner ruled that
 * insufficient: a dead handler on one of the two entry points is exactly the
 * failure mode source-reading cannot rule out, so this file actually clicks
 * both buttons and asserts the list pane returns.
 *
 * TWO ENTRY POINTS, BOTH TESTED, BECAUSE #364 MOVED THE SPLIT FROM `md` TO
 * `lg` ACROSS EVERY PANE THAT HAS ONE:
 *   - ThreadPane's back button (shown after selecting a conversation)
 *   - SupportForm's back button (shown after clicking "Contact support")
 * Both buttons share the exact same aria-label ("Back to conversations") and
 * the same `lg:hidden` class -- they are mutually exclusive in the DOM
 * (ThreadPane and SupportForm are alternatives in the same ternary), so a
 * single `getByRole('button', { name: 'Back to conversations' })` locator is
 * never ambiguous within one test.
 *
 * BOTH WIDTHS TESTED ARE BELOW THE `lg` (1024px) BREAKPOINT ON PURPOSE --
 * that is the only range where the back button renders at all
 * (`lg:hidden`); above it the list and thread panes show side by side and
 * there is nothing to click back to. 375px is a representative phone width;
 * 900px sits just inside the two-pane split's own defect window
 * (768-~1023px, see the thread-pane EmptyState test in the geometry file)
 * without crossing into the side-by-side layout, so the interaction is
 * proven right up against the boundary, not just at the easy case.
 *
 * NO REAL CONVERSATION DATA NEEDED. Entering ThreadPane and SupportForm are
 * both real clicks (selecting a conversation row / clicking "Contact
 * support"), but the conversation list and thread detail are served from
 * `page.route()` mocks confined to `/api/conversations*` -- the same pattern
 * the geometry file's own messages tests use, and for the same reason: the
 * seeded dev account's real conversations are incidental residue, and a
 * mock keeps this test independent of whatever happens to be in that
 * account on a given day. The login itself is real (real cookies, the
 * actual /dashboard route guard).
 */

const WIDTHS = [375, 900];
const STORAGE_PATH = path.join(os.tmpdir(), `bmpl-e2e-super-admin-state-messages-back-${process.pid}.json`);

const MOCK_CONVERSATION_ID = 'mock-back-button-1';
const MOCK_CONVERSATIONS = [
  {
    id: MOCK_CONVERSATION_ID,
    contextType: 'SUPPORT_CASE',
    pairing: 'USER_SUPPORT',
    subject: 'E2E back-button fixture',
    status: 'OPEN',
    contextLabel: 'Support',
    lastMessage: { preview: 'Fixture conversation for MDF-195.', type: 'TEXT', createdAt: new Date().toISOString() },
    lastMessageAt: new Date().toISOString(),
    unreadCount: 0,
  },
];
const MOCK_CONVERSATION_DETAIL = {
  id: MOCK_CONVERSATION_ID,
  contextType: 'SUPPORT_CASE',
  contextId: 'fixture-context',
  pairing: 'USER_SUPPORT',
  subject: 'E2E back-button fixture',
  contextLabel: 'Support',
  status: 'OPEN',
  viewerRole: 'CUSTOMER',
  canSend: true,
  participants: [],
  messages: [],
};

let loginOk = false;

test.beforeAll(async ({ browser }) => {
  if (!SUPER_ADMIN_PASSWORD) return;
  const context = await browser.newContext();
  const page = await context.newPage();
  loginOk = await tryLogin(page, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  if (loginOk) await context.storageState({ path: STORAGE_PATH });
  await context.close();
});

test.afterAll(() => {
  fs.rmSync(STORAGE_PATH, { force: true });
});

function skipIfNoSession() {
  test.skip(!SUPER_ADMIN_PASSWORD || !loginOk, 'Needs a live API + seeded dev database with SEED_SUPER_ADMIN_PASSWORD set -- not provisioned in CI. See file header.');
}

async function authedPage(browser: Browser, width: number, height = 900): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: STORAGE_PATH, viewport: { width, height } });
  const page = await context.newPage();
  await page.route('**/api/conversations', (r) => r.fulfill({ json: MOCK_CONVERSATIONS }));
  await page.route(`**/api/conversations/${MOCK_CONVERSATION_ID}`, (r) => r.fulfill({ json: MOCK_CONVERSATION_DETAIL }));
  await page.route(`**/api/conversations/${MOCK_CONVERSATION_ID}/read`, (r) => r.fulfill({ status: 204, body: '' }));
  return { page, close: () => context.close() };
}

async function expectListPaneVisible(page: Page) {
  const list = page.getByRole('list', { name: 'Conversations' });
  await expect(list).toBeVisible();
  await expect(page.getByRole('button', { name: /E2E back-button fixture/ })).toBeVisible();
}

test.describe('[LOCAL ONLY, skips in CI -- see file header] messages back button returns to the list, both entry points, below lg', () => {
  for (const width of WIDTHS) {
    test(`ThreadPane's back button returns to the list at ${width}px`, async ({ browser }) => {
      skipIfNoSession();
      const { page, close } = await authedPage(browser, width);
      await page.goto('/dashboard/messages');

      await page.getByRole('button', { name: /E2E back-button fixture/ }).click();
      const backButton = page.getByRole('button', { name: 'Back to conversations' });
      await expect(backButton).toBeVisible();

      await backButton.click();
      await expectListPaneVisible(page);

      await close();
    });

    test(`SupportForm's back button returns to the list at ${width}px`, async ({ browser }) => {
      skipIfNoSession();
      const { page, close } = await authedPage(browser, width);
      await page.goto('/dashboard/messages');

      await page.getByRole('button', { name: 'Contact support' }).click();
      const backButton = page.getByRole('button', { name: 'Back to conversations' });
      await expect(backButton).toBeVisible();
      await expect(page.getByLabel('Subject')).toBeVisible();

      await backButton.click();
      await expectListPaneVisible(page);

      await close();
    });
  }
});

import { test, expect, type Page, type Browser } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { tryLogin, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, UAT_FIXTURE_PASSWORD } from './support/auth';

/**
 * [LOCAL ONLY, REL-TERMINAL-DEAD-ENDS] Written before the local stack this
 * needs was confirmed ready (Dwight/Stanley were mid-rebuild at the time),
 * same honest-draft convention as mdf705-terminal-manager-operator-login's
 * own header -- read this file's assertions as what WOULD make it fail, not
 * as a run that has happened yet. Run with `pnpm --filter @bmpl/web
 * test:e2e:local-only` once a live API + seeded database (UATBC/UATBP
 * simulation hubs from seed-uat-logistics.ts) is reachable.
 *
 * The owner's own wording, from Michael's dispatch: "Handle errors with
 * understandable messages" and "Navigate the workspace without broken
 * buttons or dead ends." Nobody had walked the terminal workspace's SURFACE
 * before this -- Jim/Stanley walk the happy path and its refusals, this
 * walks every tab, control, empty state and error state a clerk can reach,
 * on desktop and mobile. Four things asserted, in the owner's stated order
 * of value:
 *   1. every control is reachable and does something (a click changes the
 *      page, never nothing)
 *   2. every state can be left (no dead end, no spinner that never resolves)
 *   3. error states render human text (never a raw exception or status code)
 *   4. mobile viewport reachability (nothing clipped or unreachable at
 *      phone width)
 *
 * Deliberately NOT covered here: the five queue-category tabs (Depart/
 * Arrive/Hand off/Release/Collect) with a NON-EMPTY queue. Seeding a real
 * queue item means booking and partially progressing a real shipment (the
 * same heavy setup mdf587-handoff-negative-cases.local-only.spec.ts does
 * for ONE case) -- out of scope for a surface sweep whose job is dead
 * ends and error copy, not re-proving business logic already covered by
 * page.test.tsx's unit suite and mdf587's negative cases. With an EMPTY
 * queue, every category tab legitimately renders the SAME "Nothing waiting
 * at your locations" copy as Overview (page.tsx: `rows.length === 0` is
 * checked before `tab === 'OVERVIEW'`) -- that is correct, honest behavior,
 * not a dead end, so this file asserts tab SELECTION state (aria-selected)
 * rather than wrongly expecting distinct panel text from every tab.
 */
const ADMIN_EMAIL = SUPER_ADMIN_EMAIL;
const ADMIN_PASSWORD = SUPER_ADMIN_PASSWORD;
const stamp = Date.now();
const STORAGE_PATH = path.join(os.tmpdir(), `bmpl-e2e-term-sweep-manager-state-${process.pid}.json`);

async function postWithCsrf<T>(page: Page, path: string, body: unknown, method: 'POST' | 'PATCH' = 'POST'): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ({ path, body, method }) => {
      let csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
      if (!csrfToken) {
        await fetch('/api/auth/csrf', { credentials: 'include', cache: 'no-store' }).catch(() => {});
        csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
      }
      csrfToken = csrfToken ? decodeURIComponent(csrfToken) : undefined;
      const res = await fetch(`/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      return { status: res.status, body: parsed };
    },
    { path, body, method },
  ) as Promise<{ status: number; body: T }>;
}

async function getJson<T>(page: Page, path: string): Promise<{ status: number; body: T }> {
  return page.evaluate(async (path) => {
    const res = await fetch(`/api${path}`, { credentials: 'include' });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, path) as Promise<{ status: number; body: T }>;
}

async function adminLogin(page: Page): Promise<void> {
  expect(ADMIN_PASSWORD, 'SEED_SUPER_ADMIN_PASSWORD not set in this environment -- hard stop, not a skip').toBeTruthy();
  expect(await tryLogin(page, ADMIN_EMAIL, ADMIN_PASSWORD!), 'admin login failed -- hard stop, not a skip').toBeTruthy();
}

/** Same real admin-console-API + real public-accept-invite path as
 * mdf705-terminal-manager-operator-login.local-only.spec.ts -- MANAGER so
 * every tab, including Staff, is visible. No DB shortcut. */
async function createManagerStaff(adminPage: Page): Promise<string> {
  const { status: hubsStatus, body: hubs } = await getJson<Array<{ id: string; code: string }>>(adminPage, '/admin/logistics/hubs');
  expect(hubsStatus).toBe(200);
  const hubA = hubs.find((h) => h.code === 'UATBC');
  expect(hubA, 'UATBC simulation hub not found -- expected from seed-uat-logistics.ts').toBeTruthy();

  const company = await postWithCsrf<{ id: string }>(adminPage, '/admin/terminal/companies', {
    businessName: `TERM-SWEEP Co ${stamp}`,
    contactEmail: `term-sweep-co-${stamp}@example.bz`,
    isTest: true,
  });
  expect(company.status, 'terminal company creation failed').toBe(201);
  const companyId = company.body.id;

  const loc = await postWithCsrf<{ id: string }>(adminPage, `/admin/terminal/companies/${companyId}/locations`, { hubId: hubA!.id });
  expect(loc.status, 'adding location failed').toBe(201);

  const email = `term-sweep-manager-${stamp}@example.bz`;
  const invite = await postWithCsrf<{ id: string }>(adminPage, `/admin/terminal/companies/${companyId}/invites`, {
    email,
    memberRole: 'MANAGER',
    locationIds: [loc.body.id],
  });
  expect(invite.status, 'inviting the MANAGER failed').toBe(201);

  const mailbox = await getJson<{ body: string }>(adminPage, `/dev/emails/latest?email=${encodeURIComponent(email)}`);
  expect(mailbox.status, 'dev mailbox did not capture the invite email -- is NODE_ENV production?').toBe(200);
  const token = mailbox.body.body.match(/token=([^"&\s]+)/)?.[1];
  expect(token, 'could not find the invite token in the captured email body').toBeTruthy();

  const staffPage = await adminPage.context().browser()!.newContext().then((c) => c.newPage());
  await staffPage.goto('/');
  const accepted = await postWithCsrf<{ accepted: boolean }>(staffPage, '/terminal/invites/accept', {
    token,
    password: UAT_FIXTURE_PASSWORD,
    firstName: 'Sweep',
    lastName: 'Manager',
  });
  expect(accepted.status, 'accept-invite failed').toBe(201);
  await staffPage.close();

  return email;
}

const ALL_TAB_LABELS = ['Overview', 'Depart', 'Arrive', 'Hand off', 'Release', 'Collect', 'Staff', 'Lookup'];

async function gotoTerminalWorkspace(page: Page): Promise<void> {
  await page.goto('/dashboard/terminal');
  // Workspace loads before the tab bar does (two sequential effects --
  // page.tsx's own comment on the queue-load effect notes this exact order).
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible({ timeout: 15_000 });
}

let loginOk = false;

test.beforeAll(async ({ browser }) => {
  if (!ADMIN_PASSWORD) return;
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await adminLogin(adminPage);
  const email = await createManagerStaff(adminPage);
  await adminContext.close();

  const staffContext = await browser.newContext();
  const staffPage = await staffContext.newPage();
  loginOk = await tryLogin(staffPage, email, UAT_FIXTURE_PASSWORD);
  if (loginOk) await staffContext.storageState({ path: STORAGE_PATH });
  await staffContext.close();
});

test.afterAll(() => {
  fs.rmSync(STORAGE_PATH, { force: true });
});

function skipIfNoSession() {
  test.skip(!ADMIN_PASSWORD || !loginOk, 'Needs a live API + seeded dev database with SEED_SUPER_ADMIN_PASSWORD set, and UATBC simulation hub seeded -- not provisioned in CI. See file header.');
}

async function managerPage(browser: Browser, viewport?: { width: number; height: number }): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: STORAGE_PATH, ...(viewport ? { viewport } : {}) });
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

/* ========================================================== PRIORITY 1:
   every control is reachable and does something */

test('every tab is visible, enabled, and selecting it updates aria-selected (desktop)', async ({ browser }) => {
  skipIfNoSession();
  const { page, close } = await managerPage(browser);
  await gotoTerminalWorkspace(page);

  for (const label of ALL_TAB_LABELS) {
    const tabBtn = page.getByRole('tab', { name: label });
    await expect(tabBtn, `"${label}" tab missing or not visible`).toBeVisible();
    await expect(tabBtn, `"${label}" tab is disabled`).toBeEnabled();
    await tabBtn.click();
    await expect(tabBtn, `clicking "${label}" did not select it (aria-selected never became true)`).toHaveAttribute('aria-selected', 'true');
  }

  await close();
});

test('Staff and Lookup tabs render genuinely distinct content, not a shared placeholder', async ({ browser }) => {
  skipIfNoSession();
  const { page, close } = await managerPage(browser);
  await gotoTerminalWorkspace(page);

  await page.getByRole('tab', { name: 'Staff' }).click();
  await expect(page.getByText(/^Members \(/), 'Staff tab did not render its own Members roster heading').toBeVisible();

  await page.getByRole('tab', { name: 'Lookup' }).click();
  await expect(page.locator('#lookup-reference'), 'Lookup tab did not render its reference input').toBeVisible();
  await expect(page.getByRole('button', { name: 'Look up' }), 'Lookup tab did not render its own Look up button').toBeVisible();

  await close();
});

test('the Refresh button round-trips -- it does not hang on "Refreshing…" forever', async ({ browser }) => {
  skipIfNoSession();
  const { page, close } = await managerPage(browser);
  await gotoTerminalWorkspace(page);

  const refreshBtn = page.getByRole('button', { name: /^Refresh(ing…)?$/ });
  await expect(refreshBtn).toBeEnabled();
  await refreshBtn.click();
  // Either it never visibly entered the loading label (fast local network)
  // or it did and came back -- either way "Refresh" must be the resting
  // state again within a real timeout, not stuck on "Refreshing…".
  await expect(refreshBtn, 'Refresh button never returned to its resting label -- looks hung').toHaveText('Refresh', { timeout: 10_000 });

  await close();
});

/* ========================================================== PRIORITY 2 + 3:
   every state can be left, and error states render human text */

test('an empty Lookup submit shows a human validation message, not a silent no-op, and the input keeps its focus-ability', async ({ browser }) => {
  skipIfNoSession();
  const { page, close } = await managerPage(browser);
  await gotoTerminalWorkspace(page);
  await page.getByRole('tab', { name: 'Lookup' }).click();

  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.getByText('Enter a reference to look up.'), 'empty submit produced no visible message').toBeVisible();

  // Not a dead end: the input is still there and usable after the error.
  const input = page.locator('#lookup-reference');
  await input.fill('BML-DOES-NOT-EXIST');
  await expect(input, 'input discarded what was typed after the earlier validation error').toHaveValue('BML-DOES-NOT-EXIST');

  await close();
});

test('an invalid reference shows a human error message (never a raw status code or exception), and the screen is not stuck afterward', async ({ browser }) => {
  skipIfNoSession();
  const { page, close } = await managerPage(browser);
  await gotoTerminalWorkspace(page);
  await page.getByRole('tab', { name: 'Lookup' }).click();

  const bogusReference = `BML-SWEEP-${stamp}`;
  await page.locator('#lookup-reference').fill(bogusReference);
  await page.getByRole('button', { name: 'Look up' }).click();

  // page.tsx's own lookup() sets a fallback 'Could not look up that
  // reference.' on any failure (errMessage(e, fallback)) -- it must never
  // surface as a bare "404", "[object Object]" or a stack trace instead.
  const errorText = page.locator('p.text-amber-800');
  await expect(errorText, 'no error text rendered for an invalid reference').toBeVisible({ timeout: 10_000 });
  const text = (await errorText.textContent())?.trim() ?? '';
  expect(text.length, 'error text was empty').toBeGreaterThan(0);
  expect(text, `error text looked like a raw status/exception, not human copy: "${text}"`).not.toMatch(/^\d{3}$/);
  expect(text, `error text looked like a raw status/exception, not human copy: "${text}"`).not.toMatch(/\[object Object\]|^Error:|TypeError|at\s+\w+\s*\(/);

  // Not a dead end: this screen can still be left -- another tab is
  // reachable and actually selects, with the earlier error not following
  // the clerk to a tab it has nothing to do with.
  const overviewTab = page.getByRole('tab', { name: 'Overview' });
  await overviewTab.click();
  await expect(overviewTab, 'could not leave the Lookup error state for another tab').toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(bogusReference), 'the stale Lookup error followed the clerk onto an unrelated tab').not.toBeVisible();

  await close();
});

/* ========================================================== PRIORITY 4:
   mobile viewport reachability */

test('every tab is reachable and clickable at phone width (375px) -- nothing clipped or covered', async ({ browser }) => {
  skipIfNoSession();
  const { page, close } = await managerPage(browser, { width: 375, height: 667 });
  await gotoTerminalWorkspace(page);

  for (const label of ALL_TAB_LABELS) {
    const tabBtn = page.getByRole('tab', { name: label });
    await tabBtn.scrollIntoViewIfNeeded();
    const box = await tabBtn.boundingBox();
    expect(box, `"${label}" tab has no layout box at 375px -- not rendered`).not.toBeNull();
    expect(box!.width, `"${label}" tab has zero width at 375px`).toBeGreaterThan(0);
    // A real click: Playwright itself refuses (and this test then fails
    // loudly) if another element visually covers the target -- this is the
    // actual "unreachable control" check the owner asked for, not a
    // geometry approximation of it.
    await tabBtn.click();
    await expect(tabBtn, `"${label}" tab did not select at 375px`).toHaveAttribute('aria-selected', 'true');
  }

  const refreshBtn = page.getByRole('button', { name: /^Refresh(ing…)?$/ });
  await refreshBtn.scrollIntoViewIfNeeded();
  await expect(refreshBtn, 'Refresh button not visible at 375px').toBeVisible();
  await expect(refreshBtn, 'Refresh button not enabled at 375px').toBeEnabled();

  await close();
});

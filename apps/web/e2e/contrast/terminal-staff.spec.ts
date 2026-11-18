import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loginAsRole, tryLogin, UAT_FIXTURE_PASSWORD } from '../support/auth';
import { settleForSnapshot, CONTRAST_VIEWPORTS } from '../support/visual';
import { sweepContrast, formatSweepReport, writeSweepResultRecords } from '../support/contrast-sweep';
import { assertRatchet, assertAllWidthsExamined, type KnownViolationEntry } from '../support/contrast-ratchet';

/**
 * CONTRAST-TERMINAL-COVERAGE (god, 2026-11-18, conv-d8165f): the contrast
 * gate (requirement 7) has never once looked at the Terminal Workspace --
 * the six existing specs in this directory cover analytics/products/
 * settlements/store(-preview)/vendors only. That gap is what let a real
 * violation (the Staff tab's location chip, 1.01:1 -- near-white text on a
 * near-white `bg-slate-50` chip, the glass theme's `--bmpl-text-secondary`
 * token resolving to a value meant for a DARK glass fill, not this chip's
 * own hardcoded light one) reach production invisibly through a green CI
 * run. Fixed in PR #779 (`text-slate-700` hardcoded, measured 9.90:1).
 *
 * NO COMMITTED TERMINAL-MEMBER FIXTURE EXISTS (checked `../support/auth.ts`'s
 * own `ROLE_FIXTURES` directly -- its header comment says explicitly that a
 * role code with no entry there has no reproducible fixture yet, and
 * TERMINAL_COMPANY has none). This does NOT mean the gate has to skip,
 * invent a credential, or point at production -- an already-proven
 * mechanism for exactly this already runs in THIS SAME CI job today:
 * `createTerminalManager()` in
 * `mdf720-terminal-membership-loading-state.local-only.spec.ts` (wired into
 * `ci.yml`'s `visual-regression` job as the `term-nav` step) creates a real
 * terminal company + MANAGER through the real admin-console API and the
 * real invite-accept flow -- no DB write, no weakened auth, built entirely
 * on dependencies this exact job already seeds (`seed.ts`'s SUPER_ADMIN,
 * `seed-uat-logistics.ts`'s UATBC hub). Reimplemented here (not imported
 * from that file -- it's `.local-only` and this spec must not create a
 * dependency on a file CI is forbidden from running by its own name) rather
 * than invented fresh.
 */

const VIEWPORTS = CONTRAST_VIEWPORTS;
const ROUTE = '/dashboard/terminal';
const KNOWN_VIOLATIONS: KnownViolationEntry[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'contrast-known-violations.json'), 'utf8'),
);

async function postWithCsrf<T>(page: Page, apiPath: string, body: unknown): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ({ apiPath, body }) => {
      let csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
      if (!csrfToken) {
        await fetch('/api/auth/csrf', { credentials: 'include', cache: 'no-store' }).catch(() => {});
        csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
      }
      csrfToken = csrfToken ? decodeURIComponent(csrfToken) : undefined;
      const res = await fetch(`/api${apiPath}`, {
        method: 'POST',
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
    { apiPath, body },
  ) as Promise<{ status: number; body: T }>;
}

async function getJson<T>(page: Page, apiPath: string): Promise<{ status: number; body: T }> {
  return page.evaluate(async (apiPath) => {
    const res = await fetch(`/api${apiPath}`, { credentials: 'include' });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  }, apiPath) as Promise<{ status: number; body: T }>;
}

/**
 * A real, genuinely-granted terminal MANAGER with at least one location
 * grant on their own membership, so the Staff tab's roster renders their
 * own card WITH a location chip (the exact element PR #779 fixed) -- not
 * an empty roster. Same mechanism as `createTerminalManager` in MDF-720's
 * local-only spec; see this file's header comment for why it isn't shared.
 */
async function createTerminalManagerWithLocation(adminPage: Page, label: string): Promise<{ email: string; password: string }> {
  const { body: hubs } = await getJson<Array<{ id: string; code: string }>>(adminPage, '/admin/logistics/hubs');
  const hub = hubs.find((h) => h.code === 'UATBC');
  expect(hub, 'UATBC simulation hub not found -- seed-uat-logistics.ts not applied to this database').toBeTruthy();

  const stamp = Date.now();
  const company = await postWithCsrf<{ id: string }>(adminPage, '/admin/terminal/companies', {
    businessName: `Contrast ${label} Co ${stamp}`,
    contactEmail: `contrast-${label.toLowerCase()}-co-${stamp}@example.bz`,
    isTest: true,
  });
  expect(company.status, `company create failed: ${JSON.stringify(company.body)}`).toBe(201);

  const loc = await postWithCsrf<{ id: string }>(adminPage, `/admin/terminal/companies/${company.body.id}/locations`, { hubId: hub!.id });
  expect(loc.status, `location create failed: ${JSON.stringify(loc.body)}`).toBe(201);

  const email = `contrast-${label.toLowerCase()}-manager-${stamp}@example.bz`;
  const invite = await postWithCsrf<{ id: string }>(adminPage, `/admin/terminal/companies/${company.body.id}/invites`, {
    email,
    memberRole: 'MANAGER',
    locationIds: [loc.body.id],
  });
  expect(invite.status, `invite failed: ${JSON.stringify(invite.body)}`).toBe(201);

  const mailbox = await getJson<{ body: string }>(adminPage, `/dev/emails/latest?email=${encodeURIComponent(email)}`);
  const token = mailbox.body.body.match(/token=([^"&\s]+)/)?.[1];
  expect(token, 'invite-accept token not found in the dev mailbox -- /dev/emails not available in this environment').toBeTruthy();

  const password = UAT_FIXTURE_PASSWORD;
  // Relative, not a hardcoded port -- this config's own dev server runs on
  // CONTRAST_PORT (3179), a DIFFERENT port from the local-only suite's 3177
  // (apps/web/e2e/support/server.ts's own comment on why they're split).
  // `page.goto('/')` picks up `use.baseURL` from playwright.contrast.config.ts.
  const acceptPage = await adminPage.context().browser()!.newContext().then((c) => c.newPage());
  await acceptPage.goto('/');
  const accept = await postWithCsrf<{ ok?: boolean }>(acceptPage, '/terminal/invites/accept', { token, password, firstName: label, lastName: 'Manager' });
  await acceptPage.close();
  expect(accept.status, `invite-accept failed: ${JSON.stringify(accept.body)}`).toBe(201);

  return { email, password };
}

// See analytics.spec.ts for the full mechanism this comment is a copy of
// (Playwright restarts its worker after a failed test, resetting this
// module -- workers:1/fullyParallel:false rules out parallel splitting
// only, not that).
const discoveredPassNames = new Set<string>();
let contributedCount = 0;

function recordPassNames(result: { text: { pass: Array<{ element: { accessibleRole: string | null; accessibleName: string | null } }> }; icon: { pass: Array<{ element: { accessibleRole: string | null; accessibleName: string | null } }> } }): void {
  contributedCount += 1;
  for (const reading of [...result.text.pass, ...result.icon.pass]) {
    discoveredPassNames.add(`role=${reading.element.accessibleRole ?? '(none)'} name="${reading.element.accessibleName ?? '(none)'}"`);
  }
}

// Created ONCE for the whole file, not per viewport -- the admin-console
// company/invite/accept round trip is real network cost (several real
// requests plus a real email-delivery check), and nothing about contrast
// depends on creating a fresh company per width. Every per-viewport test
// below just logs the one account back in with a fresh page/context.
let managerCredentials: { email: string; password: string } | null = null;
let setupFailureReason: string | null = null;

test.describe('contrast: terminal workspace (staff management)', () => {
  test.beforeAll(async ({ browser }) => {
    try {
      const adminPage = await (await browser.newContext()).newPage();
      const loggedIn = await loginAsRole(adminPage, 'SUPER_ADMIN');
      if (!loggedIn) {
        setupFailureReason = 'SUPER_ADMIN login failed -- needs SEED_SUPER_ADMIN_PASSWORD set and a live API + seeded dev database.';
        return;
      }
      managerCredentials = await createTerminalManagerWithLocation(adminPage, 'Contrast');
      await adminPage.close();
    } catch (e) {
      setupFailureReason = `terminal MANAGER fixture setup threw: ${(e as Error).message}`;
    }
  });

  test.afterAll(() => {
    const scope = contributedCount >= VIEWPORTS.length * 2 ? 'across all widths/tabs' : `across the ${contributedCount} width/tab run(s) this worker completed before restarting (NOT all ${VIEWPORTS.length * 2} -- see this block's own comment)`;
    console.log(`[contrast] web ${ROUTE} -- pass-bucket elements discovered ${scope}, contributed=${contributedCount}/${VIEWPORTS.length * 2} (deduped by role+name):`);
    if (discoveredPassNames.size === 0) {
      console.log('  (none -- either nothing passed at any contributing width, or every test above was skipped/threw)');
    } else {
      for (const name of [...discoveredPassNames].sort()) console.log(`  - ${name}`);
    }
    // Deliberately unconditional, same as every fixture-dependent spec in
    // this directory (store.spec.ts/vendors.spec.ts): a setup failure that
    // makes every test above `test.skip` must fail THIS assertion loudly,
    // not read as a quiet, all-green nothing-to-see-here run. God's own
    // instruction for this card: "SAY SO AND STOP ... I would rather hear
    // that it needs a fixture than get a spec that quietly skips."
    assertAllWidthsExamined(contributedCount, VIEWPORTS.length * 2, { route: ROUTE });
  });

  for (const viewport of VIEWPORTS) {
    test(`${ROUTE} (Overview tab) has no un-allowlisted contrast violations at ${viewport}px`, async ({ page }) => {
      test.skip(!managerCredentials, setupFailureReason ?? 'terminal MANAGER fixture not available');

      expect(await tryLogin(page, managerCredentials!.email, managerCredentials!.password)).toBeTruthy();
      await page.setViewportSize({ width: viewport, height: 900 });
      await page.goto(ROUTE);
      await settleForSnapshot(page);
      await page.waitForTimeout(500);

      const result = await sweepContrast(page);
      console.log(formatSweepReport(`web ${ROUTE} Overview @ ${viewport}px`, result));
      recordPassNames(result);
      writeSweepResultRecords(result, { route: ROUTE, viewport });

      if (result.text.measuredCount === 0) {
        throw new Error(`contrast sweep measured ZERO text elements on ${ROUTE} (Overview) at ${viewport}px -- this is a false clean, not a pass. Investigate before trusting this run.`);
      }

      const scoped = KNOWN_VIOLATIONS.filter((e) => e.route === ROUTE && e.viewport === viewport);
      assertRatchet(result, scoped, { route: ROUTE, viewport });
    });

    test(`${ROUTE} (Staff tab) has no un-allowlisted contrast violations at ${viewport}px`, async ({ page }) => {
      test.skip(!managerCredentials, setupFailureReason ?? 'terminal MANAGER fixture not available');

      expect(await tryLogin(page, managerCredentials!.email, managerCredentials!.password)).toBeTruthy();
      await page.setViewportSize({ width: viewport, height: 900 });
      await page.goto(ROUTE);
      await settleForSnapshot(page);

      // Staff is MANAGER-only and not the default tab -- open it, same
      // accessible-name caution as every other tab locator in this suite
      // (an un-exact'd role name can collide with an appended count badge
      // rendered in the same button, e.g. "Staff" + "1" -> "Staff1"; a
      // regex anchored to the start avoids that without needing exact:true
      // to reject the legitimate count suffix).
      await page.getByRole('tab', { name: /^Staff/ }).click();
      await settleForSnapshot(page);
      await page.waitForTimeout(500);
      // Positive control: the roster's own "Members (N)" heading proves the
      // Staff panel actually rendered, not a blank/still-Overview page --
      // so a zero-measured-element failure below means something.
      await expect(page.getByText(/^Members \(/), 'Staff panel never actually rendered (would make the sweep below meaningless)').toBeVisible({ timeout: 15_000 });

      const result = await sweepContrast(page);
      console.log(formatSweepReport(`web ${ROUTE} Staff @ ${viewport}px`, result));
      recordPassNames(result);
      writeSweepResultRecords(result, { route: `${ROUTE}#staff`, viewport });

      if (result.text.measuredCount === 0) {
        throw new Error(`contrast sweep measured ZERO text elements on ${ROUTE} (Staff) at ${viewport}px -- this is a false clean, not a pass. Investigate before trusting this run.`);
      }

      const scoped = KNOWN_VIOLATIONS.filter((e) => e.route === `${ROUTE}#staff` && e.viewport === viewport);
      assertRatchet(result, scoped, { route: `${ROUTE}#staff`, viewport });
    });
  }
});

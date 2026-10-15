import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { tryLogin, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD } from './support/auth';

/**
 * *** LOCAL ONLY, SKIPS IN CI -- same reason as authenticated-dashboard-
 * *** geometry.local-only.spec.ts: /dashboard/* does a server-side
 * *** serverGet('/me') (apps/web/app/dashboard/layout.tsx) that
 * *** page.route() cannot intercept, so this needs a real live API behind
 * *** a real login, not a mock. Run locally against
 * *** `pnpm infra:up` + a running `apps/api` + SEED_SUPER_ADMIN_PASSWORD set.
 *
 * EndpointPicker.tsx:174-178 renders a selected hub's operator-entered
 * `instructions` in a plain `<p className="mt-2 ... text-sm text-slate-600">`
 * with no `break-words`/`overflow-wrap`, on free text an operator can type
 * anything into. Only renders in HUB mode (HUB_TO_HUB/DOOR_TO_HUB/
 * HUB_TO_DOOR) once a hub with `instructions` is selected.
 *
 * Two pieces were needed, not one -- `break-words` alone (the fix in the
 * five already-shipped overflow fixes, PR #390/#391/#392/#397/#436) was
 * confirmed INSUFFICIENT here: the enclosing `<fieldset>` carries a
 * browser UA-stylesheet default of `min-width: min-content`, which
 * `overflow-wrap`/`break-word` cannot shrink -- per spec, that property is
 * explicitly excluded from the intrinsic (min-content) size calculation,
 * so the fieldset stayed pinned to the unbroken word's full width (823px
 * measured at a 320px viewport) even with break-words on the text itself.
 * Same family of bug as the grid/flex-item `min-width: auto` the other
 * five fixes neutralize with `min-w-0`, but the culprit here is a plain
 * `<fieldset>`'s OWN default, not a flex/grid ancestor. Confirmed both
 * pieces load-bearing the same way PR #397 did: break-words alone left the
 * fieldset (and therefore the <p>) at the full 789-823px regardless of
 * viewport; `min-w-0` on the fieldset together with break-words on the <p>
 * is what actually lets it wrap to the viewport (254px/3 lines measured at
 * 320px).
 *
 * Measured against the REAL public hub list (`GET /api/shipping/hubs`),
 * which hardcodes `isTest: false` (logistics-network.service.ts
 * publicHubs()) -- a simulation hub is invisible to this endpoint under any
 * session, so a seeded isTest fixture cannot exercise this at all. This
 * spec instead temporarily sets a long, single-unbroken-word `instructions`
 * value on the existing REHBC fixture hub (packages/database seed, isTest:
 * false already) via the real admin API, and restores the original value
 * (null) in `afterAll` -- no fixture row is created or left behind.
 *
 * NOT measured via document.documentElement.scrollWidth, and not via the
 * <p>'s own scrollWidth-vs-clientWidth either -- both read clean here even
 * though the element is genuinely broken. The <p> is a plain block (no
 * flex/grid parent), so its own box simply grows to match its unbreakable
 * content (789px measured) instead of being constrained by its container;
 * nothing inside IT overflows ITS OWN box, so the self-check is vacuous.
 * That 789px-wide box then gets clipped -- not scrolled -- by
 * apps/web/app/dashboard/layout.tsx:22's `overflow-x-hidden` on the
 * dashboard shell, several ancestors up, which absorbs the overflow before
 * it ever reaches document.documentElement (confirmed: scrollWidth ==
 * clientWidth == window.innerWidth at every tested width, even though the
 * <p> visibly runs off the right edge of the viewport). Same invisible-clip
 * shape as the MDF-179 header-cluster defect this file's sibling spec
 * documents -- the only instrument that catches it is comparing the
 * element's own boundingBox against the viewport, not against itself.
 */

const WIDTHS = [320, 375, 768, 1024, 1440];
const STORAGE_PATH = path.join(os.tmpdir(), `bmpl-e2e-endpoint-picker-admin-state-${process.pid}.json`);

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4998';
const REHBC_ID = 'cmtnbnfz0004f12vt0395bjlm';
// A deliberately pathological single, unbroken "word" -- the exact shape
// that defeats ordinary word-wrap, same technique as the other four specs
// in this family (shipment-new-parcel-description-overflow.spec.ts etc).
const LONG_INSTRUCTIONS =
  'Pickup window is strictly between the posted terminal hours and only staff wearing a visible ' +
  'BMLidentificationbadgemayacceptashipmentonthecompanysbehalfunderanycircumstanceswhatsoeverincludingemergencies';

let loginOk = false;
let csrfToken = '';
let sessionCookieHeader = '';

async function patchHubInstructions(value: string) {
  const res = await fetch(`${API_URL}/api/admin/logistics/hubs/${REHBC_ID}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
      Cookie: sessionCookieHeader,
    },
    body: JSON.stringify({ instructions: value }),
  });
  if (!res.ok) throw new Error(`PATCH hub instructions failed: ${res.status} ${await res.text()}`);
}

test.beforeAll(async ({ browser }) => {
  if (!SUPER_ADMIN_PASSWORD) return;

  // UI session, for the browser test itself -- same pattern as the other
  // local-only specs (real login, storageState reused across every width).
  const context = await browser.newContext();
  const page = await context.newPage();
  loginOk = await tryLogin(page, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  if (loginOk) await context.storageState({ path: STORAGE_PATH });
  await context.close();
  if (!loginOk) return;

  // Separate script-level session, for this file's own PATCH calls below --
  // the csrfToken only ever appears in the login response body, not a
  // cookie, so it has to come from a login this script makes itself.
  const loginRes = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: SUPER_ADMIN_EMAIL, password: SUPER_ADMIN_PASSWORD }),
  });
  if (!loginRes.ok) throw new Error(`script-level login failed: ${loginRes.status} ${await loginRes.text()}`);
  const setCookie = loginRes.headers.get('set-cookie') ?? '';
  sessionCookieHeader = setCookie
    .split(/,(?=[^;]+?=)/)
    .map((c) => (c.split(';')[0] ?? '').trim())
    .join('; ');
  csrfToken = ((await loginRes.json()) as { csrfToken: string }).csrfToken;

  await patchHubInstructions(LONG_INSTRUCTIONS);
});

test.afterAll(async () => {
  // The update schema's `instructions` is `.optional()` only, not
  // `.nullable()` -- there is no way to PATCH it back to the original `null`
  // through this endpoint. "" is functionally identical for every consumer
  // (publicHubs() returns it as-is; EndpointPicker's `instructions &&` check
  // treats both as falsy), so this is the closest reachable restoration.
  if (loginOk) await patchHubInstructions('');
  fs.rmSync(STORAGE_PATH, { force: true });
});

function skipIfNoSession() {
  test.skip(!SUPER_ADMIN_PASSWORD || !loginOk, 'Needs a live API + seeded dev database with SEED_SUPER_ADMIN_PASSWORD set -- not provisioned in CI. See file header.');
}

async function selectHubMode(page: Page): Promise<void> {
  await page.goto('/dashboard/shipments/new');
  await page.selectOption('#service-type', 'HUB_TO_HUB');
  const terminalSelects = page.locator('select').filter({ hasText: 'Choose a terminal' });
  await terminalSelects.nth(0).selectOption(REHBC_ID);
}

test.describe('[LOCAL ONLY, skips in CI -- see file header] EndpointPicker hub instructions never run off the viewport', () => {
  for (const width of WIDTHS) {
    test(`the hub instructions paragraph stays inside the viewport at ${width}px`, async ({ browser }) => {
      skipIfNoSession();
      const context = await browser.newContext({ storageState: STORAGE_PATH, viewport: { width, height: 900 } });
      const page = await context.newPage();
      await selectHubMode(page);

      const instructionsPara = page.locator('p', { hasText: 'BMLidentificationbadge' });
      await expect(instructionsPara).toBeVisible();

      const box = await instructionsPara.boundingBox();
      await context.close();

      expect(box, `no instructions box at ${width}px`).not.toBeNull();
      expect(
        box!.x + box!.width,
        `instructions <p> right edge ${(box!.x + box!.width).toFixed(1)} at ${width}px (viewport ${width}) -- its own box grows to fit the unbreakable word instead of wrapping, then gets clipped invisibly by the dashboard shell's overflow-x-hidden`,
      ).toBeLessThanOrEqual(width + 1);
    });
  }
});

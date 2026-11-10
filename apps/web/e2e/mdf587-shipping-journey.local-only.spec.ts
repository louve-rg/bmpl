import { test, expect, type Page } from '@playwright/test';
import {
  tryLogin,
  UAT_CUSTOMER_EMAIL,
  UAT_FIXTURE_PASSWORD,
  UAT_DRIVER_EMAIL,
  UAT_DRIVER_PASSWORD,
} from './support/auth';

/**
 * [LOCAL ONLY, MDF-587] Real behavioural journey: customer books a shipment
 * through the real UI -> an eligible driver accepts it through automatic
 * dispatch -> driver picks up and delivers through the real UI, with real
 * codes read off the real pages -> admin visibility is checked on the real
 * admin app. No DB shortcuts, no bypassed codes, no application-code changes
 * to make a step pass. Every assertion reports what it actually saw.
 *
 * Reuses the UAT_CUSTOMER_EMAIL / UAT_DRIVER_EMAIL fixtures seeded by
 * packages/database/prisma/seed-uat-logistics.ts (idempotent, already
 * isTest/funded/approved/online) -- no new accounts created here.
 *
 * Parameterized: WEB/API/ADMIN base URLs come from env vars with this
 * worktree's own local defaults as fallback, so the same file can later be
 * pointed at production by setting BASE_URL / API_BASE_URL / ADMIN_BASE_URL
 * -- no rewrite needed. apps/web's own playwright.config.ts still owns the
 * WEB server lifecycle (globalSetup); this spec does not start or stop
 * anything itself.
 *
 * A `false` from any login helper is a HARD STOP (expect().toBeTruthy()),
 * never a silent skip -- god's explicit instruction after the UAT_OPS
 * fixture bug (2026-11-09): a skip reads as a pass in a summary, which is
 * the exact false-green shape the owner is tired of.
 */
const WEB = process.env.BASE_URL ?? 'http://localhost:3177';
const API = process.env.API_BASE_URL ?? 'http://localhost:4010';
const ADMIN = process.env.ADMIN_BASE_URL ?? 'http://localhost:3178';

const ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@bzemarketplace.com';
const ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;

const stamp = Date.now();

test.describe.configure({ mode: 'serial' });

async function readCodeBlock(page: Page, label: string): Promise<string | null> {
  const block = page.getByText(label, { exact: true }).locator('..');
  const text = await block.innerText().catch(() => '');
  const m = text.match(/\b\d{4}\b/);
  return m?.[0] ?? null;
}

type DriverJob = {
  id: string;
  status: string;
  nextActionLabel: string | null;
  requiresPickupPin?: boolean;
};

/**
 * Reads the job straight from the API via the browser's own authenticated
 * session (same cookies the UI uses), rather than parsing the rendered page.
 * This is what makes the subsequent button click reliable: the driver
 * job-detail page's primary action button has NO fixed accessible name
 * (job.nextActionLabel is server-supplied and changes at every status) and
 * is NOT the only button on the page -- the dashboard header's own
 * NotificationBell button renders earlier in DOM order and does not match
 * "Pass on this job" / "Report an issue" either, so an unscoped
 * getByRole('button').filter(...).first() silently clicks the bell instead
 * of the real action (found the hard way: clicks "succeeded" with zero
 * server-side POSTs ever logged for accept/pickup/in-transit/arriving, and
 * the leg eventually auto-declined from sitting un-accepted). Clicking the
 * button by its own exact, server-supplied label removes the ambiguity.
 */
async function getDriverJob(page: Page, legId: string): Promise<DriverJob> {
  return page.evaluate(async (id) => {
    const res = await fetch(`/api/driver/shipping-jobs/${id}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`GET /driver/shipping-jobs/${id} -> ${res.status} ${await res.text()}`);
    return res.json();
  }, legId);
}

async function clickLabeledAction(page: Page, label: string): Promise<void> {
  const button = page.getByRole('button', { name: label, exact: true });
  await expect(button, `primary action button "${label}" was not visible/enabled`).toBeEnabled({ timeout: 10_000 });
  await button.click();
}

test('MDF-587 customer -> courier -> admin shipping journey', async ({ page, browser }) => {
  test.setTimeout(300_000);
  let reference = '';

  // ---- STEP 1-5 (18-step inventory numbering): customer books a real shipment ----
  const loggedIn = await tryLogin(page, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD);
  expect(loggedIn, 'UAT_CUSTOMER_EMAIL could not log in -- hard stop, not a skip').toBeTruthy();
  console.log('STEP 1 customer login: OK');

  await page.goto(`${WEB}/dashboard/shipments/new`);
  await page.waitForTimeout(1500); // hubs/modes/wallet fetch, same wait the proven mdf560 spec used

  const collectGroup = page.getByRole('group', { name: 'Collect from' });
  await collectGroup.getByLabel('How would you like to give us the address?').selectOption('SAVED');
  await page.waitForTimeout(500);
  await collectGroup.getByLabel('Saved address', { exact: true }).selectOption({ index: 1 });

  const deliverGroup = page.getByRole('group', { name: 'Deliver to' });
  await deliverGroup.getByLabel('Full name').fill(`Mdf587 Recipient ${stamp}`);
  await deliverGroup.getByLabel('Phone').fill('501-222-5555');
  await deliverGroup.getByLabel('Street').fill('77 Freetown Road');
  await deliverGroup.getByLabel('City, town or village').fill('Belize City');
  await deliverGroup.getByLabel('District or island').selectOption('BELIZE');
  await page.waitForTimeout(1200); // debounced re-quote

  const bookButton = page.getByRole('button', { name: /pay.*book shipment|book shipment/i }).first();
  await expect(bookButton, 'book button never became enabled -- see page text above for the blocking reason').toBeEnabled({
    timeout: 10_000,
  });
  console.log('STEP 2-5 form filled, quote accepted, book button enabled: OK');

  await bookButton.click();
  await page.waitForURL((u) => u.pathname.startsWith('/dashboard/shipments/') && u.pathname !== '/dashboard/shipments/new', {
    timeout: 15_000,
  });
  reference = decodeURIComponent(page.url().split('/').pop() ?? '');
  expect(reference, 'no shipment reference in the post-booking URL').toBeTruthy();
  console.log('STEP 5 BOOKED, reference:', reference);

  // ---- STEP 6: automatic dispatch should offer this leg to the UAT driver ----
  const driverPage = await (await browser.newContext()).newPage();
  const driverLoggedIn = await tryLogin(driverPage, UAT_DRIVER_EMAIL, UAT_DRIVER_PASSWORD);
  expect(driverLoggedIn, 'UAT_DRIVER_EMAIL could not log in -- hard stop, not a skip').toBeTruthy();
  console.log('STEP 6a driver login: OK');

  // The sweeper's own log line only fires when it has something to report,
  // so quiet ticks are invisible from outside -- observed empirically that
  // a fresh leg can take ~90-100s / several ticks to be offered, not the
  // first 20s tick. Polling window set generously above that.
  let offered = false;
  let legId = '';
  const dispatchStart = Date.now();
  for (let attempt = 0; attempt < 40; attempt++) {
    await driverPage.goto(`${WEB}/dashboard/driver/jobs`);
    const bodyText = await driverPage.locator('body').innerText();
    if (bodyText.includes(reference)) {
      offered = true;
      break;
    }
    await driverPage.waitForTimeout(4000);
  }
  const dispatchSeconds = Math.round((Date.now() - dispatchStart) / 1000);
  console.log(`STEP 6b automatic dispatch offered the leg to the UAT driver? ${offered} (after ~${dispatchSeconds}s of polling)`);
  expect(offered, 'automatic dispatch never offered this leg to the UAT driver').toBeTruthy();

  // ---- STEP 7: driver accepts, via the real UI click, verified via the API read afterwards ----
  await driverPage.getByText(reference, { exact: false }).first().click();
  await driverPage.waitForURL(/\/dashboard\/driver\/shipping\//, { timeout: 20_000 });
  const legUrl = driverPage.url();
  legId = legUrl.split('/').pop() ?? '';
  console.log('STEP 7a opened job detail:', legUrl, 'legId:', legId);

  let job = await getDriverJob(driverPage, legId);
  console.log('STEP 7b job status before accept:', job.status, 'nextActionLabel:', job.nextActionLabel);
  expect(job.nextActionLabel, 'no primary action label on an ASSIGNED job').toBeTruthy();
  await clickLabeledAction(driverPage, job.nextActionLabel!);
  await driverPage.waitForTimeout(800);
  job = await getDriverJob(driverPage, legId);
  console.log('STEP 7c job status after accept click:', job.status);
  expect(job.status, 'accept click did not move the job past ASSIGNED').not.toBe('ASSIGNED');

  // ---- STEP 8-10: pickup, with the collection code if this leg requires one ----
  const requiresPickupPin = !!job.requiresPickupPin;
  console.log('STEP 9 does this leg require a pickup/collection code?', requiresPickupPin);

  if (requiresPickupPin) {
    await page.goto(`${WEB}/dashboard/shipments/${encodeURIComponent(reference)}`);
    const pickupCode = await readCodeBlock(page, 'Your pickup code');
    console.log('STEP 9 customer-side pickup code read from the real page:', pickupCode);
    expect(pickupCode, 'leg requires a pickup code but the customer page showed none').toBeTruthy();
    await driverPage.goto(legUrl);
    await driverPage.locator('#code').fill(pickupCode!);
  } else {
    await driverPage.goto(legUrl);
  }
  job = await getDriverJob(driverPage, legId);
  await clickLabeledAction(driverPage, job.nextActionLabel!);
  await driverPage.waitForTimeout(800);
  job = await getDriverJob(driverPage, legId);
  console.log('STEP 10 job status after pickup click:', job.status, '(code used:', requiresPickupPin, ')');
  expect(job.status, 'pickup click did not advance the job').not.toBe('DRIVER_ACCEPTED');

  // ---- STEP 11: in transit ----
  await driverPage.goto(legUrl);
  job = await getDriverJob(driverPage, legId);
  await clickLabeledAction(driverPage, job.nextActionLabel!);
  await driverPage.waitForTimeout(800);
  job = await getDriverJob(driverPage, legId);
  console.log('STEP 11 job status after in-transit click:', job.status);
  expect(job.status, 'in-transit click did not advance the job').toBe('IN_TRANSIT');

  // ---- STEP 12: customer tracking should reflect it ----
  await page.goto(`${WEB}/dashboard/shipments/${encodeURIComponent(reference)}`);
  await page.waitForTimeout(1200);
  const customerTrackingText = await page.locator('main, body').first().innerText();
  console.log('STEP 12 customer tracking text after in-transit:\n' + customerTrackingText.slice(0, 1000));

  // ---- STEP 13: arriving ----
  await driverPage.goto(legUrl);
  job = await getDriverJob(driverPage, legId);
  await clickLabeledAction(driverPage, job.nextActionLabel!);
  await driverPage.waitForTimeout(800);
  job = await getDriverJob(driverPage, legId);
  console.log('STEP 13 job status after arriving click:', job.status);
  expect(job.status, 'arriving click did not advance the job').toBe('ARRIVING');

  // ---- STEP 14-15: handoff, with the real delivery code read off the customer's page ----
  await page.goto(`${WEB}/dashboard/shipments/${encodeURIComponent(reference)}`);
  const deliveryCode = await readCodeBlock(page, 'Your delivery code');
  console.log('STEP 14 customer-side delivery code read from the real page:', deliveryCode);
  expect(deliveryCode, 'no delivery code shown on the customer page at the handoff stage').toBeTruthy();

  await driverPage.goto(legUrl);
  job = await getDriverJob(driverPage, legId);
  expect(job.nextActionLabel, 'no handoff action label at ARRIVING').toBeTruthy();
  await driverPage.locator('#code').fill(deliveryCode!);
  await driverPage.locator('#who').fill(`Mdf587 Recipient ${stamp}`);
  await clickLabeledAction(driverPage, job.nextActionLabel!);
  await driverPage.waitForTimeout(1200);
  job = await getDriverJob(driverPage, legId).catch((e) => {
    console.log('STEP 15 job fetch after handoff failed (expected once the leg is no longer "mine" if it completed):', (e as Error).message);
    return { id: legId, status: 'UNKNOWN', nextActionLabel: null } as DriverJob;
  });
  console.log('STEP 15 job status after handoff click:', job.status);

  // ---- STEP 16-17: completed, customer side ----
  await page.goto(`${WEB}/dashboard/shipments/${encodeURIComponent(reference)}`);
  const customerFinalText = await page.locator('main, body').first().innerText();
  console.log('STEP 16-17 customer final page text:\n' + customerFinalText.slice(0, 1200));
  expect(customerFinalText, 'customer page does not show the shipment as delivered').toMatch(/delivered/i);

  // ---- STEP 18: admin visibility (separate app, apps/admin) ----
  if (!ADMIN_PASSWORD) {
    console.log('STEP 18 SKIPPED -- SEED_SUPER_ADMIN_PASSWORD not set in this environment, no hardcoded fallback used on purpose. This is a credential-availability gap, reported as such, not a pass.');
  } else {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await adminPage.goto(`${ADMIN}/login`);
    await adminPage.getByLabel('Email').fill(ADMIN_EMAIL);
    await adminPage.getByLabel('Password').fill(ADMIN_PASSWORD);
    await adminPage.getByRole('button', { name: /sign in/i }).click();
    const adminLoggedIn = await adminPage
      .waitForURL(/\/dashboard/, { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    console.log('STEP 18a admin login:', adminLoggedIn);
    // Hard stop, not a skip: a password was supplied and login still failed.
    expect(adminLoggedIn, 'admin login was attempted (password supplied) and failed -- this is a failure, not a skip').toBeTruthy();
    await adminPage.goto(`${ADMIN}/dashboard/logistics/${encodeURIComponent(reference)}`);
    const adminText = await adminPage.locator('main, body').first().innerText();
    console.log('STEP 18b admin logistics detail page text:\n' + adminText.slice(0, 1500));
    expect(adminText, 'admin logistics detail page does not show this reference').toContain(reference);
  }

  console.log('JOURNEY COMPLETE for', reference);
});

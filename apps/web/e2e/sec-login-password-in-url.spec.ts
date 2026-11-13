import { test, expect, type Page } from '@playwright/test';

/**
 * SEC-LOGIN-PASSWORD-IN-URL. Stanley reproduced the real defect on
 * production with JavaScript disabled in the browser -- the same effect a
 * blocked/failed script, a flaky mobile network, a CDN miss or an ad
 * blocker has. With no onSubmit handler ever attached (JS never ran), each
 * form's bare <form> fell back to its HTML default, GET, and the typed
 * password/token ended up in the URL. A test that fires the React onSubmit
 * handler only exercises the already-correct hydrated path and proves
 * nothing about this defect -- so this spec disables JS the same way
 * Stanley's repro did, and checks the literal HTTP request the browser
 * sent, not just the markup.
 *
 * Never a real credential: every submitted value is a random, single-use,
 * disposable string that exists only to prove whether it lands in the URL,
 * not to authenticate anything. No value here is recorded anywhere beyond
 * this test run.
 */
test.describe('credential forms must never submit via a native GET when JS never runs', () => {
  test.use({ javaScriptEnabled: false });

  function randomProbe() {
    return `nojs-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  async function submitWithoutJs(page: Page, path: string, fill: () => Promise<void>) {
    await page.goto(path);
    await fill();
    const basePath = path.split('?')[0] ?? path;
    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().includes(basePath) && r.frame() === page.mainFrame()),
      page.click('button[type="submit"]'),
    ]);
    return request;
  }

  test('login: the submit request is POST, and the password never reaches the URL', async ({ page }) => {
    const probe = randomProbe();
    const request = await submitWithoutJs(page, '/login', async () => {
      await page.fill('input[name="email"]', `${probe}@example.test`);
      await page.fill('input[name="password"]', probe);
    });
    expect(request.method()).toBe('POST');
    expect(request.url()).not.toContain(probe);
  });

  test('register: the submit request is POST, and the password never reaches the URL', async ({ page }) => {
    const probe = randomProbe();
    const request = await submitWithoutJs(page, '/register', async () => {
      await page.fill('input[name="firstName"]', 'Test');
      await page.fill('input[name="lastName"]', 'User');
      await page.fill('input[name="email"]', `${probe}@example.test`);
      await page.fill('input[name="password"]', probe);
      await page.check('input[name="acceptedTerms"]');
    });
    expect(request.method()).toBe('POST');
    expect(request.url()).not.toContain(probe);
  });

  test('forgot-password: the submit request is POST, and the email never reaches the URL', async ({ page }) => {
    const probe = randomProbe();
    const request = await submitWithoutJs(page, '/forgot-password', async () => {
      await page.fill('input[name="email"]', `${probe}@example.test`);
    });
    expect(request.method()).toBe('POST');
    expect(request.url()).not.toContain(probe);
  });

  test('reset-password: the submit request is POST, and the new password never reaches the URL', async ({ page }) => {
    const probe = randomProbe();
    const request = await submitWithoutJs(page, '/reset-password?token=e2e-dummy-token', async () => {
      await page.fill('input[name="password"]', probe);
    });
    expect(request.method()).toBe('POST');
    expect(request.url()).not.toContain(probe);
  });
});

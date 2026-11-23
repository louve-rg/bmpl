import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, onSessionExpired, type ApiError } from './api';

/**
 * BMPL-224: every caller across the admin console reads only `err.message`,
 * never `.errors` even though the API already attaches it — so a validation
 * failure showed nothing but the generic top-level string ("Validation
 * failed") anywhere in the console, with no way to tell which field was
 * wrong. Same defect and same fix as apps/web/lib/api.ts (BMPL-141/9cc2028).
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('admin api error messages', () => {
  it('folds per-field validation errors into the thrown message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(400, {
          message: 'Validation failed',
          errors: [
            { path: 'name', message: 'Required' },
            { path: 'sortOrder', message: 'Expected number, received string' },
          ],
        }),
      ),
    );

    await expect(api.post('/jobs/categories', {})).rejects.toMatchObject({
      message: expect.stringContaining('name — Required'),
    } satisfies Partial<ApiError>);
    await expect(api.post('/jobs/categories', {})).rejects.toMatchObject({
      message: expect.stringContaining('sortOrder — Expected number, received string'),
    } satisfies Partial<ApiError>);
  });

  it('leaves the message alone when there are no field errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, { message: 'Not found' })),
    );

    await expect(api.get('/jobs/categories/x')).rejects.toMatchObject({
      message: 'Not found',
    } satisfies Partial<ApiError>);
  });
});

/**
 * SESSION-EXPIRY-MID-ACTION (god, 2026-11-16): `onSessionExpired` must fire
 * only once the one silent refresh this module already attempts has ALSO
 * failed -- never on the first 401, and never for an `/auth/*` call's own
 * 401 (login/register refusing bad credentials has no session to expire).
 */
describe('admin api session-expiry notification', () => {
  afterEach(() => {
    onSessionExpired(null);
  });

  it('notifies once the silent refresh also fails for a genuinely dead session, with the original 401 message still thrown', async () => {
    const listener = vi.fn();
    onSessionExpired(listener);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/auth/refresh')
          ? jsonResponse(401, { message: 'Session expired. Please sign in again.' })
          : jsonResponse(401, { message: 'Session is no longer valid.' }),
      ),
    );

    await expect(api.get('/admin/wallet/accounts/u1')).rejects.toMatchObject({
      status: 401,
      message: 'Session is no longer valid.',
    } satisfies Partial<ApiError>);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does NOT notify a visitor on a cold load, where refresh fails because there was never a session to begin with', async () => {
    const listener = vi.fn();
    onSessionExpired(listener);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/auth/refresh')
          ? jsonResponse(401, { message: 'No refresh token provided.' })
          : jsonResponse(401, { message: 'Unauthorized' }),
      ),
    );

    await expect(api.get('/admin/wallet/accounts/u1')).rejects.toMatchObject({
      status: 401,
    } satisfies Partial<ApiError>);
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not notify when the silent refresh succeeds', async () => {
    const listener = vi.fn();
    onSessionExpired(listener);
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls += 1;
        if (url.endsWith('/auth/refresh')) return jsonResponse(200, {});
        return calls === 1
          ? jsonResponse(401, { message: 'Session is no longer valid.' })
          : jsonResponse(200, { ok: true });
      }),
    );

    await expect(api.get('/admin/wallet/accounts/u1')).resolves.toEqual({ ok: true });
    expect(listener).not.toHaveBeenCalled();
  });

  it("never notifies for an /auth/* endpoint's own 401 (e.g. a wrong-password login)", async () => {
    const listener = vi.fn();
    onSessionExpired(listener);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/auth/refresh')
          ? jsonResponse(401, { message: 'No refresh token provided.' })
          : jsonResponse(401, { message: 'Invalid email or password.' }),
      ),
    );

    await expect(
      api.post('/auth/login', { email: 'a@b.com', password: 'wrong' }),
    ).rejects.toMatchObject({
      message: 'Invalid email or password.',
    } satisfies Partial<ApiError>);
    expect(listener).not.toHaveBeenCalled();
  });

  it('does nothing when no listener is registered -- never a crash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/auth/refresh')
          ? jsonResponse(401, {})
          : jsonResponse(401, { message: 'Session is no longer valid.' }),
      ),
    );

    await expect(api.get('/admin/wallet/accounts/u1')).rejects.toMatchObject({
      status: 401,
    } satisfies Partial<ApiError>);
  });
});

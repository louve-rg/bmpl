import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, errorMessage, onSessionExpired, type ApiError } from './api';

/**
 * BMPL-141: every caller across the app reads only `err.message`, never
 * `.errors` even though the API already attaches it — so a validation
 * failure showed nothing but the generic top-level string ("Validation
 * failed") anywhere in the product, with no way to tell which field was
 * wrong. Fixed once, here, rather than at each of the many call sites.
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api error messages', () => {
  it('folds per-field validation errors into the thrown message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(400, {
          message: 'Validation failed',
          errors: [
            { path: 'workArrangement', message: "Expected 'ONSITE' | 'HYBRID' | 'REMOTE', received null" },
            { path: 'openings', message: 'Number must be greater than or equal to 1' },
          ],
        }),
      ),
    );

    await expect(api.get('/employer/jobs')).rejects.toMatchObject({
      message: expect.stringContaining('workArrangement — Expected'),
    } satisfies Partial<ApiError>);
    await expect(api.get('/employer/jobs')).rejects.toMatchObject({
      message: expect.stringContaining('openings — Number must be greater than or equal to 1'),
    } satisfies Partial<ApiError>);
  });

  it('leaves the message alone when there are no field errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(404, { message: 'Create your company profile first.' })));

    await expect(api.get('/employer/profile')).rejects.toMatchObject({
      message: 'Create your company profile first.',
    } satisfies Partial<ApiError>);
  });

  it('still gives the friendly origin/CSRF message, not the field-error one, for that specific case', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(403, { message: 'Request origin is not allowed', errors: [{ path: 'x', message: 'irrelevant' }] })),
    );

    await expect(api.post('/anything', {})).rejects.toMatchObject({
      message: 'We couldn’t complete that request. Please refresh the page and try again.',
    } satisfies Partial<ApiError>);
  });
});

/**
 * MDF-559: `message` already carries a real reason either way (BMPL-141,
 * above) -- a surface reading only `.message` was never showing a bare,
 * useless "Validation failed". `errorMessage()` is the further step several
 * callers now share (AddressField.tsx, the account address book, checkout):
 * prefer the field's own clean reason over the generic wrapper still glued
 * onto `.message`, and fall back to `.message` itself for a business
 * refusal, which carries no `errors[]` at all.
 */
describe('errorMessage', () => {
  it('prefers the clean field reason over the generic "Validation failed: ..." wrapper', () => {
    const err: ApiError = {
      status: 400,
      message: 'Validation failed: addressLine1 — Give a street or a pin.',
      errors: [{ path: 'addressLine1', message: 'Give a street or a pin.' }],
    };
    expect(errorMessage(err, 'fallback')).toBe('Give a street or a pin.');
  });

  it('falls back to .message for a business refusal, which has no errors[] at all', () => {
    const err: ApiError = { status: 400, message: 'This is your only address, so it has to stay your default.' };
    expect(errorMessage(err, 'fallback')).toBe('This is your only address, so it has to stay your default.');
  });

  it('falls back to the caller-supplied fallback when nothing usable comes back at all', () => {
    expect(errorMessage(null, 'Could not save this address just now.')).toBe('Could not save this address just now.');
  });
});

/**
 * SESSION-EXPIRY-MID-ACTION (god, 2026-11-16): `onSessionExpired` must fire
 * only once the one silent refresh this module already attempts has ALSO
 * failed -- never on the first 401, and never for an `/auth/*` call's own
 * 401 (login/register refusing bad credentials has no session to expire).
 */
describe('web api session-expiry notification', () => {
  afterEach(() => {
    onSessionExpired(null);
  });

  it('notifies once the silent refresh also fails, with the original 401 message still thrown', async () => {
    const listener = vi.fn();
    onSessionExpired(listener);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        return url.endsWith('/auth/refresh')
          ? jsonResponse(401, { message: 'No refresh token provided.' })
          : jsonResponse(401, { message: 'Session is no longer valid.' });
      }),
    );

    await expect(api.get('/orders')).rejects.toMatchObject({
      status: 401,
      message: 'Session is no longer valid.',
    } satisfies Partial<ApiError>);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify when the silent refresh succeeds', async () => {
    const listener = vi.fn();
    onSessionExpired(listener);
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls += 1;
        if (url.endsWith('/auth/refresh')) return jsonResponse(200, {});
        return calls === 1 ? jsonResponse(401, { message: 'Session is no longer valid.' }) : jsonResponse(200, { ok: true });
      }),
    );

    await expect(api.get('/orders')).resolves.toEqual({ ok: true });
    expect(listener).not.toHaveBeenCalled();
  });

  it("never notifies for an /auth/* endpoint's own 401 (e.g. a wrong-password login)", async () => {
    const listener = vi.fn();
    onSessionExpired(listener);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        return url.endsWith('/auth/refresh')
          ? jsonResponse(401, { message: 'No refresh token provided.' })
          : jsonResponse(401, { message: 'Invalid email or password.' });
      }),
    );

    await expect(api.post('/auth/login', { email: 'a@b.com', password: 'wrong' })).rejects.toMatchObject({
      message: 'Invalid email or password.',
    } satisfies Partial<ApiError>);
    expect(listener).not.toHaveBeenCalled();
  });

  it('also notifies on an upload (uploadBinary has its own 401/refresh handling)', async () => {
    const listener = vi.fn();
    onSessionExpired(listener);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        return url.endsWith('/auth/refresh')
          ? jsonResponse(401, { message: 'No refresh token provided.' })
          : jsonResponse(401, { message: 'Session is no longer valid.' });
      }),
    );

    await expect(api.upload('/products/images', new Blob(['x'], { type: 'image/png' }))).rejects.toMatchObject({
      status: 401,
    } satisfies Partial<ApiError>);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

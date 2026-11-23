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
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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
            {
              path: 'workArrangement',
              message: "Expected 'ONSITE' | 'HYBRID' | 'REMOTE', received null",
            },
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, { message: 'Create your company profile first.' })),
    );

    await expect(api.get('/employer/profile')).rejects.toMatchObject({
      message: 'Create your company profile first.',
    } satisfies Partial<ApiError>);
  });

  it('still gives the friendly origin/CSRF message, not the field-error one, for that specific case', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(403, {
          message: 'Request origin is not allowed',
          errors: [{ path: 'x', message: 'irrelevant' }],
        }),
      ),
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
    const err: ApiError = {
      status: 400,
      message: 'This is your only address, so it has to stay your default.',
    };
    expect(errorMessage(err, 'fallback')).toBe(
      'This is your only address, so it has to stay your default.',
    );
  });

  it('falls back to the caller-supplied fallback when nothing usable comes back at all', () => {
    expect(errorMessage(null, 'Could not save this address just now.')).toBe(
      'Could not save this address just now.',
    );
  });
});

/**
 * SESSION-EXPIRY-MID-ACTION (god, 2026-11-16): `onSessionExpired` must fire
 * only once the one silent refresh this module already attempts has ALSO
 * failed -- never on the first 401, and never for an `/auth/*` call's own
 * 401 (login/register refusing bad credentials has no session to expire).
 *
 * WEB-FALSE-SESSION-EXPIRED (god, 2026-11-23): that rule was necessary but
 * not sufficient. Several nav-level components (cart/saved/me/recommendations)
 * call auth-gated endpoints unconditionally on every page load regardless of
 * login state. For a completely anonymous visitor, the original 401 is real
 * (correct -- they are not logged in), but the refresh attempt ALSO 401s with
 * the API's own exact "No refresh token provided." (auth.controller.ts:117)
 * -- the old code notified here anyway, telling someone who never signed in
 * that their SESSION expired.
 *
 * WEB-FALSE-SESSION-EXPIRED-BURST (god, 2026-11-23, same day): that fix, and
 * #860's copy of it in the admin console, and the 429 carve-out that
 * followed it, were all the SAME shape of mistake -- an allowlist of
 * known-safe response shapes, each one defeated by the next shape nobody had
 * enumerated yet (a throttled refresh, then a proxy 502/503, an unhandled
 * 500, ...). Inverted instead: the listener fires ONLY on a POSITIVE
 * confirmation the session is actually dead -- a 401 from refresh whose
 * message is NOT the no-cookie one. `session.service.ts`'s `rotate()` (the
 * only code path behind this endpoint) has exactly two throw sites and both
 * are a real 401 (:89 "Session expired. Please sign in again.", :92 "Account
 * is not active."); the no-cookie case throws its own distinct 401 one level
 * up, in the controller itself (auth.controller.ts:117). Anything else this
 * endpoint can return -- 429, 403, 5xx -- never reached `rotate()` and so is
 * silent by construction now, not because someone remembered to name it.
 */
describe('web api session-expiry notification', () => {
  afterEach(() => {
    onSessionExpired(null);
  });

  it('notifies once the silent refresh also fails for a genuinely dead session, with the original 401 message still thrown', async () => {
    const listener = vi.fn();
    onSessionExpired(listener);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        return url.endsWith('/auth/refresh')
          ? jsonResponse(401, { message: 'Session expired. Please sign in again.' })
          : jsonResponse(401, { message: 'Session is no longer valid.' });
      }),
    );

    await expect(api.get('/orders')).rejects.toMatchObject({
      status: 401,
      message: 'Session is no longer valid.',
    } satisfies Partial<ApiError>);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does NOT notify an anonymous visitor on a cold load, where refresh fails because there was never a session to begin with', async () => {
    const listener = vi.fn();
    onSessionExpired(listener);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        return url.endsWith('/auth/refresh')
          ? jsonResponse(401, { message: 'No refresh token provided.' })
          : jsonResponse(401, { message: 'Unauthorized' });
      }),
    );

    // The original call's own 401 still surfaces normally -- this is about
    // suppressing the FALSE "your session expired" notice, not swallowing
    // the error entirely.
    await expect(api.get('/cart')).rejects.toMatchObject({
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
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls += 1;
        if (url.endsWith('/auth/refresh')) return jsonResponse(200, {});
        return calls === 1
          ? jsonResponse(401, { message: 'Session is no longer valid.' })
          : jsonResponse(200, { ok: true });
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

    await expect(
      api.post('/auth/login', { email: 'a@b.com', password: 'wrong' }),
    ).rejects.toMatchObject({
      message: 'Invalid email or password.',
    } satisfies Partial<ApiError>);
    expect(listener).not.toHaveBeenCalled();
  });

  it('also notifies on an upload for a genuinely dead session (uploadBinary has its own 401/refresh handling)', async () => {
    const listener = vi.fn();
    onSessionExpired(listener);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        return url.endsWith('/auth/refresh')
          ? jsonResponse(401, { message: 'Session expired. Please sign in again.' })
          : jsonResponse(401, { message: 'Session is no longer valid.' });
      }),
    );

    await expect(
      api.upload('/products/images', new Blob(['x'], { type: 'image/png' })),
    ).rejects.toMatchObject({
      status: 401,
    } satisfies Partial<ApiError>);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  /**
   * WEB-FALSE-SESSION-EXPIRED-BURST (2026-11-23): reproduced on the deployed
   * site by scrolling the homepage -- several nav-level components fire
   * their own auth-gated call at once, each independently opening its own
   * POST /api/auth/refresh, and /auth/refresh is StrictThrottle()'d. The
   * caller unlucky enough to land past that limit got back 429
   * `ThrottlerException`, not the API's own 401 "No refresh token provided.",
   * so the old exact-message check didn't recognize it and fired the false
   * notice. A throttled response is not evidence either way -- it must not
   * fire the listener.
   */
  it('does NOT notify when the refresh attempt itself is throttled (429), since that proves nothing about the session', async () => {
    const listener = vi.fn();
    onSessionExpired(listener);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        return url.endsWith('/auth/refresh')
          ? jsonResponse(429, { statusCode: 429, message: 'ThrottlerException: Too Many Requests' })
          : jsonResponse(401, { message: 'Unauthorized' });
      }),
    );

    await expect(api.get('/cart')).rejects.toMatchObject({ status: 401 } satisfies Partial<ApiError>);
    expect(listener).not.toHaveBeenCalled();
  });

  /**
   * god (2026-11-23, holding #882 for this one line): the 429 test above and
   * the original message-match check were both still an ALLOWLIST of known-
   * safe response shapes -- exactly the kind of thing this function's own
   * comment already warns against doing at the endpoint level, just moved
   * down to the response level instead. #855/#859/#860 each shipped a fix of
   * that shape and each was defeated by the next shape nobody had
   * enumerated. This is the test that would have caught all three: an
   * UNEXPECTED status from refresh (a proxy 502, here) must show no banner
   * either, without anyone having had to name 502 in advance -- the
   * inversion only fires on a POSITIVE 401 confirmation, so an unrecognized
   * shape is silent by construction, not by enumeration.
   */
  it('does NOT notify on an unexpected 5xx from refresh (e.g. a proxy 502) -- silent by construction, not by enumeration', async () => {
    const listener = vi.fn();
    onSessionExpired(listener);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        return url.endsWith('/auth/refresh')
          ? new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } })
          : jsonResponse(401, { message: 'Unauthorized' });
      }),
    );

    await expect(api.get('/cart')).rejects.toMatchObject({ status: 401 } satisfies Partial<ApiError>);
    expect(listener).not.toHaveBeenCalled();
  });

  /**
   * The actual trigger on the live site: several auth-gated calls fire in
   * the same instant (cart, saved/count, saved/ids, me, recommendations),
   * each hitting its own 401 and each trying to refresh at once. Before the
   * fix, that was N independent POSTs to /auth/refresh; this proves it is
   * now exactly one, regardless of how many callers are waiting on it.
   */
  it('de-dupes a burst of concurrent refresh attempts into a single network call', async () => {
    const listener = vi.fn();
    onSessionExpired(listener);
    let refreshCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/auth/refresh')) {
          refreshCalls += 1;
          return jsonResponse(401, { message: 'No refresh token provided.' });
        }
        return jsonResponse(401, { message: 'Unauthorized' });
      }),
    );

    await Promise.all(
      [api.get('/cart'), api.get('/me'), api.get('/saved/count'), api.get('/saved/ids')].map((p) => p.catch(() => {})),
    );

    expect(refreshCalls).toBe(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('does NOT notify an upload attempt that never had a session either', async () => {
    const listener = vi.fn();
    onSessionExpired(listener);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        return url.endsWith('/auth/refresh')
          ? jsonResponse(401, { message: 'No refresh token provided.' })
          : jsonResponse(401, { message: 'Unauthorized' });
      }),
    );

    await expect(
      api.upload('/products/images', new Blob(['x'], { type: 'image/png' })),
    ).rejects.toMatchObject({
      status: 401,
    } satisfies Partial<ApiError>);
    expect(listener).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, type ApiError } from './api';

/**
 * BMPL-224: every caller across the admin console reads only `err.message`,
 * never `.errors` even though the API already attaches it — so a validation
 * failure showed nothing but the generic top-level string ("Validation
 * failed") anywhere in the console, with no way to tell which field was
 * wrong. Same defect and same fix as apps/web/lib/api.ts (BMPL-141/9cc2028).
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
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
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(404, { message: 'Not found' })));

    await expect(api.get('/jobs/categories/x')).rejects.toMatchObject({
      message: 'Not found',
    } satisfies Partial<ApiError>);
  });
});

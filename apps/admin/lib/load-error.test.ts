import { describe, expect, it } from 'vitest';
import { loadErrorMessage } from './load-error';

describe('loadErrorMessage', () => {
  it('prefers the server sentence verbatim', () => {
    expect(loadErrorMessage({ status: 403, message: 'You lack the required administrative permission.' }, 'users'))
      .toBe('You lack the required administrative permission.');
  });

  it('falls back to naming what failed when the error carries no sentence', () => {
    expect(loadErrorMessage({ status: 500 }, 'orders')).toBe('Could not load orders.');
    expect(loadErrorMessage({ status: 502, message: '' }, 'orders')).toBe('Could not load orders.');
    expect(loadErrorMessage(new TypeError('fetch failed'), 'payments')).toBe('fetch failed');
    expect(loadErrorMessage(null, 'drivers')).toBe('Could not load drivers.');
  });
});

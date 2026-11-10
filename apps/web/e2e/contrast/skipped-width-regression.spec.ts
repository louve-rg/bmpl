import { test, expect } from '@playwright/test';
import { assertAllWidthsExamined } from '../support/contrast-ratchet';

/**
 * MDF-678 addition (god, 2026-11-10, folded into CONTRAST-DISCOVERY-DROP
 * from his PR #660 review): a width that never ran at all looks exactly
 * like a width that ran and passed. Found live on the admin dispatch
 * DETAIL route (apps/admin/e2e/contrast/dispatch.spec.ts) -- 5 of its 9
 * widths showed as Playwright-skipped with nothing complaining. See
 * contrast-ratchet.ts's own assertAllWidthsExamined comment for the
 * mechanism. No DB/API/login/browser page needed -- pure-function checks,
 * same style as discovery-drop-regression.spec.ts in this same directory.
 */

test('fewer widths examined than expected throws, naming both numbers', () => {
  expect(() => assertAllWidthsExamined(4, 9, { route: '/__fake__' })).toThrow(/only 4\/9/);
});

test('every expected width examined is silent', () => {
  expect(() => assertAllWidthsExamined(9, 9, { route: '/__fake__' })).not.toThrow();
});

test('more than expected (should never happen, but must not be treated as a failure) is silent', () => {
  expect(() => assertAllWidthsExamined(10, 9, { route: '/__fake__' })).not.toThrow();
});

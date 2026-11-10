import { test, expect } from '@playwright/test';
import { assertRatchet, checkDiscoveryDrop } from '../support/contrast-ratchet';
import type { SweepResult, SweepTextElement, SweepReading } from '../support/contrast-sweep';

/**
 * CONTRAST-DISCOVERY-DROP (god, 2026-11-10) -- see apps/web's identical copy
 * of this file for the full reasoning, and contrast-ratchet.ts's own
 * checkDiscoveryDrop comment for the mechanism. No DB/API/login/browser
 * page needed -- these are pure-function checks over a hand-built
 * SweepResult, exactly the shape sweepContrast() itself returns, run
 * through a Playwright `test()` with no `{ page }` fixture requested so
 * no browser is ever launched for this file.
 */

function readingAt(n: number): SweepReading<SweepTextElement> {
  return {
    element: { kind: 'text', tag: 'P', accessibleRole: null, accessibleName: `el-${n}`, textSnippet: `el-${n}`, isLargeText: false, box: { x: 0, y: 0, width: 10, height: 10 }, color: 'rgb(0,0,0)' },
    ratio: 10,
    dominantShare: 1,
    foreground: { r: 0, g: 0, b: 0 },
    dominantBackground: { r: 255, g: 255, b: 255 },
    requiredRatio: 4.5,
  };
}

/** `count` elements, all dropped into the ambiguous bucket -- checkDiscoveryDrop
 * sums pass+fail+ambiguous+excludedDisabled, so which bucket they're in doesn't
 * matter for this guard; only the total does. */
function resultWith(count: number): SweepResult {
  const ambiguous = Array.from({ length: count }, (_, i) => readingAt(i));
  return {
    text: { pass: [], fail: [], ambiguous, excludedDisabledCount: 0, measuredCount: count },
    icon: { pass: [], fail: [], ambiguous: [], measuredCount: 0, compositeGraphics: [] },
    borderOnlyNotMeasured: true,
  };
}

test('a lower total than the committed baseline is reported as a drop', () => {
  const message = checkDiscoveryDrop(resultWith(7), { route: '/fake', viewport: 999 }, { '/fake@999': 10 });
  expect(message, 'fewer elements discovered than the baseline must be flagged').toBeTruthy();
  expect(message).toContain('DISCOVERY COUNT DROPPED');
  expect(message).toContain('was 10, now 7');
});

test('the same total as the baseline is silent', () => {
  const message = checkDiscoveryDrop(resultWith(10), { route: '/fake', viewport: 999 }, { '/fake@999': 10 });
  expect(message, 'no change from the baseline must not be flagged').toBeNull();
});

test('a higher total than the baseline is silent (growth is never a failure)', () => {
  const message = checkDiscoveryDrop(resultWith(12), { route: '/fake', viewport: 999 }, { '/fake@999': 10 });
  expect(message, 'MORE elements discovered than before must never be treated as a regression').toBeNull();
});

test('a route/viewport with no baseline entry at all is silent (nothing to compare against yet)', () => {
  const message = checkDiscoveryDrop(resultWith(3), { route: '/never-seen', viewport: 1 }, {});
  expect(message, 'a brand-new route/viewport has no prior count to drop below').toBeNull();
});

test('assertRatchet throws on a real discovery drop, reading the real committed baseline file, with an empty known-violations list', () => {
  // Exercises the real integration, not just the injectable-baseline unit
  // checks above: assertRatchet's own call to checkDiscoveryDrop reads
  // contrast-discovery-baseline.json off disk (no override param at that
  // call site, on purpose -- production behavior is never test-only
  // behavior in disguise). This route's "@1" entry is a dedicated, clearly-
  // named test fixture committed to that real file for exactly this
  // assertion, mirroring the baseline's own value (10).
  //
  // Same scenario as the real incident: nothing in the FAIL bucket (an
  // empty known-violations list has nothing to go stale either), so
  // checkRatchet alone would report everything clean -- assertRatchet must
  // still throw because of the discovery-count drop alone.
  expect(() => assertRatchet(resultWith(7), [], { route: '/__discovery_drop_regression_test__', viewport: 1 })).toThrow(/DISCOVERY COUNT DROPPED/);
  // The same route/viewport with the SAME count as the committed baseline
  // (10) must stay silent -- proves this isn't just "always throws for this
  // test route".
  expect(() => assertRatchet(resultWith(10), [], { route: '/__discovery_drop_regression_test__', viewport: 1 })).not.toThrow();
});

import { test, expect } from '@playwright/test';
import { sweepContrast } from '../support/contrast-sweep';

/**
 * CONTRAST-CLIP (god, 2026-11-10): `getBoundingClientRect()` returns an
 * element's unclipped layout rect even when an ancestor's own
 * `overflow-x-auto`/`hidden`/`scroll`/`clip` has clipped it away entirely --
 * nothing of a clipped element is ever actually painted anywhere in the
 * full-page screenshot the sampler decodes, so `clusterAt` samples whatever
 * genuinely IS painted at those coordinates instead (the page background
 * behind the clipping container, in production: the Liquid Glass mural
 * behind the admin dispatch table's `overflow-x-auto` card -- MDF-424). The
 * existing `OUT_OF_BOUNDS_SHARE_CUTOFF` only ever compared sample points
 * against the full-page screenshot's own canvas edges, never against any
 * ancestor's own clip rect, so a clipped-but-still-on-canvas element always
 * read `outOfBoundsShare: 0` and reported a confident, wrong PASS or FAIL.
 *
 * No DB/API/login needed -- `page.setContent()` builds the exact minimal
 * shape live: a 100px-wide `overflow-x:auto` white container holding a
 * 400px-wide flex row, so the second cell is entirely outside the visible
 * window while the page's own dark background (standing in for the Liquid
 * Glass mural) is what is actually painted where that cell's unclipped rect
 * says it should be.
 */

const FIXTURE = `
<!doctype html>
<html><head><style>
  html, body { margin: 0; padding: 0; }
  body { background: rgb(10, 21, 38); } /* stands in for the mural behind the admin shell */
  .clip { width: 100px; height: 40px; overflow-x: auto; background: #ffffff; }
  .row { display: flex; width: 400px; height: 40px; }
  .cell { flex-shrink: 0; width: 100px; line-height: 40px; font-size: 16px; }
  .target { color: #1e40af; } /* belize-blue -- the real MDF-424 foreground */
</style></head>
<body>
  <div class="clip">
    <div class="row">
      <div class="cell">A</div>
      <div class="cell target">CLIPPED</div>
    </div>
  </div>
</body></html>
`;

test('a text node entirely clipped away by an overflow-x-auto ancestor is reported AMBIGUOUS, never scored off whatever is painted behind it', async ({ page }) => {
  await page.setContent(FIXTURE);

  const result = await sweepContrast(page);

  const all = [...result.text.pass, ...result.text.fail, ...result.text.ambiguous];
  const clipped = all.find((r) => r.element.textSnippet === 'CLIPPED');
  expect(clipped, 'the clipped element must be discovered and scored -- not silently dropped').toBeTruthy();

  const visible = all.find((r) => r.element.textSnippet === 'A');
  expect(visible, 'the control element (fully inside the clip, never overflowing) must also be discovered').toBeTruthy();

  // The control element must NOT be caught by this guard -- the fix must
  // not make the instrument blinder for content that genuinely IS visible.
  expect(result.text.pass.some((r) => r.element.textSnippet === 'A'), 'a text node that genuinely fits inside its scrollable ancestor must still score normally (here, PASS: black-on-white)').toBe(true);

  // The actually-clipped element must land in ambiguous, regardless of what
  // ratio got computed against the wrong background.
  expect(result.text.ambiguous.some((r) => r.element.textSnippet === 'CLIPPED'), 'a text node with zero painted pixels of its own (fully clipped by an overflow-x-auto ancestor) must be AMBIGUOUS, never PASS or FAIL').toBe(true);
});

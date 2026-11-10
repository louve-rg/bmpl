import { test, expect } from '@playwright/test';
import { sweepContrast } from '../support/contrast-sweep';

/**
 * CONTRAST-CLIP (god, 2026-11-10) -- see apps/web's identical copy of this
 * file for the full reasoning (this is the instrument MDF-424 found the
 * bug in: the admin dispatch list's `overflow-x-auto` card). No DB/API/
 * login needed -- `page.setContent()` builds the exact minimal shape live.
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

  expect(result.text.pass.some((r) => r.element.textSnippet === 'A'), 'a text node that genuinely fits inside its scrollable ancestor must still score normally (here, PASS: black-on-white)').toBe(true);

  expect(result.text.ambiguous.some((r) => r.element.textSnippet === 'CLIPPED'), 'a text node with zero painted pixels of its own (fully clipped by an overflow-x-auto ancestor) must be AMBIGUOUS, never PASS or FAIL').toBe(true);
});

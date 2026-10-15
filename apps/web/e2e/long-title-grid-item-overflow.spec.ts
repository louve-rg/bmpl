import { test, expect, type Page } from '@playwright/test';

/**
 * Found during the layout-workstream sweep (god, conv-mission-2026-10-13),
 * priority 5 (breakage from long text). No real title this long exists in
 * the seeded data, so this injects one -- a single unbroken "word" with no
 * spaces at all (a pasted URL, a SKU-like string, or a typo are the
 * realistic sources; a title with normal spaces already wraps fine and was
 * not the thing under test).
 *
 * MECHANISM, confirmed live step by step before fixing anything: a CSS grid
 * item's default `min-width: auto` sizes it to its content's min-content
 * width -- which, for an unbroken word, is the WHOLE word, regardless of
 * `overflow-wrap: break-word` on a descendant text node (that only lets the
 * text node ITSELF wrap; it does not override an ANCESTOR's own default
 * min-width). `break-words` alone, confirmed NOT sufficient on its own
 * (scrollWidth unchanged); `min-w-0` alone, ALSO confirmed not sufficient
 * (the grid item's own box narrows but its text still overflows past it
 * uncontained); only BOTH together closed it (verified in that order:
 * neither-fixed -> each alone -> both together, scrawWidth only returned to
 * the viewport width on the last step).
 *
 * Three sites fixed, one shared component each (so every grid this
 * component sits in is covered, not just the route tested here):
 *   - ProductCard.tsx: `min-w-0` on the card's own root div, `break-words`
 *     on the title <p>.
 *   - JobCard.tsx: `min-w-0` on the card's own root div, `break-words` on
 *     the title <h3>.
 *   - apps/web/app/vendors/page.tsx (not a shared component -- this card
 *     shape is unique to the vendor directory grid): `min-w-0` on the grid
 *     item <Link> AND on the flex wrapper beside the fixed-width logo
 *     (the same "min-w-0 beside a fixed-width sibling" shape named in
 *     CLAUDE.md), `break-words` on the business-name <p>.
 *
 * [LOCAL ONLY, skips without live card data -- see each test below] All
 * three routes fetch their card data server-side, so in CI (where the API
 * is dead -- no `services:` block, `NEXT_PUBLIC_API_URL` points at a dead
 * `localhost:4000`) no ProductCard/JobCard/vendor card ever renders at all,
 * and `injectLongTextAndMeasure`'s selector correctly finds nothing
 * (`found: false`). That used to hard-fail on `expect(result.found).toBe(true)`
 * -- not a real defect, just this spec's own precondition going unmet, same
 * shape as the MDF-266 reclassification of this file's three cases from
 * REAL DEFECT to environment-conditioned. Each test now skips honestly on
 * that exact signal instead. With a live API (locally), the cards render
 * and the real overflow assertion below still runs unchanged.
 */

const LONG_WORD =
  'Supercalifragilisticexpialidociousxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

async function injectLongTextAndMeasure(page: Page, selector: string) {
  return page.evaluate(
    ({ selector, LONG_WORD }) => {
      const el = document.querySelector(selector);
      if (!el) return { found: false as const };
      el.textContent = LONG_WORD;
      return {
        found: true as const,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    },
    { selector, LONG_WORD },
  );
}

test.describe('an unbroken long title does not overflow the page at 320px', () => {
  test('/products — ProductCard title', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 1000 });
    await page.goto('/products');
    const result = await injectLongTextAndMeasure(page, 'p.mt-3.font-semibold.text-belize-navy');
    test.skip(!result.found, 'No ProductCard rendered -- the API is dead in this environment, so there is no card to inject a long title into.');
    expect(result.scrollWidth, 'page overflow at 320px after an unbroken long title').toBeLessThanOrEqual(result.clientWidth! + 1);
  });

  test('/jobs — JobCard title', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 1000 });
    await page.goto('/jobs');
    const result = await injectLongTextAndMeasure(page, 'h3.font-bold.text-belize-navy');
    test.skip(!result.found, 'No JobCard rendered -- the API is dead in this environment, so there is no card to inject a long title into.');
    expect(result.scrollWidth, 'page overflow at 320px after an unbroken long title').toBeLessThanOrEqual(result.clientWidth! + 1);
  });

  test('/vendors — business name beside the fixed-width logo', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 1000 });
    await page.goto('/vendors');
    const result = await injectLongTextAndMeasure(page, 'a[href^="/store/"] p.font-semibold');
    test.skip(!result.found, 'No vendor card rendered -- the API is dead in this environment, so there is no card to inject a long business name into.');
    expect(result.scrollWidth, 'page overflow at 320px after an unbroken long business name').toBeLessThanOrEqual(result.clientWidth! + 1);
  });
});

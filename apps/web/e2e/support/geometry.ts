import type { Page } from '@playwright/test';

/**
 * A third class of responsive defect, alongside horizontal overflow
 * (scrollWidth > clientWidth) and viewport clipping (a panel's edge outside
 * 0..width) -- neither of which this shape produces. Found live on
 * bzemarketplace.com by a sibling agent at 768px: the Platform Wallet
 * transaction labels ("Payment to vendor", "Wallet top-up") sit in the DOM,
 * fully legible text, but render at literally ZERO WIDTH -- not an
 * ellipsis, not a clipped character, nothing on screen at all.
 *
 * MECHANISM (components/landing/Services.tsx, WalletCard): a flex row
 * activates at `sm` (640px) with a fixed-width `shrink-0` balance panel
 * beside a `min-w-0 flex-1` detail column; the label itself is a
 * `min-w-0` + `truncate` block next to a `shrink-0` amount. The row
 * becomes a column again below 640px (room for everything), and the
 * card's own container widens enough above ~1024px (it moves from a
 * 2-column to a `lg:col-span-7` grid) that there is room again. Only in
 * the ~640-1023px band does `min-w-0` resolve the label's flex-basis to
 * 0 while its OWN box still legitimately has non-empty text content.
 *
 * WHY boundingBox() AND a Range() ARE BOTH NEEDED, NOT EITHER ALONE --
 * this is the opposite shape from the MDF-128 wallet-balance-wrap case
 * (authenticated-dashboard-geometry.spec.ts), and conflating the two
 * techniques silently misses one or the other:
 *   - Here, the ELEMENT's own boundingBox() correctly collapses to ~0 --
 *     that IS the defect, the box that `truncate` promised would show an
 *     ellipsis shows nothing at all because it has no width to truncate
 *     INTO. A Range() over the text alone would NOT catch this: it
 *     reports the text's natural (unclipped, un-truncated) layout width,
 *     which stays non-zero regardless of the ancestor's real collapse --
 *     confirmed empirically (the Range widths below are ~17-95px at the
 *     exact pixel the element box reports 0).
 *   - In the wallet-balance case, it was the reverse: the element's own
 *     box stayed inside its card even with the real fix reverted, because
 *     a block element's layout width doesn't grow for `white-space:
 *     nowrap` overflow -- only the painted text does, which only a
 *     Range() can see.
 *   So: use boundingBox() to ask "is anything actually visible here", and
 *   a Range() over the SAME element to ask "is there real text that wants
 *   to be visible" -- the combination is what tells apart a genuinely
 *   empty/decorative element (both near zero) from this exact collapse
 *   (element near zero, Range clearly not).
 *
 * `sr-only` is excluded on purpose: Tailwind's screen-reader-only pattern
 * (1x1px, clipped, absolutely positioned) legitimately produces a
 * near-zero visual box over real text, and is not this defect. Matched by
 * class name, which is this codebase's one actual pattern for it -- not a
 * generalized clip-rect/clip-path detector.
 */
export interface ZeroWidthFinding {
  text: string;
  tag: string;
  className: string;
}

export async function zeroWidthTextFindings(page: Page): Promise<ZeroWidthFinding[]> {
  return page.evaluate(() => {
    const out: { text: string; tag: string; className: string }[] = [];
    const NON_TEXT_TAGS = new Set(['SCRIPT', 'STYLE', 'SVG', 'PATH', 'CIRCLE', 'RECT']);

    for (const el of document.body.querySelectorAll('*')) {
      if (el.children.length !== 0) continue; // leaf elements only -- avoid double-counting a parent's combined text
      const text = (el.textContent || '').trim();
      if (!text) continue;
      if (NON_TEXT_TAGS.has(el.tagName)) continue;

      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (el.classList.contains('sr-only')) continue;

      const box = el.getBoundingClientRect();
      if (box.width >= 2) continue; // something is actually showing -- not this bug

      const range = document.createRange();
      range.selectNodeContents(el);
      const naturalTextWidth = range.getBoundingClientRect().width;
      if (naturalTextWidth < 2) continue; // no real text wants to render here either -- a genuinely empty/decorative element

      // Climb past zero/near-zero ancestors (the collapsed flex chain itself)
      // to find whether a real container exists with room -- distinguishes
      // "the text has nowhere to go anywhere near here" from this bug.
      let ancestor: HTMLElement | null = el.parentElement;
      let depth = 0;
      while (ancestor && ancestor.getBoundingClientRect().width < 20 && depth < 6) {
        ancestor = ancestor.parentElement;
        depth++;
      }
      const ancestorWidth = ancestor ? ancestor.getBoundingClientRect().width : 0;
      if (ancestorWidth < 40) continue;

      out.push({ text: text.slice(0, 80), tag: el.tagName, className: (el.className || '').toString().slice(0, 120) });
    }
    return out;
  });
}

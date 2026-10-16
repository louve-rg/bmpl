import type { Locator, Page } from '@playwright/test';

/**
 * Ported to apps/admin from apps/web/e2e/support/geometry.ts (which has
 * carried this since the MDF-152 Platform Wallet defect) — admin had no
 * equivalent until this port (Priority 6, owner directive 2026-10-16: admin
 * wallet/financial figures are named explicitly as an at-risk surface). See
 * the web file for the full defect writeup; the mechanism and the function
 * are identical, duplicated rather than shared for the same reason as this
 * directory's other support files (no shared package between the two apps'
 * e2e trees today).
 *
 * A third class of responsive defect, alongside horizontal overflow
 * (scrollWidth > clientWidth) and viewport clipping: an element whose
 * boundingBox collapses to ~0 width while its real text content clearly
 * wants to render — not an ellipsis, not a clipped character, nothing on
 * screen at all. boundingBox() alone can't distinguish this from a
 * genuinely empty/decorative element; a Range() over the same element's
 * text content, which reports the text's natural layout width regardless of
 * the box's real collapse, is what tells the two apart.
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

/**
 * Pairwise bounding-box intersection over a CURATED set of locators — not a
 * generic whole-page solver. See apps/web/e2e/support/geometry.ts's own copy
 * for the full reasoning; identical here.
 */
export interface OverlapFinding {
  aLabel: string;
  bLabel: string;
  overlapPx: { width: number; height: number };
}

export async function findOverlaps(labeled: Array<{ label: string; locator: Locator }>): Promise<OverlapFinding[]> {
  const boxes = await Promise.all(
    labeled.map(async (l) => ({ label: l.label, box: await l.locator.boundingBox() })),
  );
  const out: OverlapFinding[] = [];
  for (let i = 0; i < boxes.length; i++) {
    const current = boxes[i];
    if (!current) continue;
    for (let j = i + 1; j < boxes.length; j++) {
      const other = boxes[j];
      if (!other) continue;
      const a = current.box;
      const b = other.box;
      if (!a || !b) continue;
      const overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (overlapWidth > 1 && overlapHeight > 1) {
        out.push({ aLabel: current.label, bLabel: other.label, overlapPx: { width: overlapWidth, height: overlapHeight } });
      }
    }
  }
  return out;
}

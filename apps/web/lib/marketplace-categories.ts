/**
 * Pure helpers for the marketplace category taxonomy.
 *
 * The hierarchy itself is production data served by `/marketplace/categories` —
 * top-level categories each with their subcategories. Nothing here creates,
 * renames, reorders or flattens it; these functions only read it, so the mobile
 * category control and the desktop sidebar can render the same tree.
 */

export interface CatNode {
  id: string;
  name: string;
  slug: string;
  children: CatNode[];
}

/**
 * The selected category anywhere in the two-level tree, or null.
 *
 * Used for the collapsed mobile label, which must name a SUBCATEGORY when one is
 * selected — showing its parent would tell the shopper they are filtered by
 * something they are not.
 */
export function findCategory(cats: readonly CatNode[], id: string | undefined): CatNode | null {
  if (!id) return null;
  for (const c of cats) {
    if (c.id === id) return c;
    const child = (c.children ?? []).find((ch) => ch.id === id);
    if (child) return child;
  }
  return null;
}

/** Every category id in the tree, parents and children, in display order. */
export function flattenCategoryIds(cats: readonly CatNode[]): string[] {
  return cats.flatMap((c) => [c.id, ...(c.children ?? []).map((ch) => ch.id)]);
}

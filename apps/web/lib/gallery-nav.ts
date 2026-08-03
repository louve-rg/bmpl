/**
 * Pure helpers for the product gallery + variant-URL sync (M — mobile gallery/nav).
 * Kept framework-free so the swipe/index/history logic is unit-testable in a node env.
 */

/** Which way a horizontal touch drag went: left → next, right → prev, else null. */
export function swipeDirection(startX: number | null, endX: number, threshold = 40): 'next' | 'prev' | null {
  if (startX == null) return null;
  const dx = endX - startX;
  if (dx <= -threshold) return 'next'; // swipe left
  if (dx >= threshold) return 'prev'; // swipe right
  return null;
}

/** Clamp a gallery index into [0, count-1] (no wrap-around at the ends). */
export function clampIndex(i: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, i));
}

/** Next index after a swipe direction, clamped. */
export function indexAfterSwipe(index: number, dir: 'next' | 'prev' | null, count: number): number {
  if (dir === 'next') return clampIndex(index + 1, count);
  if (dir === 'prev') return clampIndex(index - 1, count);
  return clampIndex(index, count);
}

/**
 * True only when the `?variant=` URL actually needs updating. Guards against replacing
 * history on mount/hydration when the URL already matches — that churn corrupted the
 * App-Router history and broke mobile swipe-back.
 */
export function variantUrlChanged(currentParam: string | null, nextVariantId: string | null): boolean {
  return currentParam !== nextVariantId;
}

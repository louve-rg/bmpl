/**
 * Combined product-gallery ordering — the SINGLE source of truth shared by the live
 * marketplace product page and the vendor Storefront Preview, so both render the
 * exact same thumbnail/carousel sequence.
 *
 * The vendor editor is the source of truth for ordering:
 *  - variant order = the order of the variant ids passed in (the API returns variants
 *    ordered by their vendor `position`),
 *  - image order within a group = primary first, then the vendor-configured `position`.
 *
 * For the unfiltered ("All") gallery, images are GROUPED by variant and concatenated
 * in variant order — never interleaved — with any general (non-variant) images first.
 * When a specific variant is selected, only that variant's images are returned (with a
 * graceful fallback to general/all). The Brand Image is excluded upstream (the API's
 * listGallery / the preview's brand filter), never here by role.
 */

export interface OrderedImage {
  variantId?: string | null;
  position?: number;
  isPrimary?: boolean;
  url?: string | null;
}

/** Within one group: primary image first, then the vendor-configured position. */
function sortGroup<T extends OrderedImage>(imgs: T[]): T[] {
  return [...imgs].sort((a, b) => {
    if (!!a.isPrimary !== !!b.isPrimary) return a.isPrimary ? -1 : 1;
    return (a.position ?? 0) - (b.position ?? 0);
  });
}

/**
 * Build the ordered gallery for the current selection.
 *
 * @param images           flat image list (each carrying variantId/position/isPrimary)
 * @param variantOrder     variant ids in vendor-defined order (grouping order)
 * @param selectedVariantId the currently selected variant, or null for "All"
 */
export function buildGalleryImages<T extends OrderedImage>(
  images: T[],
  variantOrder: string[],
  selectedVariantId: string | null,
): T[] {
  const general = sortGroup(images.filter((i) => i.variantId == null));

  // Specific variant selected → only that variant's images, vendor order.
  if (selectedVariantId) {
    const forVariant = sortGroup(images.filter((i) => i.variantId === selectedVariantId));
    if (forVariant.length) return forVariant;
    return general.length ? general : images; // graceful fallback (unchanged behaviour)
  }

  // "All" → general images first, then each variant group in vendor order (grouped,
  // never interleaved). Dedupe by url so an image referenced twice never repeats.
  const out: T[] = [];
  const seenUrls = new Set<string>();
  const push = (img: T) => {
    if (img.url && seenUrls.has(img.url)) return;
    if (img.url) seenUrls.add(img.url);
    out.push(img);
  };
  for (const g of general) push(g);
  for (const vid of variantOrder) for (const img of sortGroup(images.filter((i) => i.variantId === vid))) push(img);
  // Safety: any variant-assigned image whose variant isn't in variantOrder — append
  // grouped by variantId so nothing is silently dropped.
  const remaining = images.filter((i) => i.variantId != null && !variantOrder.includes(i.variantId));
  const byVariant = new Map<string, T[]>();
  for (const img of remaining) {
    const key = img.variantId as string;
    (byVariant.get(key) ?? byVariant.set(key, []).get(key)!).push(img);
  }
  for (const group of byVariant.values()) for (const img of sortGroup(group)) push(img);

  return out.length ? out : images;
}

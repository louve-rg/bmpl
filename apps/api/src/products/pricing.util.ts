/**
 * Server-authoritative unit-price resolution — the single source of truth for
 * how a product/variant price is computed. Reused by the cart (M9) and checkout
 * (M10) so there is exactly one pricing rule.
 *
 * Precedence: variant sale → variant price → product sale → product price.
 * A variant with neither its own price nor sale inherits the product's pricing.
 * All values are BigInt minor units (cents).
 */
export function effectiveUnitPrice(
  product: { priceMinor: bigint; salePriceMinor: bigint | null },
  variant?: { priceMinor: bigint | null; salePriceMinor: bigint | null } | null,
): bigint {
  if (variant) {
    if (variant.salePriceMinor != null) return variant.salePriceMinor;
    if (variant.priceMinor != null) return variant.priceMinor;
  }
  return product.salePriceMinor ?? product.priceMinor;
}

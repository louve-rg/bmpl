/** Shared types for the variant-centric product editor (Phase M6.1). */

export interface OptionValue {
  id: string;
  value: string;
}

export interface ProductOption {
  id: string;
  name: string;
  values: OptionValue[];
}

export interface Variant {
  id: string;
  title: string;
  displayName: string | null;
  optionLabel: string | null;
  sku: string | null;
  barcode: string | null;
  priceMinor: number | null;
  salePriceMinor: number | null;
  isActive: boolean;
  optionValueIds: string[];
  quantity: number;
}

export interface ManageView {
  productTitle: string;
  options: ProductOption[];
  variants: Variant[];
}

export interface ProductImage {
  id: string;
  variantId: string | null;
  url: string | null;
  altText: string | null;
  caption: string | null;
  position: number;
  isPrimary: boolean;
  width: number | null;
  height: number | null;
}

export interface InvRow {
  inventoryId: string;
  variantId?: string | null;
  sku?: string | null;
  quantity: number;
  reserved: number;
  available: number | null;
  unlimited: boolean;
  allowBackorders: boolean;
  lowStockThreshold: number;
  inStock: boolean;
  lowStock: boolean;
  outOfStock: boolean;
}

export interface Inventory {
  product: InvRow;
  variants: InvRow[];
}

/**
 * Upload constraints for private documents and profile images.
 *
 * These are enforced on the BACKEND at two points: (1) when a presigned upload
 * URL is requested, and (2) after upload, by inspecting the actual stored object
 * (HEAD) before persisting its metadata. Client-side checks are convenience only.
 */

/** Allowed MIME types for role-application / KYC documents. */
export const DOCUMENT_MIME_ALLOWLIST = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const;
export type DocumentMime = (typeof DOCUMENT_MIME_ALLOWLIST)[number];

/** Allowed MIME types for profile avatars. */
export const AVATAR_MIME_ALLOWLIST = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AvatarMime = (typeof AVATAR_MIME_ALLOWLIST)[number];

/**
 * Allowed MIME types for public marketplace images (product photos, vendor
 * logo/banner, category icon/image). Stored in the PUBLIC bucket.
 */
export const PRODUCT_IMAGE_MIME_ALLOWLIST = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ProductImageMime = (typeof PRODUCT_IMAGE_MIME_ALLOWLIST)[number];

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_PRODUCT_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

export const isAllowedDocumentMime = (mime: string): mime is DocumentMime =>
  (DOCUMENT_MIME_ALLOWLIST as readonly string[]).includes(mime);

export const isAllowedAvatarMime = (mime: string): mime is AvatarMime =>
  (AVATAR_MIME_ALLOWLIST as readonly string[]).includes(mime);

export const isAllowedProductImageMime = (mime: string): mime is ProductImageMime =>
  (PRODUCT_IMAGE_MIME_ALLOWLIST as readonly string[]).includes(mime);

/**
 * Storage key prefixes (namespaces). Ownership is enforced against these via
 * StorageService.assertKeyInNamespace. Marketplace images live under the owning
 * vendor's namespace so a single ownership check covers logo/banner/products.
 */
export const STORAGE_PREFIX = {
  applicationDocs: (userId: string, roleCode: string) => `applications/${userId}/${roleCode}`,
  avatar: (userId: string) => `avatars/${userId}`,
  // ---- Marketplace (Phase 2), public bucket ----
  vendorRoot: (vendorProfileId: string) => `vendors/${vendorProfileId}`,
  vendorLogo: (vendorProfileId: string) => `vendors/${vendorProfileId}/logo`,
  vendorBanner: (vendorProfileId: string) => `vendors/${vendorProfileId}/banner`,
  productImage: (vendorProfileId: string, productId: string) =>
    `vendors/${vendorProfileId}/products/${productId}`,
  categoryImage: (categoryId: string) => `categories/${categoryId}`,
  // ---- Logistics: Driver Management (Phase 4 · M14), PRIVATE bucket ----
  // Driver profile photo + vehicle photos hold personal/registration data → private,
  // viewed only via short-lived signed URLs after ownership/permission checks.
  driverPhoto: (userId: string) => `drivers/${userId}/profile`,
  driverVehiclePhoto: (userId: string) => `drivers/${userId}/vehicles`,
  // ---- Logistics: Dispatch proof-of-delivery (Phase 4 · M15), PRIVATE bucket ----
  // POD photos/signature capture the recipient/premises → private, viewed only via
  // short-lived signed URLs by the authorized customer/vendor/driver/admin.
  deliveryProof: (userId: string) => `deliveries/proof/${userId}`,
} as const;

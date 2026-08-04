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
 * Sniff an image's REAL MIME from its magic bytes. Used for server-side uploads
 * (browser → API → storage) where the client-declared Content-Type must never be
 * trusted as the source of truth. Returns null when the bytes are not one of the
 * allowed product-image formats (JPEG/PNG/WebP), so the caller rejects the upload.
 */
export function sniffProductImageMime(bytes: Uint8Array): ProductImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  // RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/** File extension for an allowed product-image MIME (for building storage keys). */
export const productImageExt = (mime: ProductImageMime): string =>
  mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';

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
  // ---- Messaging attachments (Phase 4 · M17), PRIVATE bucket ----
  // Message attachments (issue/damage photos, supporting docs) → private, viewed
  // only via short-lived signed URLs by conversation participants (+ authorized support).
  messageAttachment: (userId: string) => `messages/${userId}`,
  // ---- Review media (Phase 4 · M19), PRIVATE bucket ----
  // Review photos uploaded privately + shown via short-lived signed URLs once
  // published (reactive moderation can reject them).
  reviewMedia: (userId: string) => `reviews/${userId}`,
  // ---- Belize Connect Jobs (Phase 5 · M24) ----
  // Résumés/CVs + cover-letter/portfolio docs hold personal data → PRIVATE bucket,
  // signed URLs only to the owner, employers of jobs the owner applied to, + permitted admins.
  jobSeekerResume: (userId: string) => `jobs/resumes/${userId}`,
  jobSeekerPhoto: (userId: string) => `jobs/seeker-photo/${userId}`,
  // Employer company logo/banner → PUBLIC bucket (shown on public job/company pages).
  employerLogo: (employerProfileId: string) => `employers/${employerProfileId}/logo`,
  employerBanner: (employerProfileId: string) => `employers/${employerProfileId}/banner`,
  // ---- Real Estate (Phase 6 · M25) ----
  // Property photos → PUBLIC bucket (shown on public listings).
  propertyImage: (listingId: string) => `properties/${listingId}/images`,
  // Ownership/authority documents → PRIVATE bucket (signed URLs to owner/assigned agent/permitted admins).
  propertyDocument: (listingId: string) => `properties/${listingId}/docs`,
  // Agent photo (public) + agency logo/banner (public).
  agentPhoto: (userId: string) => `real-estate/agents/${userId}/photo`,
  agencyLogo: (agencyId: string) => `real-estate/agencies/${agencyId}/logo`,
  agencyBanner: (agencyId: string) => `real-estate/agencies/${agencyId}/banner`,
  // Marketing & Business Promotion (M26) — public promo media
  promotionAsset: (promotionId: string) => `marketing/promotions/${promotionId}/assets`,
} as const;

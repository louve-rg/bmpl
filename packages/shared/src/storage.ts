/**
 * Upload constraints for private documents and profile images.
 *
 * These are enforced on the BACKEND at two points: (1) when a presigned upload
 * URL is requested, and (2) after upload, by inspecting the actual stored object
 * (HEAD) before persisting its metadata. Client-side checks are convenience only.
 *
 * NOTE: the API compiles this package into its deployed bundle, so editing this
 * file changes production API behaviour. `packages/**` is therefore one of the
 * Railway watch patterns in `railway.json` — see docs/DEPLOYMENT.md §2a.
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

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * Pixel dimensions of a JPEG/PNG/WebP, read straight from the header bytes.
 *
 * Deliberately dependency-free: the API needs the dimensions to judge how much of
 * the frame a detected face fills (a person standing in a landscape shot is a
 * face, but a useless 40px avatar), and pulling a native image library into the
 * deployed bundle for two integers is not worth it. Returns null when the format
 * is unrecognised or the header is truncated — callers treat that as "unknown"
 * and skip the coverage rule rather than rejecting the upload.
 */
export function readImageSize(bytes: Uint8Array): ImageSize | null {
  const mime = sniffProductImageMime(bytes);
  if (mime === 'image/png') return pngSize(bytes);
  if (mime === 'image/jpeg') return jpegSize(bytes);
  if (mime === 'image/webp') return webpSize(bytes);
  return null;
}

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const u32be = (b: Uint8Array, i: number) =>
  ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;

/** PNG: the IHDR chunk is always first, so width/height sit at a fixed offset. */
function pngSize(b: Uint8Array): ImageSize | null {
  if (b.length < 24) return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

/**
 * JPEG: walk the marker segments until a Start-Of-Frame, whose payload carries
 * the dimensions. SOF markers are 0xC0–0xCF excluding 0xC4/0xC8/0xCC, which are
 * Huffman/arithmetic tables rather than frame headers.
 */
function jpegSize(b: Uint8Array): ImageSize | null {
  let i = 2; // skip SOI
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1; // resynchronise on padding/garbage between segments
      continue;
    }
    const marker = b[i + 1]!;
    // Standalone markers (RSTn, SOI, EOI, TEM) carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    i += 2 + length;
  }
  return null;
}

/** WebP: three container flavours (lossy VP8, lossless VP8L, extended VP8X). */
function webpSize(b: Uint8Array): ImageSize | null {
  if (b.length < 30) return null;
  const chunk = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (chunk === 'VP8 ') {
    // Frame header: 3-byte tag, then the 0x9d012a sync code, then 14-bit dims.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    // 1 signature byte, then 14 bits of width-1 followed by 14 bits of height-1.
    if (b[20] !== 0x2f) return null;
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    // Extended format stores canvas size as two 24-bit little-endian (value - 1).
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}

/** ISO-BMFF brands that identify a HEIC/HEIF still image. */
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);

/**
 * Sniff a DOCUMENT's real MIME from its magic bytes — the document counterpart of
 * {@link sniffProductImageMime}, covering the full {@link DOCUMENT_MIME_ALLOWLIST}
 * (PDF, JPEG, PNG, WebP, HEIC). Used for server-side document uploads
 * (browser → API → storage) where a client-declared Content-Type is never trusted.
 * Returns null when the bytes are not an allowed document, so the caller rejects it.
 */
export function sniffDocumentMime(bytes: Uint8Array): DocumentMime | null {
  // "%PDF"
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
  ) {
    return 'application/pdf';
  }
  // JPEG/PNG/WebP are all on the document allow-list too.
  const image = sniffProductImageMime(bytes);
  if (image) return image;
  // ISO-BMFF container: [size][ftyp][brand]. iPhone photos arrive as HEIC.
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 &&
    HEIC_BRANDS.has(String.fromCharCode(...Array.from(bytes.subarray(8, 12))))
  ) {
    return 'image/heic';
  }
  return null;
}

/** File extension for an allowed document MIME (for building storage keys). */
export const documentExt = (mime: DocumentMime): string =>
  mime === 'application/pdf'
    ? 'pdf'
    : mime === 'image/png'
      ? 'png'
      : mime === 'image/webp'
        ? 'webp'
        : mime === 'image/heic'
          ? 'heic'
          : 'jpg';

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
  // ---- Shipping: pickup-evidence photo (BMPL-178), PRIVATE bucket ----
  // A photo of the parcel taken when a courier collects it, stored on the leg
  // record itself (ShipmentLeg.handoffPhotoKeys) so it stays attached through
  // every later handoff on that leg's history — private, signed URLs only, the
  // same shape as `deliveryProof` above.
  shipmentPickupProof: (userId: string) => `shipments/pickup-proof/${userId}`,
} as const;

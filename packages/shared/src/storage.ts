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

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB

export const isAllowedDocumentMime = (mime: string): mime is DocumentMime =>
  (DOCUMENT_MIME_ALLOWLIST as readonly string[]).includes(mime);

export const isAllowedAvatarMime = (mime: string): mime is AvatarMime =>
  (AVATAR_MIME_ALLOWLIST as readonly string[]).includes(mime);

/** Storage key prefixes (namespaces). Ownership is enforced against these. */
export const STORAGE_PREFIX = {
  applicationDocs: (userId: string, roleCode: string) => `applications/${userId}/${roleCode}`,
  avatar: (userId: string) => `avatars/${userId}`,
} as const;

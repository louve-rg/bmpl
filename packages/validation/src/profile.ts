import { z } from 'zod';
import {
  AVATAR_REJECTION_REASON_CODES,
  DOCUMENT_MIME_ALLOWLIST,
  MAX_DOCUMENT_BYTES,
} from '@bmpl/shared';
import { districtSchema, phoneSchema } from './common';

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  phone: phoneSchema.optional().or(z.literal('')),
  district: districtSchema.optional(),
  addressLine1: z.string().trim().max(160).optional().or(z.literal('')),
  addressLine2: z.string().trim().max(160).optional().or(z.literal('')),
  city: z.string().trim().max(80).optional().or(z.literal('')),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

const fileNameSchema = z.string().trim().min(1).max(200);

/** Presign request for a private application/KYC document upload. */
export const documentUploadRequestSchema = z.object({
  fileName: fileNameSchema,
  contentType: z.enum(DOCUMENT_MIME_ALLOWLIST, {
    errorMap: () => ({ message: 'Unsupported document type. Allowed: PDF, JPEG, PNG, WEBP, HEIC.' }),
  }),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_DOCUMENT_BYTES, 'Document must be 10 MB or smaller.'),
});
export type DocumentUploadRequestInput = z.infer<typeof documentUploadRequestSchema>;

/**
 * Admin decision on a profile picture awaiting review.
 *
 * There is deliberately no client-supplied schema for the UPLOAD itself: avatars
 * are posted as raw bytes and judged from those bytes (real MIME sniffed, size
 * measured, face checked), so a client-declared contentType/sizeBytes would be
 * decoration the backend must ignore anyway.
 */
export const avatarReviewSchema = z.object({
  reason: z.enum(AVATAR_REJECTION_REASON_CODES).optional(),
});
export type AvatarReviewInput = z.infer<typeof avatarReviewSchema>;

/** @deprecated Kept for backward compatibility; prefer the specific schemas above. */
export const uploadRequestSchema = documentUploadRequestSchema;
export type UploadRequestInput = DocumentUploadRequestInput;

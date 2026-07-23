import { z } from 'zod';
import {
  AVATAR_MIME_ALLOWLIST,
  DOCUMENT_MIME_ALLOWLIST,
  MAX_AVATAR_BYTES,
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

/** Presign request for a profile avatar upload (images only). */
export const avatarUploadRequestSchema = z.object({
  fileName: fileNameSchema,
  contentType: z.enum(AVATAR_MIME_ALLOWLIST, {
    errorMap: () => ({ message: 'Unsupported image type. Allowed: JPEG, PNG, WEBP.' }),
  }),
  sizeBytes: z.number().int().positive().max(MAX_AVATAR_BYTES, 'Image must be 5 MB or smaller.'),
});
export type AvatarUploadRequestInput = z.infer<typeof avatarUploadRequestSchema>;

/** @deprecated Kept for backward compatibility; prefer the specific schemas above. */
export const uploadRequestSchema = documentUploadRequestSchema;
export type UploadRequestInput = DocumentUploadRequestInput;

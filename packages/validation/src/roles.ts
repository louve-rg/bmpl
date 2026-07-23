import { z } from 'zod';
import { APPLICABLE_ROLE_CODES } from '@bmpl/shared';
import { cuidSchema, roleCodeSchema } from './common';

/** Only non-admin, non-auto-granted roles may be applied for. */
export const applicableRoleCodeSchema = roleCodeSchema.refine(
  (code) => (APPLICABLE_ROLE_CODES as string[]).includes(code),
  { message: 'This role cannot be applied for.' },
);

export const submitRoleApplicationSchema = z.object({
  roleCode: applicableRoleCodeSchema,
  /** Free-form applicant note / business details. */
  message: z.string().trim().max(2000).optional(),
  /** Keys of already-uploaded documents (from the presign flow). */
  documentKeys: z.array(z.string().min(1)).max(10).default([]),
});
export type SubmitRoleApplicationInput = z.infer<typeof submitRoleApplicationSchema>;

/** Applicant responding to a MORE_INFO_REQUIRED request. */
export const provideMoreInfoSchema = z.object({
  message: z.string().trim().min(1, 'A response is required.').max(2000),
  documentKeys: z.array(z.string().min(1)).max(10).default([]),
});

/** Requested active role in the role switcher. */
export const switchRoleSchema = z.object({
  roleCode: roleCodeSchema,
});

// ---- Admin review actions --------------------------------------------------

export const reviewApproveSchema = z.object({
  applicationId: cuidSchema,
  note: z.string().trim().max(2000).optional(),
});

export const reviewRejectSchema = z.object({
  applicationId: cuidSchema,
  reason: z.string().trim().min(1, 'A reason is required.').max(2000),
});

export const reviewMoreInfoSchema = z.object({
  applicationId: cuidSchema,
  message: z.string().trim().min(1, 'Describe what is needed.').max(2000),
});

export const suspendRoleSchema = z.object({
  userId: cuidSchema,
  roleCode: roleCodeSchema,
  reason: z.string().trim().min(1, 'A reason is required.').max(2000),
});

export const restoreRoleSchema = z.object({
  userId: cuidSchema,
  roleCode: roleCodeSchema,
  note: z.string().trim().max(2000).optional(),
});

export const revokeRoleSchema = suspendRoleSchema;

export const suspendUserSchema = z.object({
  userId: cuidSchema,
  reason: z.string().trim().min(1, 'A reason is required.').max(2000),
});

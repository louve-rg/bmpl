import { z } from 'zod';
import { districtSchema, emailSchema, passwordSchema, phoneSchema } from './common';

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string().trim().min(1, 'First name is required.').max(80),
  lastName: z.string().trim().min(1, 'Last name is required.').max(80),
  phone: phoneSchema.optional(),
  district: districtSchema.optional(),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the terms to continue.' }),
  }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.'),
  /** Mobile clients pass true to receive tokens in the JSON body. */
  fromMobile: z.boolean().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(10),
});

export const resendVerificationSchema = z.object({
  email: emailSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * The authenticated change-password route. Reuses the SAME passwordSchema
 * register/reset-password already enforce — a rule stated twice is a rule
 * that will eventually disagree with itself (root CLAUDE.md §2).
 * `currentPassword` only needs to be non-empty here: its correctness is
 * checked against the stored hash in AuthService, not by shape.
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.'),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const refreshSchema = z.object({
  /** Optional — web sends via cookie; mobile sends in body. */
  refreshToken: z.string().min(10).optional(),
});

import { z } from 'zod';
import { cuidSchema, emailSchema, passwordSchema } from './common';

/**
 * Terminal operations (TERM-1/TERM-3): terminal companies, the hubs they are
 * authorized to work, and staff scoped to a company AND a specific location.
 * Admin-facing schemas below are strict (the admin console drives every
 * write); the invite-acceptance schema is the one a not-yet-authenticated
 * invitee submits.
 */

export const createTerminalCompanySchema = z.object({
  businessName: z.string().trim().min(1).max(160),
  contactEmail: emailSchema,
  contactPhone: z.string().trim().max(40).optional(),
  /** Admin-supplied, exactly like LogisticsHub.isTest — there is no
   *  self-registering account here to derive it from. Never provided by a
   *  terminal company itself (there is no self-service creation endpoint). */
  isTest: z.boolean().optional().default(false),
});
export type CreateTerminalCompanyInput = z.infer<typeof createTerminalCompanySchema>;

export const addTerminalCompanyLocationSchema = z.object({
  hubId: cuidSchema,
});
export type AddTerminalCompanyLocationInput = z.infer<typeof addTerminalCompanyLocationSchema>;

export const terminalCompanyMemberRoleSchema = z.enum(['MANAGER', 'OPERATOR']);

export const inviteTerminalCompanyMemberSchema = z.object({
  email: emailSchema,
  memberRole: terminalCompanyMemberRoleSchema.optional().default('OPERATOR'),
  /** At least one — TERM-3's ruling: a staff member is authorized for
   *  specific locations, never the whole company by default. */
  locationIds: z.array(cuidSchema).min(1, 'Select at least one location.'),
});
export type InviteTerminalCompanyMemberInput = z.infer<typeof inviteTerminalCompanyMemberSchema>;

/**
 * Submitted by the invitee, unauthenticated, from the emailed link.
 * `password`/`firstName`/`lastName` are optional HERE because they are only
 * REQUIRED when the invited email has no existing BML account yet — that
 * branch is a runtime lookup the schema cannot express, so the service
 * enforces it with a clear message rather than a zod refinement guessing at
 * a database state it cannot see.
 */
export const acceptTerminalInviteSchema = z.object({
  token: z.string().trim().min(1),
  password: passwordSchema.optional(),
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
});
export type AcceptTerminalInviteInput = z.infer<typeof acceptTerminalInviteSchema>;

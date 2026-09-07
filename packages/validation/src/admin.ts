import { z } from 'zod';
import { PERMISSIONS } from '@bmpl/shared';
import { cuidSchema } from './common';

export const userSearchSchema = z.object({
  query: z.string().trim().max(120).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const permissionSchema = z.enum(PERMISSIONS);

export const setAdminPermissionsSchema = z.object({
  userId: cuidSchema,
  permissions: z.array(permissionSchema).max(PERMISSIONS.length),
});

/**
 * Designate a storefront or driver profile as a SIMULATION account.
 *
 * Admin-only, and it is the root of the whole test-isolation design: orders
 * derive `isTest` from the storefront, and only a driver flagged here may ever
 * be offered one. Nothing customer-facing can set either flag.
 */
export const testModeSchema = z.object({
  isTest: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});
export type TestModeInput = z.infer<typeof testModeSchema>;

/**
 * Designating a simulation account.
 *
 * Admin-only, and deliberately its own action rather than a field on a general
 * user-update form: marking somebody a test account unlocks simulation wallet
 * funding, so it should be a decision an administrator makes on purpose.
 */
export const setUserTestFlagSchema = z.object({
  userId: z.string().min(1),
  isTest: z.boolean(),
  reason: z.string().trim().min(4, 'Say why.').max(300),
});
export type SetUserTestFlagInput = z.infer<typeof setUserTestFlagSchema>;

/**
 * Administrative test credit.
 *
 * Capped well below anything that could be mistaken for a real settlement, and
 * a reason is mandatory: an unexplained credit in the audit log is only half a
 * record.
 */
export const adminTestCreditSchema = z.object({
  userId: z.string().min(1),
  amountMinor: z.number().int().min(100).max(100_000),
  reason: z.string().trim().min(3).max(500),
});
export type AdminTestCreditInput = z.infer<typeof adminTestCreditSchema>;

/** Lock or unlock a wallet as a fraud/security control. The reason is
 *  REQUIRED both ways: this control exists to be reviewed after an incident,
 *  and an unlock nobody can explain is worse than no feature. */
export const adminWalletLockSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type AdminWalletLockInput = z.infer<typeof adminWalletLockSchema>;

/** How stale a never-authorized hold must be before the sweep releases it. */
export const expireHoldsSchema = z.object({
  olderThanHours: z.number().int().min(1).max(24 * 90).optional().default(24),
});
export type ExpireHoldsInput = z.infer<typeof expireHoldsSchema>;

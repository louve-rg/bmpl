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

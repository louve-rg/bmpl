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

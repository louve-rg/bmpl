import { z } from 'zod';
import { DRIVER_EARNING_METHODS } from '@bmpl/shared';

/** Update the platform fee configuration (M18). All fields optional (partial update). */
export const updateFeeConfigSchema = z
  .object({
    commissionBps: z.coerce.number().int().min(0).max(5000), // ≤ 50%
    driverEarningMethod: z.enum(DRIVER_EARNING_METHODS),
    driverFlatMinor: z.coerce.number().int().min(0).max(1_000_000),
    driverDeliveryFeeBps: z.coerce.number().int().min(0).max(10000), // ≤ 100% of the delivery fee
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });
export type UpdateFeeConfigInput = z.infer<typeof updateFeeConfigSchema>;

import { z } from 'zod';
import { ANNOUNCEMENT_LEVELS } from '@bmpl/shared';

// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]', 'g');
const text = (min: number, max: number) =>
  z.string().transform((s) => s.replace(CONTROL, '').trim()).pipe(z.string().min(min).max(max));

/**
 * Update the platform announcement / maintenance banner (M23). All fields optional
 * (partial update); at least one must be present. The banner is display-only.
 */
export const updatePlatformSettingsSchema = z
  .object({
    announcementActive: z.boolean().optional(),
    announcementLevel: z.enum(ANNOUNCEMENT_LEVELS).optional(),
    announcementMessage: text(1, 500).nullable().optional(),
    maintenanceMode: z.boolean().optional(),
    maintenanceMessage: text(1, 500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });
export type UpdatePlatformSettingsInput = z.infer<typeof updatePlatformSettingsSchema>;

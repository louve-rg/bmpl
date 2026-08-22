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
    // ---- Automatic dispatch (M26.3 · Part 4) ----
    // Operators must be able to retune dispatch, and switch it off in a hurry,
    // without waiting for a deploy. Bounds are deliberately narrow: a 1-second
    // offer timeout or a 500-deep retry budget would be an outage, not a setting.
    dispatchAutomatic: z.boolean().optional(),
  // What a same-district door-to-door courier run costs. Zero means "not
  // priced", and the quote says so rather than quoting the journey as free.
  localCourierFeeMinor: z.number().int().min(0).max(1_000_000).optional(),
  // The simulation rate, kept separate so a testing price cannot become the
  // real nationwide one.
  localCourierFeeTestMinor: z.number().int().min(0).max(1_000_000).optional(),
  localCourierMinutes: z.number().int().min(0).max(24 * 60).optional(),
    dispatchOfferTimeoutSeconds: z.number().int().min(30).max(600).optional(),
    dispatchMaxOffers: z.number().int().min(1).max(20).optional(),
    dispatchMaxConcurrentPerDriver: z.number().int().min(1).max(10).optional(),
    dispatchWeightWorkload: z.number().int().min(0).max(100).optional(),
    dispatchWeightFairness: z.number().int().min(0).max(100).optional(),
    dispatchWeightRating: z.number().int().min(0).max(100).optional(),
    dispatchWeightLocality: z.number().int().min(0).max(100).optional(),
    dispatchWeightExperience: z.number().int().min(0).max(100).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });
export type UpdatePlatformSettingsInput = z.infer<typeof updatePlatformSettingsSchema>;

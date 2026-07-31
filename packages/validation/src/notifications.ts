import { z } from 'zod';
import { NOTIFICATION_CATEGORIES } from '@bmpl/shared';

/** Update a single category's channel preferences (M16). */
export const notificationPreferenceSchema = z.object({
  category: z.enum(NOTIFICATION_CATEGORIES),
  inApp: z.boolean().optional(),
  email: z.boolean().optional(),
  push: z.boolean().optional(),
});
export type NotificationPreferenceInput = z.infer<typeof notificationPreferenceSchema>;

import { z } from 'zod';
import { REVIEW_MAX_RATING, REVIEW_MIN_RATING, REVIEW_REPORT_REASONS, REVIEW_SUBJECT_TYPES } from '@bmpl/shared';

const cuid = z.string().cuid2().or(z.string().cuid());
const storageKey = z.string().trim().min(1).max(512);
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]', 'g');
const text = (min: number, max: number) =>
  z.string().transform((s) => s.replace(CONTROL, '').trim()).pipe(z.string().min(min).max(max));

const rating = z.coerce.number().int().min(REVIEW_MIN_RATING).max(REVIEW_MAX_RATING);

/** Create a verified review against a completed transaction context. */
export const createReviewSchema = z.object({
  subjectType: z.enum(REVIEW_SUBJECT_TYPES),
  contextId: cuid, // orderItemId (PRODUCT) / vendorOrderId (VENDOR) / orderDeliveryId (DRIVER)
  rating,
  title: text(1, 120).optional(),
  body: text(1, 4000),
  mediaKeys: z.array(storageKey).max(5).optional(),
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;

export const editReviewSchema = z
  .object({ rating: rating.optional(), title: text(1, 120).nullable().optional(), body: text(1, 4000).optional() })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });
export type EditReviewInput = z.infer<typeof editReviewSchema>;

/** Vendor response to a review (once; editable). */
export const reviewResponseSchema = z.object({ body: text(1, 2000) });
export type ReviewResponseInput = z.infer<typeof reviewResponseSchema>;

export const reviewReportSchema = z.object({ reason: z.enum(REVIEW_REPORT_REASONS), note: text(1, 500).optional() });
export type ReviewReportInput = z.infer<typeof reviewReportSchema>;

/** Admin moderation of a review. */
export const reviewModerateSchema = z.object({
  action: z.enum(['HIDE', 'UNHIDE', 'REJECT']),
  reason: text(1, 500).optional(),
});
export type ReviewModerateInput = z.infer<typeof reviewModerateSchema>;

export const resolveReportSchema = z.object({
  status: z.enum(['ACTIONED', 'DISMISSED']),
  note: text(1, 500).optional(),
});
export type ResolveReportInput = z.infer<typeof resolveReportSchema>;

import { z } from 'zod';
import { MAX_MESSAGE_BODY_LENGTH, MAX_MESSAGE_ATTACHMENTS } from '@bmpl/shared';

/**
 * Messaging & Order Communication (Phase 4 · M17) request schemas. Message bodies
 * are plain text (rendered as text on the client — never as HTML); we trim, cap
 * length, and strip C0/C1 control characters (except tab/newline) here as defense
 * in depth against injection/rendering issues.
 */

const cuid = z.string().cuid2().or(z.string().cuid());
const storageKey = z.string().trim().min(1).max(512);

// C0/C1 control chars, keeping tab (U+0009) and newline (U+000A). Built via a
// RegExp string so no literal control chars appear in source.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]', 'g');
const messageBody = z
  .string()
  .transform((s) => s.replace(CONTROL_CHARS, '').trim())
  .pipe(z.string().min(1, 'Message cannot be empty.').max(MAX_MESSAGE_BODY_LENGTH));

/** Send a message into an existing conversation. Attachments are pre-uploaded keys. */
export const sendMessageSchema = z.object({
  body: messageBody,
  attachmentKeys: z.array(storageKey).max(MAX_MESSAGE_ATTACHMENTS).optional(),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/** Open / create a support conversation, optionally linked to an order or delivery. */
export const createSupportConversationSchema = z.object({
  subject: z.string().trim().min(1, 'A subject is required.').max(200),
  message: messageBody,
  relatedType: z.enum(['ORDER', 'VENDOR_ORDER', 'DELIVERY']).optional(),
  relatedId: cuid.optional(),
});
export type CreateSupportConversationInput = z.infer<typeof createSupportConversationSchema>;

/** Support/admin internal note (never visible to end users). */
export const internalNoteSchema = z.object({ body: messageBody });
export type InternalNoteInput = z.infer<typeof internalNoteSchema>;

/** Confirm uploaded message-attachment keys (post-upload). */
export const attachmentConfirmSchema = z.object({
  attachmentKeys: z.array(storageKey).min(1).max(MAX_MESSAGE_ATTACHMENTS),
});
export type AttachmentConfirmInput = z.infer<typeof attachmentConfirmSchema>;

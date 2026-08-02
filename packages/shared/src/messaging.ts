/**
 * Messaging & Order Communication (Phase 4 · M17) — shared constants.
 * Conversations are ALWAYS tied to a business context (an order/vendor-order,
 * a delivery, or a support case) — there is no arbitrary user-to-user chat.
 * Framework-agnostic; consumed by API, web, admin, and the future mobile app.
 */

/** The business context a conversation is scoped to. */
export const CONVERSATION_CONTEXTS = ['ORDER', 'VENDOR_ORDER', 'DELIVERY', 'SUPPORT_CASE', 'JOB_APPLICATION', 'PROPERTY_ENQUIRY'] as const;
export type ConversationContext = (typeof CONVERSATION_CONTEXTS)[number];

export const CONVERSATION_STATUSES = ['OPEN', 'CLOSED'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/** A participant's role WITHIN a conversation (distinct from their platform role). */
export const CONVERSATION_PARTICIPANT_ROLES = ['CUSTOMER', 'VENDOR', 'DRIVER', 'SUPPORT', 'EMPLOYER', 'APPLICANT', 'LISTER', 'ENQUIRER'] as const;
export type ConversationParticipantRole = (typeof CONVERSATION_PARTICIPANT_ROLES)[number];

/** Message kinds. INTERNAL_NOTE is support/admin-only and never shown to end users. */
export const MESSAGE_TYPES = ['USER', 'SYSTEM', 'INTERNAL_NOTE'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

/** Placeholder attachment scan lifecycle (no scanner wired yet). */
export const ATTACHMENT_SCAN_STATUSES = ['PENDING', 'CLEAN', 'FLAGGED'] as const;
export type AttachmentScanStatus = (typeof ATTACHMENT_SCAN_STATUSES)[number];

/**
 * Canonical pairing key — the "participant grouping" that, with (contextType,
 * contextId), makes a conversation unique. A delivery has separate customer↔driver
 * and vendor↔driver threads so pickup coordination never leaks to the customer.
 */
export const CONVERSATION_PAIRINGS = ['CUSTOMER_VENDOR', 'CUSTOMER_DRIVER', 'VENDOR_DRIVER', 'USER_SUPPORT', 'EMPLOYER_APPLICANT', 'LISTER_ENQUIRER'] as const;
export type ConversationPairing = (typeof CONVERSATION_PAIRINGS)[number];

/** Attachments reuse the private-document allowlist (images + pdf); NO executables. */
export const MESSAGE_ATTACHMENT_MIME_ALLOWLIST = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'] as const;
export type MessageAttachmentMime = (typeof MESSAGE_ATTACHMENT_MIME_ALLOWLIST)[number];
export const isAllowedMessageAttachmentMime = (mime: string): mime is MessageAttachmentMime =>
  (MESSAGE_ATTACHMENT_MIME_ALLOWLIST as readonly string[]).includes(mime);

export const MAX_MESSAGE_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_MESSAGE_BODY_LENGTH = 4000;
export const MAX_MESSAGE_ATTACHMENTS = 5;

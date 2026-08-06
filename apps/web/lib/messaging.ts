import {
  MAX_MESSAGE_ATTACHMENTS,
  MAX_MESSAGE_ATTACHMENT_BYTES,
  MESSAGE_ATTACHMENT_MIME_ALLOWLIST,
  isAllowedMessageAttachmentMime,
  type ConversationContext,
  type ConversationPairing,
  type ConversationParticipantRole,
  type ConversationStatus,
  type MessageType,
  type AttachmentScanStatus,
} from '@bmpl/shared';
import { api } from './api';
import { uploadFile } from './uploads';

/* ------------------------------------------------------------------ types */

export interface ConversationLastMessage {
  preview: string;
  type: MessageType;
  createdAt: string;
}

/** A row in the conversation list (GET /conversations). */
export interface ConversationSummary {
  id: string;
  contextType: ConversationContext;
  pairing: ConversationPairing;
  subject: string;
  status: ConversationStatus;
  contextLabel: string;
  lastMessage: ConversationLastMessage | null;
  lastMessageAt: string | null;
  unreadCount: number;
}

export interface MessageAttachment {
  id: string;
  mimeType: string;
  fileName: string;
  fileSizeBytes: number;
  scanStatus: AttachmentScanStatus;
  url: string;
}

export interface Message {
  id: string;
  type: MessageType;
  body: string;
  deleted: boolean;
  senderId: string;
  senderName: string;
  senderInitials: string | null;
  /** Approved profile picture of the sender, or null → render initials. */
  senderAvatarUrl: string | null;
  isMine: boolean;
  attachments: MessageAttachment[];
  createdAt: string;
  editedAt: string | null;
}

export interface ConversationParticipant {
  userId: string;
  role: ConversationParticipantRole;
  name: string;
  initials: string;
  /** Approved profile picture, or null → render initials. */
  avatarUrl: string | null;
  canSend: boolean;
}

/** Full conversation (GET /conversations/:id and the mutation responses). */
export interface ConversationDetail {
  id: string;
  contextType: ConversationContext;
  contextId: string;
  pairing: ConversationPairing;
  subject: string;
  contextLabel: string;
  status: ConversationStatus;
  viewerRole: ConversationParticipantRole;
  canSend: boolean;
  participants: ConversationParticipant[];
  messages: Message[];
}

/* ---------------------------------------------------------------- helpers */

export const isImageMime = (mime: string): boolean => mime.startsWith('image/');

/** Human-readable file size, e.g. "1.4 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/** Client-side guard mirroring the server allowlist. Returns an error message or null. */
export function validateAttachment(file: File): string | null {
  if (!isAllowedMessageAttachmentMime(file.type)) {
    return `${file.name}: unsupported file type. Allowed: JPEG, PNG, WebP, HEIC, PDF.`;
  }
  if (file.size > MAX_MESSAGE_ATTACHMENT_BYTES) {
    return `${file.name}: too large (max ${formatBytes(MAX_MESSAGE_ATTACHMENT_BYTES)}).`;
  }
  return null;
}

/** `accept` attribute for the file picker built from the shared allowlist. */
export const ATTACHMENT_ACCEPT = MESSAGE_ATTACHMENT_MIME_ALLOWLIST.join(',');

export { MAX_MESSAGE_ATTACHMENTS, MAX_MESSAGE_ATTACHMENT_BYTES };

/* ------------------------------------------------------------------- api */

/** Upload bytes via the API → return the storage key to pass as an attachmentKey. */
export async function uploadAttachment(file: File): Promise<string> {
  return uploadFile('/conversations/attachments/upload', file);
}

export const messagingApi = {
  list: () => api.get<ConversationSummary[]>('/conversations'),
  unreadCount: () => api.get<{ count: number }>('/conversations/unread-count'),
  get: (id: string) => api.get<ConversationDetail>(`/conversations/${id}`),
  send: (id: string, body: string, attachmentKeys?: string[]) =>
    api.post<ConversationDetail>(`/conversations/${id}/messages`, {
      body,
      ...(attachmentKeys && attachmentKeys.length > 0 ? { attachmentKeys } : {}),
    }),
  markRead: (id: string) => api.post<void>(`/conversations/${id}/read`),
  close: (id: string) => api.post<ConversationDetail>(`/conversations/${id}/close`),
  reopen: (id: string) => api.post<ConversationDetail>(`/conversations/${id}/reopen`),
  support: (input: { subject: string; message: string; relatedType?: string; relatedId?: string }) =>
    api.post<ConversationDetail>('/conversations/support', input),
  openVendorOrder: (vendorOrderId: string) =>
    api.post<ConversationDetail>(`/conversations/vendor-order/${vendorOrderId}`),
  openDelivery: (deliveryId: string, would: 'customer' | 'vendor') =>
    api.post<ConversationDetail>(`/conversations/delivery/${deliveryId}?with=${would}`),
};

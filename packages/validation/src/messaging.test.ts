import { describe, expect, it } from 'vitest';
import { attachmentConfirmSchema, createSupportConversationSchema, internalNoteSchema, sendMessageSchema } from './messaging';

describe('sendMessageSchema', () => {
  it('accepts a plain-text message', () => {
    const result = sendMessageSchema.safeParse({ body: 'Gate code is 4821' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty message with no attachments', () => {
    const result = sendMessageSchema.safeParse({ body: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['body']);
      expect(result.error.issues[0]?.message).toBe('Message cannot be empty.');
    }
  });

  it('rejects a whitespace-only message with no attachments', () => {
    const result = sendMessageSchema.safeParse({ body: '   \n  ' });
    expect(result.success).toBe(false);
  });

  // A photo or PDF with no caption is a complete message — the web Composer
  // deliberately allows sending one (apps/web/app/dashboard/messages/page.tsx:
  // "if (!trimmed && keys.length === 0) return;"), and the server must not
  // disagree and bounce it with "Message cannot be empty."
  it('accepts an empty body when at least one attachment is present', () => {
    const result = sendMessageSchema.safeParse({ body: '', attachmentKeys: ['msg-attachments/user1/photo.jpg'] });
    expect(result.success).toBe(true);
  });

  it('accepts a whitespace-only body (trims to empty) when an attachment is present', () => {
    const result = sendMessageSchema.safeParse({ body: '   ', attachmentKeys: ['msg-attachments/user1/photo.jpg'] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.body).toBe('');
  });

  it('still rejects an empty body when attachmentKeys is present but empty', () => {
    const result = sendMessageSchema.safeParse({ body: '', attachmentKeys: [] });
    expect(result.success).toBe(false);
  });
});

describe('internalNoteSchema / createSupportConversationSchema', () => {
  // Neither context carries attachments, so the attachment-only exception from
  // sendMessageSchema must not leak in here — text stays required.
  it('still requires non-empty text for an internal note', () => {
    expect(internalNoteSchema.safeParse({ body: '' }).success).toBe(false);
    expect(internalNoteSchema.safeParse({ body: 'noted' }).success).toBe(true);
  });

  it('still requires a non-empty opening message for a support case', () => {
    const result = createSupportConversationSchema.safeParse({ subject: 'Help', message: '' });
    expect(result.success).toBe(false);
  });
});

describe('attachmentConfirmSchema', () => {
  it('still requires at least one key', () => {
    expect(attachmentConfirmSchema.safeParse({ attachmentKeys: [] }).success).toBe(false);
    expect(attachmentConfirmSchema.safeParse({ attachmentKeys: ['msg-attachments/user1/photo.jpg'] }).success).toBe(true);
  });
});

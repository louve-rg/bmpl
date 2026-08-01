'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ApiError } from '../../../lib/api';
import { relativeTime } from '../../../lib/notifications';
import { StatusBadge } from '../../../components/StatusBadge';
import { Alert, Badge, Button, EmptyState, PageHeader, Spinner, Textarea } from '../../../components/ui';

/**
 * Client shapes for the M17 admin support console. Mirrors the documented
 * GET /admin/support and GET /admin/support/:id responses.
 */
type SupportStatus = 'OPEN' | 'CLOSED';
type MessageType = 'USER' | 'SYSTEM' | 'INTERNAL_NOTE';

interface SupportRequester {
  name: string;
  email: string;
}

interface SupportListItem {
  id: string;
  subject: string;
  status: SupportStatus;
  requester: SupportRequester | null;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
}

interface SupportAttachment {
  id: string;
  mimeType: string;
  fileName: string;
  fileSizeBytes: number;
  scanStatus: string;
  url: string;
}

interface SupportMessage {
  id: string;
  type: MessageType;
  body: string;
  deleted: boolean;
  senderId: string | null;
  senderName: string | null;
  isMine: boolean;
  attachments: SupportAttachment[];
  createdAt: string;
}

interface SupportParticipant {
  userId: string;
  role: string;
  name: string;
  canSend: boolean;
}

interface SupportDetail {
  id: string;
  contextType: string;
  subject: string;
  contextLabel: string | null;
  status: SupportStatus;
  viewerRole: string | null;
  canSend: boolean;
  participants: SupportParticipant[];
  messages: SupportMessage[];
}

type StatusFilter = 'ALL' | 'OPEN' | 'CLOSED';

const FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'OPEN', label: 'Open' },
  { key: 'CLOSED', label: 'Closed' },
];

function apiStatus(err: unknown): number | undefined {
  return typeof err === 'object' && err !== null ? (err as ApiError).status : undefined;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

export default function SupportPage() {
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [items, setItems] = useState<SupportListItem[]>([]);
  const [listState, setListState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setListState('loading');
    try {
      // The endpoint documents status=OPEN|CLOSED; "All" is served client-side by
      // merging both status feeds so the console can show every conversation.
      let rows: SupportListItem[];
      if (filter === 'ALL') {
        const [open, closed] = await Promise.all([
          api.get<SupportListItem[]>('/admin/support?status=OPEN'),
          api.get<SupportListItem[]>('/admin/support?status=CLOSED'),
        ]);
        rows = [...open, ...closed];
      } else {
        rows = await api.get<SupportListItem[]>(`/admin/support?status=${filter}`);
      }
      rows.sort((a, b) => {
        const at = a.lastMessageAt ?? a.createdAt;
        const bt = b.lastMessageAt ?? b.createdAt;
        return bt.localeCompare(at);
      });
      setItems(rows);
      setListState('ready');
      setSelectedId((prev) => (prev && rows.some((r) => r.id === prev) ? prev : rows[0]?.id ?? null));
    } catch (err) {
      setListState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, [filter]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  return (
    <div>
      <PageHeader
        eyebrow="Support"
        title="Support console"
        description="Customer support conversations and order communication. Reply to customers or add staff-only internal notes."
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={active}
              className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                active
                  ? 'bg-belize-blue text-white shadow-bmpl-sm'
                  : 'border border-slate-300 text-belize-navy hover:border-belize-blue hover:bg-belize-blue/5'
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {listState === 'forbidden' ? (
        <Alert tone="warning" title="Access restricted">
          You do not have permission to view support conversations. The <code>support.read</code> permission is required.
        </Alert>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          {/* Conversation list */}
          <div className="rounded-bmpl-xl border border-slate-200 bg-white">
            {listState === 'loading' ? (
              <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
                <Spinner className="h-4 w-4" /> Loading…
              </div>
            ) : listState === 'error' ? (
              <div className="p-4">
                <Alert tone="error">Could not load support conversations.</Alert>
              </div>
            ) : items.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No conversations" description="Nothing to show for this filter yet." />
              </div>
            ) : (
              <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
                {items.map((it) => {
                  const active = it.id === selectedId;
                  return (
                    <li key={it.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(it.id)}
                        aria-current={active ? 'true' : undefined}
                        className={`flex w-full flex-col gap-1.5 px-4 py-3.5 text-left transition ${
                          active ? 'bg-belize-blue/5' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-belize-navy">{it.subject}</span>
                          <StatusBadge status={it.status} />
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="min-w-0 truncate">
                            {it.requester ? `${it.requester.name} · ${it.requester.email}` : 'Unknown requester'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span>{it.messageCount} {it.messageCount === 1 ? 'message' : 'messages'}</span>
                          <span aria-hidden>·</span>
                          <span>{relativeTime(it.lastMessageAt ?? it.createdAt)}</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Detail pane */}
          {selectedId ? (
            <ConversationDetail key={selectedId} id={selectedId} onChanged={loadList} />
          ) : (
            listState === 'ready' && (
              <div className="rounded-bmpl-xl border border-slate-200 bg-white p-6">
                <EmptyState title="No conversation selected" description="Choose a conversation from the list to view the thread." />
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

function ConversationDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<SupportDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [sendingNote, setSendingNote] = useState(false);

  const threadRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const d = await api.get<SupportDetail>(`/admin/support/${id}`);
      setDetail(d);
      setState('ready');
    } catch (err) {
      setState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the thread scrolled to the newest message when it changes.
  useEffect(() => {
    if (state === 'ready' && threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [state, detail?.messages.length]);

  const applyDetail = useCallback(
    (d: SupportDetail) => {
      setDetail(d);
      setState('ready');
      onChanged();
    },
    [onChanged],
  );

  async function runAction(fn: () => Promise<SupportDetail>) {
    setBusy(true);
    setActionError(null);
    try {
      applyDetail(await fn());
    } catch (err) {
      setActionError(apiStatus(err) === 403 ? 'You do not have permission to do that.' : 'Action failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitReply() {
    const body = reply.trim();
    if (!body) return;
    setSendingReply(true);
    setActionError(null);
    try {
      const d = await api.post<SupportDetail>(`/admin/support/${id}/messages`, { body });
      setReply('');
      applyDetail(d);
    } catch (err) {
      setActionError(apiStatus(err) === 403 ? 'You do not have permission to reply.' : 'Could not send reply. Please try again.');
    } finally {
      setSendingReply(false);
    }
  }

  async function submitNote() {
    const body = note.trim();
    if (!body) return;
    setSendingNote(true);
    setActionError(null);
    try {
      const d = await api.post<SupportDetail>(`/admin/support/${id}/notes`, { body });
      setNote('');
      applyDetail(d);
    } catch (err) {
      setActionError(apiStatus(err) === 403 ? 'You do not have permission to add notes.' : 'Could not save note. Please try again.');
    } finally {
      setSendingNote(false);
    }
  }

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-bmpl-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading conversation…
      </div>
    );
  }
  if (state === 'forbidden') {
    return (
      <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <Alert tone="warning" title="Access restricted">
          You do not have permission to view this conversation.
        </Alert>
      </div>
    );
  }
  if (state === 'error' || !detail) {
    return (
      <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <Alert tone="error">
          Could not load this conversation.{' '}
          <button type="button" onClick={() => void load()} className="font-semibold underline">
            Retry
          </button>
        </Alert>
      </div>
    );
  }

  const requester = detail.participants.find((p) => p.role === 'USER' || p.role === 'CUSTOMER');
  const canJoin = !detail.canSend;

  return (
    <div className="flex min-h-[60vh] flex-col rounded-bmpl-xl border border-slate-200 bg-white">
      {/* Context header */}
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-belize-navy">{detail.subject}</h2>
            <StatusBadge status={detail.status} />
          </div>
          {detail.contextLabel && <p className="mt-1 text-xs font-medium text-slate-400">{detail.contextLabel}</p>}
          <p className="mt-1 text-sm text-slate-500">
            {requester ? requester.name : 'Requester'}
            {detail.viewerRole && <span className="ml-2 text-xs text-slate-400">· You: {detail.viewerRole.replace(/_/g, ' ')}</span>}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canJoin && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void runAction(() => api.post<SupportDetail>(`/admin/support/${id}/join`))}
            >
              Join
            </Button>
          )}
          {detail.status === 'OPEN' ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void runAction(() => api.post<SupportDetail>(`/admin/support/${id}/close`))}
            >
              Close
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void runAction(() => api.post<SupportDetail>(`/admin/support/${id}/reopen`))}
            >
              Reopen
            </Button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="px-4 pt-4">
          <Alert tone="error">{actionError}</Alert>
        </div>
      )}

      {/* Thread */}
      <div ref={threadRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {detail.messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No messages yet.</p>
        ) : (
          detail.messages.map((m) => <MessageRow key={m.id} message={m} />)
        )}
      </div>

      {/* Composers */}
      <div className="space-y-4 border-t border-slate-200 p-4">
        {detail.canSend ? (
          <>
            {/* Customer-visible reply */}
            <div className="rounded-bmpl-lg border border-slate-200 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-belize-blue" aria-hidden />
                <span className="text-sm font-semibold text-belize-navy">Reply to customer</span>
                <Badge tone="info">Visible to customer</Badge>
              </div>
              <Textarea
                rows={3}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Write a reply the customer will see…"
                aria-label="Reply to customer"
              />
              <div className="mt-2 flex justify-end">
                <Button size="sm" disabled={sendingReply || !reply.trim()} onClick={() => void submitReply()}>
                  {sendingReply ? (
                    <>
                      <Spinner className="h-4 w-4" /> Sending…
                    </>
                  ) : (
                    'Send reply'
                  )}
                </Button>
              </div>
            </div>

            {/* Internal note */}
            <div className="rounded-bmpl-lg border border-amber-300 bg-amber-50 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
                <span className="text-sm font-semibold text-amber-800">Add internal note</span>
                <Badge tone="warning">Staff only — never shown to customer</Badge>
              </div>
              <Textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a staff-only internal note…"
                aria-label="Add internal note (staff only)"
                className="bg-white"
              />
              <div className="mt-2 flex justify-end">
                <Button size="sm" variant="outline" disabled={sendingNote || !note.trim()} onClick={() => void submitNote()}>
                  {sendingNote ? (
                    <>
                      <Spinner className="h-4 w-4" /> Saving…
                    </>
                  ) : (
                    'Add note'
                  )}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <Alert tone="neutral">
            {canJoin
              ? 'Join this conversation to reply to the customer or add internal notes.'
              : 'You cannot send messages in this conversation.'}
          </Alert>
        )}
      </div>
    </div>
  );
}

function MessageRow({ message }: { message: SupportMessage }) {
  if (message.type === 'SYSTEM') {
    return (
      <div className="flex justify-center">
        <p className="rounded-full bg-slate-100 px-3 py-1 text-center text-xs text-slate-500">
          {message.deleted ? 'Message removed' : message.body}
        </p>
      </div>
    );
  }

  const isNote = message.type === 'INTERNAL_NOTE';

  return (
    <div className={message.isMine ? 'flex flex-col items-end' : 'flex flex-col items-start'}>
      <div
        className={`max-w-[85%] rounded-bmpl-lg border px-3.5 py-2.5 ${
          isNote
            ? 'border-amber-300 bg-amber-50'
            : message.isMine
              ? 'border-belize-blue/30 bg-belize-blue/5'
              : 'border-slate-200 bg-white'
        }`}
      >
        <div className="mb-1 flex flex-wrap items-center gap-2">
          {isNote && <Badge tone="warning">Internal note — staff only</Badge>}
          <span className="text-xs font-semibold text-belize-navy">{message.senderName ?? 'Unknown'}</span>
          <span className="text-xs text-slate-400">{relativeTime(message.createdAt)}</span>
        </div>
        {message.deleted ? (
          <p className="text-sm italic text-slate-400">This message was removed.</p>
        ) : (
          // Plain text only — rendered as React text, never as HTML.
          <p className={`whitespace-pre-wrap break-words text-sm ${isNote ? 'text-amber-900' : 'text-belize-navy'}`}>
            {message.body}
          </p>
        )}
        {!message.deleted && message.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.attachments.map((a) => (
              <AttachmentChip key={a.id} attachment={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AttachmentChip({ attachment }: { attachment: SupportAttachment }) {
  const isImage = attachment.mimeType.startsWith('image/');
  const ready = attachment.scanStatus === 'CLEAN' || attachment.scanStatus === 'PASSED';

  if (isImage && ready) {
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block overflow-hidden rounded-bmpl-md border border-slate-200"
        title={attachment.fileName}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={attachment.url} alt={attachment.fileName} className="h-20 w-20 object-cover" />
      </a>
    );
  }

  const content = (
    <>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-slate-400" aria-hidden>
        <path d="M14 3v5h5M8 3h6l5 5v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      </svg>
      <span className="max-w-[10rem] truncate">{attachment.fileName}</span>
      <span className="text-slate-400">{formatBytes(attachment.fileSizeBytes)}</span>
    </>
  );

  if (!ready) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-500"
        title={`Scan status: ${attachment.scanStatus}`}
      >
        {content}
        <span className="text-amber-600">· scanning</span>
      </span>
    );
  }

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-belize-navy transition hover:border-belize-blue hover:bg-belize-blue/5"
    >
      {content}
    </a>
  );
}

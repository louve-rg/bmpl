'use client';

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, type ApiError } from '../../../lib/api';
import { relativeTime } from '../../../lib/notifications';
import { badgeCount, unreadLabel } from '../../../lib/badge';
import {
  messagingApi,
  uploadAttachment,
  validateAttachment,
  formatBytes,
  isImageMime,
  ATTACHMENT_ACCEPT,
  MAX_MESSAGE_ATTACHMENTS,
  type ConversationSummary,
  type ConversationDetail,
  type Message,
  type MessageAttachment,
} from '../../../lib/messaging';
import {
  PageHeader,
  Card,
  Badge,
  Button,
  Field,
  Input,
  Textarea,
  Alert,
  Spinner,
  EmptyState,
} from '../../../components/ui';
import { Avatar } from '../../../components/Avatar';
import { MAX_MESSAGE_BODY_LENGTH } from '@bmpl/shared';

function errMessage(e: unknown): string {
  return (e as ApiError)?.message ?? 'Something went wrong.';
}

function absoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/* =============================================================== page shell */

export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="flex items-center gap-2 text-sm text-slate-500"><Spinner className="h-4 w-4" /> Loading…</div>}>
      <MessagesCenter />
    </Suspense>
  );
}

function MessagesCenter() {
  const router = useRouter();
  const search = useSearchParams();
  const preselect = search.get('c');

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(preselect);
  const [supportOpen, setSupportOpen] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const rows = await messagingApi.list();
      setConversations(rows);
      setListError(null);
    } catch (e) {
      setListError(errMessage(e));
    }
  }, []);

  useEffect(() => {
    setListLoading(true);
    void loadList().finally(() => setListLoading(false));
  }, [loadList]);

  // Preselect from ?c once the param is present.
  useEffect(() => {
    if (preselect) setSelectedId(preselect);
  }, [preselect]);

  const selectConversation = useCallback(
    (id: string) => {
      setSupportOpen(false);
      setSelectedId(id);
      // Reflect the selection in the URL without adding history entries.
      router.replace(`/dashboard/messages?c=${id}`, { scroll: false });
    },
    [router],
  );

  const backToList = useCallback(() => {
    setSelectedId(null);
    setSupportOpen(false);
    router.replace('/dashboard/messages', { scroll: false });
  }, [router]);

  // Mark a conversation read locally (badge → 0) after the thread opens it.
  const markReadLocal = useCallback((id: string) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
  }, []);

  const onSupportCreated = useCallback(
    (detail: ConversationDetail) => {
      setSupportOpen(false);
      void loadList();
      selectConversation(detail.id);
    },
    [loadList, selectConversation],
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Messages"
        description="Talk to vendors, drivers, and support about your orders and deliveries."
        actions={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setSelectedId(null);
              setSupportOpen(true);
              router.replace('/dashboard/messages', { scroll: false });
            }}
          >
            Contact support
          </Button>
        }
      />

      <Card className="overflow-hidden p-0">
        <div className="grid min-h-[60vh] md:grid-cols-[minmax(0,22rem)_1fr]">
          {/* -------------------------------------------------------- list pane */}
          <div
            className={`flex flex-col border-slate-200 md:border-r ${
              selectedId || supportOpen ? 'hidden md:flex' : 'flex'
            }`}
          >
            <ConversationList
              conversations={conversations}
              loading={listLoading}
              error={listError}
              selectedId={selectedId}
              onSelect={selectConversation}
              onRetry={() => {
                setListLoading(true);
                void loadList().finally(() => setListLoading(false));
              }}
            />
          </div>

          {/* ------------------------------------------------------ thread pane */}
          <div
            className={`min-w-0 flex-col ${selectedId || supportOpen ? 'flex' : 'hidden md:flex'}`}
          >
            {supportOpen ? (
              <SupportForm onCancel={() => setSupportOpen(false)} onCreated={onSupportCreated} onBack={backToList} />
            ) : selectedId ? (
              <ThreadPane
                key={selectedId}
                conversationId={selectedId}
                onBack={backToList}
                onRead={() => markReadLocal(selectedId)}
                onMutated={loadList}
              />
            ) : (
              <div className="hidden flex-1 items-center justify-center p-10 md:flex">
                <EmptyState
                  title="Select a conversation"
                  description="Choose a conversation from the list to view messages."
                />
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ============================================================= list pane */

function ConversationList({
  conversations,
  loading,
  error,
  selectedId,
  onSelect,
  onRetry,
}: {
  conversations: ConversationSummary[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 p-10 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-4">
        <Alert tone="error" title="Couldn’t load conversations">
          {error}
          <div className="mt-3">
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </Alert>
      </div>
    );
  }
  if (conversations.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <EmptyState
          title="No conversations yet"
          description="Message a vendor from an order, or contact support to start a conversation."
        />
      </div>
    );
  }

  return (
    <ul className="flex-1 divide-y divide-slate-100 overflow-y-auto md:max-h-[70vh]" aria-label="Conversations">
      {conversations.map((c) => {
        const active = c.id === selectedId;
        const time = c.lastMessageAt ?? c.lastMessage?.createdAt ?? null;
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              aria-current={active ? 'true' : undefined}
              className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition ${
                active ? 'bg-belize-blue/5' : 'hover:bg-slate-50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p
                  className={`min-w-0 flex-1 truncate text-sm ${
                    c.unreadCount > 0 ? 'font-semibold text-belize-navy' : 'font-medium text-slate-700'
                  }`}
                >
                  {c.subject || c.contextLabel}
                </p>
                {c.unreadCount > 0 && (
                  <span
                    aria-label={unreadLabel(c.unreadCount)}
                    className="inline-flex min-w-[18px] shrink-0 items-center justify-center rounded-full bg-belize-accent px-1.5 text-[10px] font-bold leading-[18px] text-white"
                  >
                    {badgeCount(c.unreadCount)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="neutral">{c.contextLabel}</Badge>
                {c.status === 'CLOSED' && <Badge tone="neutral">Closed</Badge>}
              </div>
              {c.lastMessage ? (
                <p className={`truncate text-xs ${c.unreadCount > 0 ? 'text-slate-600' : 'text-slate-400'}`}>
                  {c.lastMessage.type === 'SYSTEM' ? '· ' : ''}
                  {c.lastMessage.preview}
                </p>
              ) : (
                <p className="text-xs italic text-slate-400">No messages yet</p>
              )}
              {time && <p className="text-[11px] text-slate-400">{relativeTime(time)}</p>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ============================================================ thread pane */

function ThreadPane({
  conversationId,
  onBack,
  onRead,
  onMutated,
}: {
  conversationId: string;
  onBack: () => void;
  onRead: () => void;
  onMutated: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await messagingApi.get(conversationId);
      setDetail(d);
      setError(null);
      // Mark read (best-effort) once the thread is open.
      messagingApi.markRead(conversationId).then(onRead).catch(() => {});
    } catch (e) {
      setError(errMessage(e));
    }
  }, [conversationId, onRead]);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load]);

  // Keep the transcript pinned to the newest message.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [detail?.messages.length]);

  const applyUpdate = useCallback(
    (d: ConversationDetail) => {
      setDetail(d);
      void onMutated();
    },
    [onMutated],
  );

  async function toggleStatus() {
    if (!detail) return;
    setStatusBusy(true);
    setError(null);
    try {
      const d = detail.status === 'OPEN' ? await messagingApi.close(detail.id) : await messagingApi.reopen(detail.id);
      applyUpdate(d);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setStatusBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-[60vh] flex-col">
      {/* header */}
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-belize-navy md:hidden"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-belize-navy">{detail?.subject || detail?.contextLabel || 'Conversation'}</p>
          {detail && (
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{detail.contextLabel}</Badge>
              <Badge tone={detail.status === 'OPEN' ? 'success' : 'neutral'}>
                {detail.status === 'OPEN' ? 'Open' : 'Closed'}
              </Badge>
            </div>
          )}
        </div>
        {detail && (
          <Button type="button" size="sm" variant="outline" disabled={statusBusy} onClick={toggleStatus}>
            {statusBusy ? <Spinner className="h-4 w-4" /> : detail.status === 'OPEN' ? 'Close' : 'Reopen'}
          </Button>
        )}
      </div>

      {/* transcript */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto bg-slate-50/50 p-4 md:max-h-[60vh]">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
            <Spinner className="h-4 w-4" /> Loading…
          </div>
        ) : error && !detail ? (
          <div className="py-6">
            <Alert tone="error" title="Couldn’t load this conversation">
              {error}
            </Alert>
          </div>
        ) : detail ? (
          detail.messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No messages yet. Say hello 👋</p>
          ) : (
            detail.messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )
        ) : null}
      </div>

      {/* composer */}
      {detail && (
        <Composer
          conversation={detail}
          onSent={applyUpdate}
          inlineError={error && detail ? error : null}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------- message bubble */

function MessageBubble({ message }: { message: Message }) {
  if (message.type === 'SYSTEM') {
    return (
      <div className="flex justify-center">
        <div className="max-w-md rounded-full bg-slate-200/70 px-3 py-1 text-center text-xs text-slate-500">
          {message.deleted ? 'Message removed' : message.body}
          <span className="ml-1.5 text-slate-400">· {relativeTime(message.createdAt)}</span>
        </div>
      </div>
    );
  }

  const mine = message.isMine;
  return (
    // The other party's picture sits beside their bubble; your own messages don't
    // need your face repeated down the right-hand side of your own thread.
    <div className={`flex items-end gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
      {!mine && (
        <Avatar
          name={message.senderName}
          src={message.senderAvatarUrl}
          initials={message.senderInitials}
          size="sm"
          className="mb-5"
        />
      )}
      <div className={`flex min-w-0 flex-1 flex-col ${mine ? 'items-end' : 'items-start'}`}>
        <div className="mb-1 flex items-center gap-2 px-1">
          {!mine && <span className="text-xs font-semibold text-belize-navy">{message.senderName}</span>}
          <span className="text-[11px] text-slate-400" title={absoluteTime(message.createdAt)}>
            {relativeTime(message.createdAt)}
            {message.editedAt ? ' · edited' : ''}
          </span>
        </div>
        <div
          className={`max-w-[85%] rounded-bmpl-lg px-3.5 py-2 text-sm shadow-bmpl-sm sm:max-w-[75%] ${
            mine ? 'bg-belize-blue text-white' : 'border border-slate-200 bg-white text-slate-700'
          }`}
        >
          {message.deleted ? (
            <p className="italic opacity-80">Message removed</p>
          ) : (
            <>
              {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
              {message.attachments.length > 0 && (
                <div className={`flex flex-wrap gap-2 ${message.body ? 'mt-2' : ''}`}>
                  {message.attachments.map((a) => (
                    <AttachmentView key={a.id} attachment={a} mine={mine} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AttachmentView({ attachment, mine }: { attachment: MessageAttachment; mine: boolean }) {
  const pending = attachment.scanStatus === 'PENDING';
  const flagged = attachment.scanStatus === 'FLAGGED';

  if (flagged) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-bmpl-md bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
          <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
        {attachment.fileName} · unavailable
      </span>
    );
  }

  if (isImageMime(attachment.mimeType)) {
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block overflow-hidden rounded-bmpl-md border border-slate-200 bg-white"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={attachment.url}
          alt={attachment.fileName}
          className="h-32 w-32 object-cover"
          loading="lazy"
        />
      </a>
    );
  }

  // Non-image (PDF) → file chip.
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex max-w-[15rem] items-center gap-2 rounded-bmpl-md border px-2.5 py-1.5 text-xs ${
        mine ? 'border-white/30 bg-white/10 text-white' : 'border-slate-200 bg-slate-50 text-slate-700'
      }`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4 shrink-0" aria-hidden>
        <path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-6-6Z" />
        <path d="M13 3v6h6" />
      </svg>
      <span className="min-w-0 flex-1 truncate font-medium">{attachment.fileName}</span>
      <span className={mine ? 'text-white/70' : 'text-slate-400'}>
        {pending ? 'scanning' : formatBytes(attachment.fileSizeBytes)}
      </span>
    </a>
  );
}

/* ------------------------------------------------------------- composer */

interface PendingFile {
  id: string;
  file: File;
  key: string | null;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

function Composer({
  conversation,
  onSent,
  inlineError,
}: {
  conversation: ConversationDetail;
  onSent: (d: ConversationDetail) => void;
  inlineError: string | null;
}) {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const closed = conversation.status === 'CLOSED';
  const canSend = conversation.canSend && !closed;
  const uploading = files.some((f) => f.status === 'uploading');

  const disabledReason = useMemo(() => {
    if (closed) return 'This conversation is closed. Reopen it to send a message.';
    if (!conversation.canSend) return 'You can’t send messages in this conversation.';
    return null;
  }, [closed, conversation.canSend]);

  function pickFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    const incoming = Array.from(list);
    setFiles((prev) => {
      const room = MAX_MESSAGE_ATTACHMENTS - prev.length;
      if (room <= 0) {
        setError(`You can attach up to ${MAX_MESSAGE_ATTACHMENTS} files per message.`);
        return prev;
      }
      const accepted: PendingFile[] = [];
      for (const file of incoming.slice(0, room)) {
        const invalid = validateAttachment(file);
        if (invalid) {
          setError(invalid);
          continue;
        }
        const pf: PendingFile = { id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`, file, key: null, status: 'uploading' };
        accepted.push(pf);
        void doUpload(pf);
      }
      if (incoming.length > room) setError(`You can attach up to ${MAX_MESSAGE_ATTACHMENTS} files per message.`);
      return [...prev, ...accepted];
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function doUpload(pf: PendingFile) {
    try {
      const key = await uploadAttachment(pf.file);
      setFiles((prev) => prev.map((f) => (f.id === pf.id ? { ...f, key, status: 'done' } : f)));
    } catch (e) {
      setFiles((prev) => prev.map((f) => (f.id === pf.id ? { ...f, status: 'error', error: errMessage(e) } : f)));
    }
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSend || sending || uploading) return;
    const trimmed = body.trim();
    const keys = files.filter((f) => f.status === 'done' && f.key).map((f) => f.key as string);
    if (!trimmed && keys.length === 0) return;

    setSending(true);
    setError(null);
    try {
      const d = await messagingApi.send(conversation.id, trimmed, keys);
      onSent(d);
      setBody('');
      setFiles([]);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSending(false);
    }
  }

  if (!canSend) {
    return (
      <div className="border-t border-slate-200 p-4">
        <Alert tone="neutral">{disabledReason}</Alert>
      </div>
    );
  }

  const overLength = body.length > MAX_MESSAGE_BODY_LENGTH;
  const nothingToSend = body.trim().length === 0 && files.filter((f) => f.status === 'done').length === 0;

  return (
    <form onSubmit={submit} className="border-t border-slate-200 p-3">
      {(error || inlineError) && (
        <Alert tone="error" className="mb-2">
          {error ?? inlineError}
        </Alert>
      )}

      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {files.map((f) => (
            <span
              key={f.id}
              className={`inline-flex max-w-[14rem] items-center gap-1.5 rounded-bmpl-md border px-2 py-1 text-xs ${
                f.status === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-600'
              }`}
            >
              {f.status === 'uploading' ? (
                <Spinner className="h-3 w-3" />
              ) : f.status === 'error' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden>
                  <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                </svg>
              ) : isImageMime(f.file.type) ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-3.5 w-3.5" aria-hidden>
                  <path d="M4 5h16v14H4z" />
                  <path d="m4 15 4-4 4 4 3-3 5 5" />
                  <circle cx="9" cy="9" r="1.5" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-3.5 w-3.5" aria-hidden>
                  <path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-6-6Z" />
                  <path d="M13 3v6h6" />
                </svg>
              )}
              <span className="min-w-0 flex-1 truncate">{f.file.name}</span>
              <button
                type="button"
                onClick={() => removeFile(f.id)}
                aria-label={`Remove ${f.file.name}`}
                className="inline-flex min-h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <label
          className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-bmpl-md border border-slate-300 text-slate-500 transition hover:border-belize-blue hover:text-belize-blue"
          title="Attach a file"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
            <path d="M21 12.5 12.5 21a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10.5 18a1.5 1.5 0 0 1-2-2l8-8" />
          </svg>
          <span className="sr-only">Attach a file</span>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            disabled={files.length >= MAX_MESSAGE_ATTACHMENTS}
            onChange={(e) => pickFiles(e.target.files)}
          />
        </label>

        <div className="min-w-0 flex-1">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={1}
            placeholder="Write a message…"
            aria-label="Message"
            className="max-h-40 min-h-[2.5rem] resize-y"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit(e as unknown as FormEvent);
              }
            }}
          />
        </div>

        <Button type="submit" disabled={sending || uploading || nothingToSend || overLength} className="h-10 shrink-0">
          {sending ? <Spinner className="h-4 w-4" /> : 'Send'}
        </Button>
      </div>
      <div className="mt-1 flex items-center justify-between px-1">
        <p className="text-[11px] text-slate-400">Press ⌘/Ctrl + Enter to send</p>
        {overLength && <p className="text-[11px] font-medium text-red-600">Message is too long ({body.length}/{MAX_MESSAGE_BODY_LENGTH}).</p>}
      </div>
    </form>
  );
}

/* ============================================================ support form */

function SupportForm({
  onCancel,
  onCreated,
  onBack,
}: {
  onCancel: () => void;
  onCreated: (d: ConversationDetail) => void;
  onBack: () => void;
}) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const d = await messagingApi.support({ subject: subject.trim(), message: message.trim() });
      onCreated(d);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-[60vh] flex-col">
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-belize-navy md:hidden"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <p className="text-sm font-semibold text-belize-navy">Contact support</p>
      </div>

      <form onSubmit={submit} className="space-y-4 p-5">
        <p className="text-sm text-slate-500">
          Tell us what you need help with and our support team will reply here.
        </p>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Subject" htmlFor="support-subject">
          <Input
            id="support-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Question about my order"
            required
          />
        </Field>
        <Field label="Message" htmlFor="support-message">
          <Textarea
            id="support-message"
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe your issue…"
            required
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || subject.trim().length === 0 || message.trim().length === 0}>
            {busy ? <Spinner className="h-4 w-4" /> : 'Send to support'}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

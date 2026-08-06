'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AVATAR_REJECTION_MESSAGES,
  AVATAR_REJECTION_REASON_CODES,
  type AvatarRejectionReason,
} from '@bmpl/shared';
import { api, type ApiError } from '../../../lib/api';
import { relativeTime } from '../../../lib/notifications';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Select, Spinner } from '../../../components/ui';
import { adminCrumbs } from '../../../lib/admin-nav';

/** One user's profile picture awaiting a decision (GET /admin/avatars). */
interface QueueItem {
  userId: string;
  email: string;
  name: string;
  /** Short-lived signed URL — the image itself is private until approved. */
  imageUrl: string | null;
  /** Face-detection confidence 0–100, or null when no provider ran. */
  faceScore: number | null;
  submittedAt: string;
  roles: string[];
  requiresAvatar: boolean;
}

/**
 * Profile-picture moderation queue.
 *
 * Only the UNCERTAIN cases land here. A picture with no face at all was already
 * refused at upload and the user was told why — so an empty queue is the normal,
 * healthy state, not a sign the check is off. When no vision provider is
 * configured every upload arrives here instead, and faceScore is null.
 */
export default function AvatarModerationPage() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await api.get<QueueItem[]>('/admin/avatars'));
    } catch (e) {
      const err = e as ApiError;
      setError(
        err.status === 403
          ? 'You do not have permission to moderate profile pictures.'
          : err.message || 'Could not load the queue.',
      );
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(userId: string, action: 'approve' | 'reject', reason?: AvatarRejectionReason) {
    setBusyId(userId);
    setError(null);
    try {
      await api.post(`/admin/avatars/${userId}/${action}`, action === 'reject' ? { reason } : undefined);
      // Drop the row locally rather than refetching — the queue is a work list and
      // a full reload would lose the reviewer's place in it.
      setItems((prev) => (prev ?? []).filter((i) => i.userId !== userId));
    } catch (e) {
      setError((e as ApiError).message || 'Could not record that decision.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Profile Photos"
        description="Pictures the automatic face check could not decide on. Approve a clear photo of one person's face; reject anything else with the reason the user will see."
        breadcrumbs={adminCrumbs('Profile Photos')}
      />

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      {items === null ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading queue…
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          description="Every uploaded profile picture has been decided. Pictures only appear here when the automatic check is unsure."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <QueueCard
              key={item.userId}
              item={item}
              busy={busyId === item.userId}
              onDecide={decide}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function QueueCard({
  item,
  busy,
  onDecide,
}: {
  item: QueueItem;
  busy: boolean;
  onDecide: (userId: string, action: 'approve' | 'reject', reason?: AvatarRejectionReason) => void;
}) {
  const [reason, setReason] = useState<AvatarRejectionReason>('NO_FACE');

  return (
    <li>
      <Card className="flex h-full flex-col gap-3 p-4">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt={`Profile picture submitted by ${item.name}`}
            className="aspect-square w-full rounded-bmpl-md border border-slate-200 bg-slate-50 object-cover"
          />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center rounded-bmpl-md border border-dashed border-slate-300 bg-slate-50 text-center text-xs text-slate-500">
            The image could not be loaded from storage.
          </div>
        )}

        <div className="min-w-0">
          <p className="truncate font-semibold text-belize-navy">{item.name}</p>
          <p className="truncate text-xs text-slate-500">{item.email}</p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {item.requiresAvatar && <Badge tone="warning">Photo required for role</Badge>}
          <Badge tone="neutral">
            {item.faceScore == null ? 'No automatic check' : `Face confidence ${item.faceScore}%`}
          </Badge>
          {item.roles.map((role) => (
            <Badge key={role} tone="neutral">
              {role.replace(/_/g, ' ')}
            </Badge>
          ))}
        </div>
        <p className="text-xs text-slate-400">Submitted {relativeTime(item.submittedAt)}</p>

        <div className="mt-auto space-y-2 pt-1">
          <Select
            aria-label={`Rejection reason for ${item.name}`}
            value={reason}
            onChange={(e) => setReason(e.target.value as AvatarRejectionReason)}
          >
            {AVATAR_REJECTION_REASON_CODES.map((code) => (
              <option key={code} value={code}>
                {REASON_LABELS[code]}
              </option>
            ))}
          </Select>
          {/* The exact wording the user receives — reviewers should see what they
              are actually sending before they send it. */}
          <p className="text-[11px] leading-snug text-slate-400">{AVATAR_REJECTION_MESSAGES[reason]}</p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              className="flex-1"
              disabled={busy}
              onClick={() => onDecide(item.userId, 'approve')}
            >
              Approve
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="flex-1"
              disabled={busy}
              onClick={() => onDecide(item.userId, 'reject', reason)}
            >
              Reject
            </Button>
          </div>
        </div>
      </Card>
    </li>
  );
}

const REASON_LABELS: Record<AvatarRejectionReason, string> = {
  NO_FACE: 'Not a photo of a person',
  MULTIPLE_FACES: 'More than one person',
  FACE_TOO_SMALL: 'Face too small / too far away',
  UNSAFE_CONTENT: 'Breaks community guidelines',
  ADMIN_REJECTED: 'Unsuitable (general)',
};

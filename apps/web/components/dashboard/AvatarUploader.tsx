'use client';

import { useRef, useState } from 'react';
import { AVATAR_MIME_ALLOWLIST, MAX_AVATAR_BYTES, type AvatarStatus } from '@bmpl/shared';
import { api, type ApiError } from '../../lib/api';
import type { MeView } from '../../lib/types';
import { Alert, Button, Card } from '../ui';
import { Avatar } from '../Avatar';

interface UploadResult {
  status: AvatarStatus;
  message: string;
  avatarUrl: string | null;
}

const ACCEPT = AVATAR_MIME_ALLOWLIST.join(',');

/**
 * Profile-picture panel: shows the live picture, takes a new one, and explains
 * exactly where the user stands afterwards.
 *
 * The rules are stated UP FRONT rather than only on failure. The face check
 * rejects photos people genuinely believe are fine — a logo, a group shot, a
 * holiday photo taken from across a beach — and "must be a clear photo of your
 * face, on your own" costs one line to say and saves the round trip.
 */
export function AvatarUploader({ me, onChange }: { me: MeView; onChange: (me: MeView) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const name = `${me.firstName} ${me.lastName}`;
  // The owner sees whichever picture is most current: a pending upload takes
  // visual priority so "under review" refers to something they can actually see.
  const shown = me.avatarPendingUrl ?? me.avatarUrl;

  async function upload(file: File) {
    setError(null);
    setNotice(null);

    // Mirror the server's limits so the obvious mistakes never cost an upload.
    if (!(AVATAR_MIME_ALLOWLIST as readonly string[]).includes(file.type)) {
      setError('Please choose a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError('That image is too large. Please use a photo under 5 MB.');
      return;
    }

    setBusy(true);
    try {
      const result = await api.upload<UploadResult>(
        `/me/avatar/upload?filename=${encodeURIComponent(file.name)}`,
        file,
      );
      setNotice(result.message);
      onChange(await api.get<MeView>('/me'));
    } catch (e) {
      // The face check reports its refusal as a 400 with a human-readable reason,
      // so showing the server's message verbatim is the right behaviour here.
      setError((e as ApiError).message || 'We couldn’t upload that image. Please try again.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      onChange(await api.del<MeView>('/me/avatar'));
      setNotice('Your profile picture was removed.');
    } catch (e) {
      setError((e as ApiError).message || 'Could not remove your picture.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start gap-5">
        <Avatar name={name} src={shown} size="xl" />

        <div className="min-w-[16rem] flex-1 space-y-3">
          <div>
            <h2 className="font-semibold text-belize-navy">Profile picture</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              A clear, well-lit photo of your face — just you, looking at the camera. Logos,
              products, pets and group photos are not accepted.
            </p>
          </div>

          <AvatarStatusNote me={me} />
          {error && <Alert tone="error">{error}</Alert>}
          {notice && !error && <Alert tone="success">{notice}</Alert>}

          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? 'Uploading…' : shown ? 'Change photo' : 'Upload photo'}
            </Button>
            {shown && (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={remove}>
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Where the user's picture currently stands, and what (if anything) to do next. */
function AvatarStatusNote({ me }: { me: MeView }) {
  if (me.avatarStatus === 'PENDING') {
    return (
      <Alert tone="info">
        Your photo is being reviewed. Until it’s approved, other people see your initials.
      </Alert>
    );
  }
  if (me.avatarStatus === 'REJECTED') {
    return <Alert tone="warning">{me.avatarRejectedReason}</Alert>;
  }
  if (me.avatarStatus === 'NONE' && me.avatarRequired) {
    return (
      <Alert tone="warning" title="A photo is required for your role">
        Customers meet you in person, so your account needs a verified photo of your face before
        your profile is complete.
      </Alert>
    );
  }
  return null;
}

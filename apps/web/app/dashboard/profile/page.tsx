'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import type { MeView } from '../../../lib/types';
import { ContactInfoForm } from '../../../components/account/ContactInfoForm';
import { AvatarUploader } from '../../../components/dashboard/AvatarUploader';
import { PageHeader, Spinner } from '../../../components/ui';

export default function ProfilePage() {
  const [me, setMe] = useState<MeView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<MeView>('/me').then(setMe).catch(() => setError('Unable to load your profile.'));
  }, []);

  if (!me) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        {!error && <Spinner className="h-4 w-4" />}
        {error ?? 'Loading profile…'}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Profile" />
      <AvatarUploader me={me} onChange={setMe} />
      <div className="mt-4">
        <ContactInfoForm me={me} onSaved={setMe} />
      </div>
    </div>
  );
}

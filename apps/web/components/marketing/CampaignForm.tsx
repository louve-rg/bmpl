'use client';

import { useState } from 'react';
import { CAMPAIGN_TYPES, CAMPAIGN_TYPE_LABELS, DEFAULT_MARKETING_TIMEZONE, type CampaignType } from '@bmpl/shared';
import type { CampaignDetail } from '../../lib/marketing';
import { Button, Field, Input, Select, Textarea } from '../ui';

export interface CampaignFormValues {
  name: string;
  description: string | null;
  type: CampaignType;
  timezone: string | null;
}

/** Create/edit a campaign's scalar fields. Emits the assembled values on submit. */
export function CampaignForm({
  initial,
  submitting,
  submitLabel = 'Save',
  onSubmit,
  footer,
}: {
  initial?: CampaignDetail;
  submitting?: boolean;
  submitLabel?: string;
  onSubmit: (values: CampaignFormValues) => void;
  footer?: React.ReactNode;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [type, setType] = useState<CampaignType>(initial?.type ?? 'FEATURED');
  const [timezone, setTimezone] = useState(initial?.timezone ?? DEFAULT_MARKETING_TIMEZONE);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      name: name.trim(),
      description: description.trim() || null,
      type,
      timezone: timezone.trim() || null,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Campaign name">
        <Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={160} />
      </Field>
      <Field label="Description (optional)">
        <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as CampaignType)}>
            {CAMPAIGN_TYPES.map((t) => (
              <option key={t} value={t}>
                {CAMPAIGN_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Timezone">
          <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} maxLength={64} />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={submitting || name.trim().length < 2}>
          {submitting ? 'Saving…' : submitLabel}
        </Button>
        {footer}
      </div>
    </form>
  );
}

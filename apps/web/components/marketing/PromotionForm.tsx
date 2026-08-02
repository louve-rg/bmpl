'use client';

import { useState } from 'react';
import { PROMOTION_TYPES, PROMOTION_TYPE_LABELS, type PromotionType } from '@bmpl/shared';
import { toLocalInput, type CampaignCard, type PromotionDetail } from '../../lib/marketing';
import { Button, Field, Input, Select, Textarea } from '../ui';

/** The scalar promotion details this form edits (shared by create + edit). */
export interface PromotionDetailsValues {
  type: PromotionType;
  title: string;
  subtitle: string | null;
  description: string | null;
  campaignId: string | null;
  priority: number;
  startAt: string | null;
  endAt: string | null;
}

/**
 * Promotion details form. On create the type is selectable; on edit it is read-only
 * (the API does not accept a type change). Converts the datetime-local window fields to
 * ISO on submit. Emits the assembled details; the parent decides create vs. PATCH.
 */
export function PromotionForm({
  initial,
  campaigns,
  includeType = false,
  submitting,
  submitLabel = 'Save',
  onSubmit,
  footer,
}: {
  initial?: PromotionDetail;
  campaigns: CampaignCard[];
  includeType?: boolean;
  submitting?: boolean;
  submitLabel?: string;
  onSubmit: (values: PromotionDetailsValues) => void;
  footer?: React.ReactNode;
}) {
  const [type, setType] = useState<PromotionType>(initial?.type ?? 'FEATURED_BUSINESS');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [subtitle, setSubtitle] = useState(initial?.subtitle ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [campaignId, setCampaignId] = useState(initial?.campaign?.id ?? '');
  const [priority, setPriority] = useState(String(initial?.priority ?? 0));
  const [startAt, setStartAt] = useState(toLocalInput(initial?.startAt));
  const [endAt, setEndAt] = useState(toLocalInput(initial?.endAt));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      type,
      title: title.trim(),
      subtitle: subtitle.trim() || null,
      description: description.trim() || null,
      campaignId: campaignId || null,
      priority: Number(priority) || 0,
      startAt: startAt ? new Date(startAt).toISOString() : null,
      endAt: endAt ? new Date(endAt).toISOString() : null,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Promotion type">
        {includeType ? (
          <Select value={type} onChange={(e) => setType(e.target.value as PromotionType)}>
            {PROMOTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROMOTION_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        ) : (
          <Input value={PROMOTION_TYPE_LABELS[type]} disabled readOnly />
        )}
      </Field>

      <Field label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} maxLength={160} />
      </Field>

      <Field label="Subtitle (optional)">
        <Input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} maxLength={200} />
      </Field>

      <Field label="Description (optional)">
        <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />
      </Field>

      <Field label="Campaign (optional)" hint="Group this promotion under one of your campaigns.">
        <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
          <option value="">No campaign</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Priority" hint="0–1000, higher shows first.">
          <Input type="number" min={0} max={1000} value={priority} onChange={(e) => setPriority(e.target.value)} />
        </Field>
        <Field label="Starts (optional)">
          <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
        </Field>
        <Field label="Ends (optional)">
          <Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={submitting || title.trim().length < 2}>
          {submitting ? 'Saving…' : submitLabel}
        </Button>
        {footer}
      </div>
    </form>
  );
}

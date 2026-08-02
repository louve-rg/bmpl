'use client';

import { useState } from 'react';
import { PROPERTY_DOCUMENT_KINDS, type PropertyDocumentKind } from '@bmpl/shared';
import { type ApiError } from '../../lib/api';
import {
  type ManagedProperty,
  type PropertyDocument,
  PROPERTY_DOCUMENT_KIND_LABELS,
  fmtDate,
  formatBytes,
} from '../../lib/realestate';
import { Alert, Badge, Button, Card, Field, Input, Select } from '../ui';

interface DocumentLister {
  uploadDocument: (
    id: string,
    file: File,
    kind: PropertyDocumentKind,
    label?: string,
  ) => Promise<ManagedProperty>;
  documentUrl: (id: string, documentId: string) => Promise<{ url: string }>;
}

/** Manage a listing's private documents: upload (presign→confirm), list, open signed URL. */
export function DocumentManager({
  lister,
  listing,
  onChanged,
}: {
  lister: DocumentLister;
  listing: ManagedProperty;
  onChanged: (updated: ManagedProperty) => void;
}) {
  const docs = listing.documents;
  const [kind, setKind] = useState<PropertyDocumentKind>('PROOF_OF_OWNERSHIP');
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const updated = await lister.uploadDocument(listing.id, file, kind, label.trim() || undefined);
      onChanged(updated);
      setFile(null);
      setLabel('');
    } catch (err) {
      setError((err as ApiError).message ?? 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function open(doc: PropertyDocument) {
    try {
      const { url } = await lister.documentUrl(listing.id, doc.id);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setError((err as ApiError).message ?? 'Could not open the document.');
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="bmpl-eyebrow">Documents</h2>
        <p className="text-xs text-slate-500">Private — only you and admins can access these.</p>
      </div>
      {error && <Alert tone="error">{error}</Alert>}

      <div className="space-y-2">
        {docs.length === 0 && <p className="text-sm text-slate-400">No documents uploaded.</p>}
        {docs.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-bmpl-md border border-slate-200 p-3">
            <div>
              <p className="text-sm font-medium text-belize-navy">
                {d.label || PROPERTY_DOCUMENT_KIND_LABELS[d.kind]}
              </p>
              <p className="text-xs text-slate-500">
                <Badge tone="neutral">{PROPERTY_DOCUMENT_KIND_LABELS[d.kind]}</Badge>{' '}
                {formatBytes(d.fileSizeBytes)} · {fmtDate(d.createdAt)}
              </p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => open(d)}>
              View
            </Button>
          </div>
        ))}
      </div>

      <form onSubmit={upload} className="space-y-3 border-t border-slate-100 pt-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Document kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value as PropertyDocumentKind)}>
              {PROPERTY_DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PROPERTY_DOCUMENT_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Label (optional)">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
        </div>
        <input
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp,image/heic"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-belize-blue/10 file:px-3 file:py-1.5 file:text-belize-blue"
        />
        <Button type="submit" size="sm" variant="outline" disabled={busy}>
          {busy ? 'Uploading…' : 'Upload document'}
        </Button>
      </form>
    </Card>
  );
}

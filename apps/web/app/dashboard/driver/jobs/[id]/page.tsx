'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, type ApiError } from '../../../../../lib/api';
import { uploadFile } from '../../../../../lib/uploads';
import {
  Card,
  PageHeader,
  Field,
  Input,
  Textarea,
  Label,
  Button,
  ButtonLink,
  Badge,
  StatusBadge,
  Alert,
  Spinner,
} from '../../../../../components/ui';
import { MessageButton } from '../../../../../components/messaging/MessageButton';

/* --------------------------------------------------------------- helpers */

/** Job is "active" — between acceptance and completion — so customer messaging makes sense. */
const ACTIVE_JOB_STATUSES = new Set(['DRIVER_ACCEPTED', 'PICKUP_CONFIRMED', 'IN_TRANSIT', 'ARRIVING']);

function errMessage(e: unknown): string {
  return (e as ApiError)?.message ?? 'Something went wrong.';
}
function errStatus(e: unknown): number | undefined {
  return (e as ApiError)?.status;
}
function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}
function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function districtLabel(d?: string | null): string {
  return d ? d.replace(/_/g, ' ') : '';
}

/* --------------------------------------------------------------- types */

interface Address {
  fullName?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  district?: string | null;
}
interface PickupLocation {
  label?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  district?: string | null;
}
interface JobItem {
  productTitle: string;
  variantTitle?: string | null;
  quantity: number;
}
interface Vehicle {
  type?: string | null;
  make?: string | null;
  model?: string | null;
  color?: string | null;
  licencePlate?: string | null;
}
interface TimelineEntry {
  label?: string;
  status?: string;
  at?: string | null;
  note?: string | null;
}
interface JobDetail {
  id: string;
  status: string;
  statusLabel: string;
  orderNumber: string;
  vendor: { businessName: string };
  feeMinor: number;
  estimate?: string | null;
  instructions?: string | null;
  deliveryAddress: Address;
  pickupLocation: PickupLocation;
  items: JobItem[];
  vehicle?: Vehicle | null;
  requiresPickupPin: boolean;
  requiresDeliveryPin: boolean;
  recipientName?: string | null;
  podPhotoUrls: string[];
  timeline: TimelineEntry[];
}

/* ----------------------------------------------------------------- page */

export default function DriverJobDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const d = await api.get<JobDetail>(`/driver/jobs/${id}`);
      setJob(d);
      setError(null);
      setNotFound(false);
    } catch (e) {
      if (errStatus(e) === 404) setNotFound(true);
      else setError(errMessage(e));
    }
  }

  useEffect(() => {
    setLoading(true);
    void reload().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title="Delivery" />
        <Alert tone="error" title="Job not found">
          This delivery job doesn&rsquo;t exist or is no longer assigned to you.
        </Alert>
        <ButtonLink href="/dashboard/driver/jobs" variant="outline" size="sm">
          Back to deliveries
        </ButtonLink>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title="Delivery" />
        {error && <Alert tone="error">{error}</Alert>}
        <ButtonLink href="/dashboard/driver/jobs" variant="outline" size="sm">
          Back to deliveries
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/dashboard/driver/jobs" className="text-sm font-medium text-belize-blue hover:underline">
          &larr; Back to deliveries
        </Link>
      </div>

      <PageHeader
        title={`Order #${job.orderNumber}`}
        description={job.vendor?.businessName}
        actions={
          <>
            {ACTIVE_JOB_STATUSES.has(job.status) && (
              <MessageButton kind="delivery" id={job.id} with="customer" />
            )}
            <StatusBadge status={job.status} />
          </>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      <ActionPanel job={job} onDone={reload} />

      <Card className="p-5 sm:p-6">
        <h2 className="bmpl-eyebrow mb-3">Pickup location</h2>
        <PickupBlock pickup={job.pickupLocation} />
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="bmpl-eyebrow mb-3">Delivery address</h2>
        <AddressBlock address={job.deliveryAddress} />
      </Card>

      <Card className="p-5 sm:p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="bmpl-eyebrow">Items</h2>
          <span className="text-sm font-semibold text-belize-navy">Fee {money(job.feeMinor)}</span>
        </div>
        {job.items.length === 0 ? (
          <p className="text-sm text-slate-500">No items listed.</p>
        ) : (
          <ul className="space-y-2">
            {job.items.map((it, i) => (
              <li key={i} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-belize-navy">{it.productTitle}</p>
                  {it.variantTitle && <p className="text-xs text-slate-500">{it.variantTitle}</p>}
                </div>
                <span className="shrink-0 text-sm text-slate-600">×{it.quantity}</span>
              </li>
            ))}
          </ul>
        )}
        {job.estimate && <p className="mt-3 text-xs text-slate-400">Estimate: {job.estimate}</p>}
      </Card>

      {job.instructions && (
        <Card className="p-5 sm:p-6">
          <h2 className="bmpl-eyebrow mb-2">Delivery instructions</h2>
          <p className="text-sm text-slate-600">{job.instructions}</p>
        </Card>
      )}

      {job.vehicle && (job.vehicle.make || job.vehicle.model || job.vehicle.licencePlate) && (
        <Card className="p-5 sm:p-6">
          <h2 className="bmpl-eyebrow mb-3">Assigned vehicle</h2>
          <VehicleBlock vehicle={job.vehicle} />
        </Card>
      )}

      <Card className="p-5 sm:p-6">
        <h2 className="bmpl-eyebrow mb-3">Timeline</h2>
        <Timeline entries={job.timeline} />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- sub-blocks */

function PickupBlock({ pickup }: { pickup: PickupLocation }) {
  return (
    <div className="text-sm text-slate-600">
      {pickup.label && <p className="font-semibold text-belize-navy">{pickup.label}</p>}
      {pickup.addressLine1 && <p>{pickup.addressLine1}</p>}
      {pickup.addressLine2 && <p>{pickup.addressLine2}</p>}
      <p>
        {[pickup.city, districtLabel(pickup.district)].filter(Boolean).join(', ')}
      </p>
    </div>
  );
}

function AddressBlock({ address }: { address: Address }) {
  return (
    <div className="text-sm text-slate-600">
      {address.fullName && <p className="font-semibold text-belize-navy">{address.fullName}</p>}
      {address.phone && (
        <p>
          <a href={`tel:${address.phone}`} className="text-belize-blue hover:underline">
            {address.phone}
          </a>
        </p>
      )}
      {address.addressLine1 && <p>{address.addressLine1}</p>}
      {address.addressLine2 && <p>{address.addressLine2}</p>}
      <p>{[address.city, districtLabel(address.district)].filter(Boolean).join(', ')}</p>
    </div>
  );
}

function VehicleBlock({ vehicle }: { vehicle: Vehicle }) {
  const parts = [vehicle.color, vehicle.make, vehicle.model].filter(Boolean).join(' ');
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
      {vehicle.type && <Badge tone="brand">{vehicle.type}</Badge>}
      {parts && <span className="font-medium text-belize-navy">{parts}</span>}
      {vehicle.licencePlate && <Badge tone="neutral">Plate: {vehicle.licencePlate}</Badge>}
    </div>
  );
}

function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (!entries || entries.length === 0) {
    return <p className="text-sm text-slate-500">No activity yet.</p>;
  }
  return (
    <ol className="space-y-3">
      {entries.map((e, i) => (
        <li key={i} className="flex gap-3">
          <div className="mt-1 flex flex-col items-center">
            <span className="h-2 w-2 rounded-full bg-belize-blue" aria-hidden />
            {i < entries.length - 1 && <span className="mt-1 w-px flex-1 bg-slate-200" aria-hidden />}
          </div>
          <div className="pb-1">
            <p className="text-sm font-medium text-belize-navy">{e.label ?? (e.status ? e.status.replace(/_/g, ' ') : 'Update')}</p>
            {e.at && <p className="text-xs text-slate-400">{formatDate(e.at)}</p>}
            {e.note && <p className="mt-0.5 text-sm text-slate-500">{e.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ----------------------------------------------------------- action panel */

function ActionPanel({ job, onDone }: { job: JobDetail; onDone: () => Promise<void> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const errAlert = err && (
    <Alert tone="error" className="mb-4">
      {err}
    </Alert>
  );

  switch (job.status) {
    case 'ASSIGNED':
      return (
        <Card className="p-5 sm:p-6">
          <h2 className="bmpl-eyebrow mb-2">New delivery request</h2>
          <p className="mb-4 text-sm text-slate-600">Accept this job to start the delivery, or decline it with a reason.</p>
          {errAlert}
          <AssignedActions job={job} busy={busy} setBusy={setBusy} setErr={setErr} onDone={onDone} router={router} />
        </Card>
      );

    case 'DRIVER_ACCEPTED':
      return (
        <Card className="p-5 sm:p-6">
          <h2 className="bmpl-eyebrow mb-2">Confirm pickup</h2>
          <p className="mb-4 text-sm text-slate-600">Enter the pickup PIN the vendor gives you at hand-off.</p>
          {errAlert}
          <PinAction
            label="Confirm pickup"
            pinLabel="Pickup PIN"
            busy={busy}
            onSubmit={(pin) => run(async () => {
              await api.post(`/driver/jobs/${job.id}/confirm-pickup`, { pin });
              await onDone();
            })}
          />
        </Card>
      );

    case 'PICKUP_CONFIRMED':
      return (
        <Card className="p-5 sm:p-6">
          <h2 className="bmpl-eyebrow mb-2">On the way</h2>
          <p className="mb-4 text-sm text-slate-600">Start the delivery once you&rsquo;re heading to the customer.</p>
          {errAlert}
          <Button
            disabled={busy}
            onClick={() => run(async () => {
              await api.post(`/driver/jobs/${job.id}/in-transit`);
              await onDone();
            })}
          >
            {busy ? <Spinner className="h-4 w-4" /> : 'Start delivery (on the way)'}
          </Button>
        </Card>
      );

    case 'IN_TRANSIT':
      return (
        <Card className="p-5 sm:p-6">
          <h2 className="bmpl-eyebrow mb-2">In transit</h2>
          <p className="mb-4 text-sm text-slate-600">Let the customer know you&rsquo;re almost there.</p>
          {errAlert}
          <Button
            disabled={busy}
            onClick={() => run(async () => {
              await api.post(`/driver/jobs/${job.id}/arriving`);
              await onDone();
            })}
          >
            {busy ? <Spinner className="h-4 w-4" /> : 'Mark arriving'}
          </Button>
        </Card>
      );

    case 'ARRIVING':
      return (
        <Card className="p-5 sm:p-6">
          <h2 className="bmpl-eyebrow mb-2">Complete delivery</h2>
          <p className="mb-4 text-sm text-slate-600">Enter the delivery PIN the recipient gives you and confirm the drop-off.</p>
          {errAlert}
          <CompleteDeliveryForm job={job} busy={busy} setBusy={setBusy} setErr={setErr} onDone={onDone} />
        </Card>
      );

    case 'DELIVERED':
      return (
        <Card className="p-5 sm:p-6">
          <h2 className="bmpl-eyebrow mb-3">Delivery completed</h2>
          <Alert tone="success" className="mb-4">
            This delivery is complete.
          </Alert>
          {job.recipientName && (
            <p className="text-sm text-slate-600">
              Received by <b className="text-belize-navy">{job.recipientName}</b>
            </p>
          )}
          {job.podPhotoUrls.length > 0 && (
            <div className="mt-3">
              <Label>Proof of delivery</Label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {job.podPhotoUrls.map((u, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={u} alt="Proof of delivery" className="h-20 w-20 rounded-bmpl-md border border-slate-200 object-cover" />
                ))}
              </div>
            </div>
          )}
        </Card>
      );

    default:
      return null;
  }
}

/* ------------------------------------------------------ assigned actions */

function AssignedActions({
  job,
  busy,
  setBusy,
  setErr,
  onDone,
  router,
}: {
  job: JobDetail;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setErr: (m: string | null) => void;
  onDone: () => Promise<void>;
  router: ReturnType<typeof useRouter>;
}) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');

  async function accept() {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/driver/jobs/${job.id}/accept`);
      await onDone();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function decline(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/driver/jobs/${job.id}/decline`, { reason });
      router.push('/dashboard/driver/jobs');
    } catch (err) {
      setErr(errMessage(err));
      setBusy(false);
    }
  }

  if (declining) {
    return (
      <form onSubmit={decline} className="space-y-3">
        <Field label="Reason for declining" htmlFor="decline-reason">
          <Textarea
            id="decline-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Let us know why you can't take this delivery."
            required
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="destructive" disabled={busy || reason.trim().length === 0}>
            {busy ? <Spinner className="h-4 w-4" /> : 'Submit decline'}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setDeclining(false)}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy} onClick={accept}>
        {busy ? <Spinner className="h-4 w-4" /> : 'Accept'}
      </Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => setDeclining(true)}>
        Decline
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------- pin action */

function PinAction({
  label,
  pinLabel,
  busy,
  onSubmit,
}: {
  label: string;
  pinLabel: string;
  busy: boolean;
  onSubmit: (pin: string) => void;
}) {
  const [pin, setPin] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit(pin.trim());
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label={pinLabel} htmlFor="pin-input">
        <Input
          id="pin-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="Enter code"
          required
        />
      </Field>
      <Button type="submit" disabled={busy || pin.trim().length === 0}>
        {busy ? <Spinner className="h-4 w-4" /> : label}
      </Button>
    </form>
  );
}

/* --------------------------------------------------- complete delivery form */

function CompleteDeliveryForm({
  job,
  busy,
  setBusy,
  setErr,
  onDone,
}: {
  job: JobDetail;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setErr: (m: string | null) => void;
  onDone: () => Promise<void>;
}) {
  const [pin, setPin] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [notes, setNotes] = useState('');
  const [photoKeys, setPhotoKeys] = useState<string[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);

  async function addPhoto(file: File) {
    setPhotoBusy(true);
    setErr(null);
    try {
      const key = await uploadFile(`/driver/jobs/${job.id}/pod/upload`, file);
      setPhotoKeys((k) => [...k, key]);
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/driver/jobs/${job.id}/confirm-delivery`, {
        pin: pin.trim(),
        recipientName: recipientName.trim(),
        notes: notes.trim() || undefined,
        podPhotoKeys: photoKeys.length > 0 ? photoKeys : undefined,
      });
      await onDone();
    } catch (err) {
      setErr(errMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Delivery PIN" htmlFor="delivery-pin" hint="The recipient gives you this code.">
        <Input
          id="delivery-pin"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="Enter code"
          required
        />
      </Field>

      <Field label="Recipient name" htmlFor="recipient-name">
        <Input
          id="recipient-name"
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
          placeholder="Who received the delivery?"
          required
        />
      </Field>

      <Field label="Notes" htmlFor="delivery-notes" hint="Optional">
        <Textarea id="delivery-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <div>
        <Label>Proof of delivery photo</Label>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {photoKeys.map((k) => (
            <Badge key={k} tone="success">
              Photo added
            </Badge>
          ))}
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-belize-navy transition hover:border-belize-blue hover:bg-belize-blue/5">
            {photoBusy ? <Spinner className="h-4 w-4" /> : 'Add photo'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={photoBusy}
              onChange={(e) => e.target.files?.[0] && addPhoto(e.target.files[0])}
            />
          </label>
        </div>
        <p className="mt-1 text-xs text-slate-400">Optional</p>
      </div>

      <Button type="submit" disabled={busy || photoBusy || pin.trim().length === 0 || recipientName.trim().length === 0}>
        {busy ? <Spinner className="h-4 w-4" /> : 'Complete delivery'}
      </Button>
    </form>
  );
}

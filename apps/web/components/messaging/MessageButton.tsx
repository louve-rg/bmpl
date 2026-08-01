'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { messagingApi } from '../../lib/messaging';
import { Button, Spinner } from '../ui';
import type { ApiError } from '../../lib/api';
import type { ComponentProps } from 'react';

type Variant = ComponentProps<typeof Button>['variant'];
type Size = ComponentProps<typeof Button>['size'];

type Props =
  | { kind: 'vendor-order'; id: string; with?: never; label?: string; variant?: Variant; size?: Size; className?: string }
  | { kind: 'delivery'; id: string; with: 'customer' | 'vendor'; label?: string; variant?: Variant; size?: Size; className?: string };

/**
 * Opens (or returns) the context conversation for an order/delivery, then
 * navigates to the messages center with the thread preselected.
 */
export function MessageButton(props: Props) {
  const { kind, id, label, variant = 'outline', size = 'sm', className } = props;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const conversation =
        kind === 'vendor-order'
          ? await messagingApi.openVendorOrder(id)
          : await messagingApi.openDelivery(id, props.with);
      router.push(`/dashboard/messages?c=${conversation.id}`);
    } catch (e) {
      setError((e as ApiError)?.message ?? 'Couldn’t open the conversation.');
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button type="button" variant={variant} size={size} disabled={busy} onClick={open} className={className}>
        {busy ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
            <path d="M4 5h16v10H7l-3 3V5Z" />
          </svg>
        )}
        {label ?? (kind === 'vendor-order' ? 'Message vendor' : 'Message customer')}
      </Button>
      {error && <span className="text-xs font-medium text-red-600">{error}</span>}
    </span>
  );
}

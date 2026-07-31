'use client';

import { useEffect, useState } from 'react';
import {
  deliveriesApi,
  isDelivered,
  type DeliveryProof,
  type VendorDeliveryDetail,
} from '../lib/deliveries';
import type { ApiError } from '../lib/api';
import {
  DeliveryStepper,
  DeliveryEventLog,
  DriverCard,
  ProofOfDelivery,
} from './DeliveryTracker';
import { Alert, Button, Card, Spinner, StatusBadge } from './ui';

/* -------------------------------------------------- vendor pickup PIN reveal */

function PickupCodeReveal({ deliveryId }: { deliveryId: string }) {
  const [pin, setPin] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function reveal() {
    setBusy(true);
    setErr(null);
    try {
      const res = await deliveriesApi.vendorPickupPin(deliveryId);
      if (res.verificationStatus === 'VERIFIED') {
        setVerified(true);
        setPin(null);
      } else {
        setPin(res.pickupPin);
      }
    } catch {
      setErr('Could not load the pickup code.');
    } finally {
      setBusy(false);
    }
  }

  if (verified) {
    return <p className="text-xs font-medium text-emerald-700">Pickup code verified.</p>;
  }

  return (
    <div>
      {pin ? (
        <div>
          <p className="font-mono text-2xl font-bold tracking-[0.3em] text-belize-navy">{pin}</p>
          <p className="mt-1 text-xs text-slate-500">Give this code to the driver at pickup.</p>
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={reveal} disabled={busy}>
          {busy ? 'Loading…' : 'Show pickup code'}
        </Button>
      )}
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  );
}

/* --------------------------------------------------------------- main panel */

export function VendorDeliveryPanel({ deliveryId }: { deliveryId: string }) {
  const [data, setData] = useState<VendorDeliveryDetail | null>(null);
  const [proof, setProof] = useState<DeliveryProof | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    deliveriesApi
      .vendorGet(deliveryId)
      .then((d) => {
        if (!active) return;
        setData(d);
        setState('ready');
        if (isDelivered(d.status)) {
          deliveriesApi
            .vendorProof(deliveryId)
            .then((p) => active && setProof(p))
            .catch(() => active && setProof(null));
        }
      })
      .catch((e) => {
        if (!active) return;
        setState((e as ApiError).status === 404 ? 'ready' : 'error');
      });
    return () => {
      active = false;
    };
  }, [deliveryId]);

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="bmpl-label">Delivery progress</p>
        {data && <StatusBadge status={data.status} />}
      </div>

      {state === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading delivery…
        </div>
      )}
      {state === 'error' && <Alert tone="warning">Couldn’t load delivery progress right now.</Alert>}

      {state === 'ready' && data && (
        <div className="space-y-4">
          <p className="text-sm font-medium text-belize-navy">{data.statusLabel}</p>

          <DriverCard driver={data.driver} vehicle={data.vehicle} />

          <DeliveryStepper status={data.status} timeline={data.timeline} />

          {data.pickupVerificationStatus !== 'VERIFIED' && !isDelivered(data.status) && (
            <PickupCodeReveal deliveryId={deliveryId} />
          )}
          {data.pickupVerificationStatus === 'VERIFIED' && (
            <p className="text-xs font-medium text-emerald-700">Pickup code verified.</p>
          )}

          {proof && <ProofOfDelivery proof={proof} />}

          <DeliveryEventLog timeline={data.timeline} />
        </div>
      )}
    </Card>
  );
}

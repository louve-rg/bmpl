'use client';

import { useEffect, useState } from 'react';
import { shippingApi, type RoutingProposal, type RoutingProposalOutcome } from '../../lib/shipping';
import { canPrice, confirmLabel, priceUnavailableMessage, proposalHeadline } from '../../lib/routing-proposal';
import { Alert, Button, Spinner } from '../ui';
import type { ApiError } from '../../lib/api';

/**
 * BMPL-364/375: the paying customer's own confirmation of a return or
 * reroute staff has PREPARED for this shipment. Staff action alone never
 * charges anyone (owner ruling) — this is the surface that replaces the old
 * staff-side "confirm and charge" the admin panel used to be (BMPL-343's
 * original design, corrected). Nothing here is shown unless there is
 * genuinely something pending: a 404 from the read means business as usual
 * for almost every shipment, never an error.
 *
 * THE OWNER'S ACCEPTANCE TEST, read literally: calculate a legitimate
 * configured price; SHOW THE PRICE TO THE PAYING CUSTOMER; obtain EXPLICIT
 * confirmation; only then execute. So the price shown here is stated
 * honestly as informational — recomputed fresh server-side at read time,
 * and recomputed fresh AGAIN at confirm time, never trusted as locked in.
 * If the confirmed amount differs from what was shown, THAT IS NOT AN ERROR
 * — it is never diffed or flagged as a surprise here, only shown plainly as
 * what was actually charged.
 *
 * A prepared-but-unconfirmed proposal must never read as charged, paid,
 * escrowed or reserved: this component says "staff proposed this" in its
 * own words, never "your return is being processed."
 */
export function RoutingProposalConfirm({ shipmentId, onConfirmed }: { shipmentId: string; onConfirmed: () => Promise<void> }) {
  const [loading, setLoading] = useState(true);
  const [proposal, setProposal] = useState<RoutingProposal | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RoutingProposalOutcome | null>(null);

  useEffect(() => {
    let cancelled = false;
    shippingApi
      .routingProposal(shipmentId)
      .then((p) => {
        if (!cancelled) setProposal(p);
      })
      .catch((e) => {
        if (cancelled) return;
        // 404 is the ordinary case — nothing pending — not an error to show.
        if ((e as ApiError).status !== 404) setLoadErr((e as ApiError).message ?? 'We could not check for a pending confirmation.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shipmentId]);

  async function confirm() {
    setConfirming(true);
    setConfirmErr(null);
    try {
      const result = await shippingApi.confirmRoutingProposal(shipmentId);
      setOutcome(result);
      await onConfirmed();
    } catch (e) {
      setConfirmErr((e as ApiError).message ?? 'We could not confirm this just now.');
    } finally {
      setConfirming(false);
    }
  }

  if (loading) return null;
  if (loadErr) {
    return (
      <Alert tone="warning" className="mt-4">
        {loadErr}
      </Alert>
    );
  }

  if (outcome) {
    const shipment = outcome.outcome === 'INITIATED' ? (outcome.returnShipment ?? outcome.rerouteShipment) : null;
    return (
      <Alert tone={outcome.outcome === 'INITIATED' ? 'success' : 'warning'} title={outcome.outcome === 'INITIATED' ? 'Confirmed' : 'We could not price this'} className="mt-4">
        {outcome.outcome === 'INITIATED' && shipment ? (
          <>
            Booked as {shipment.reference} — charged ${(shipment.quotedTotalMinor / 100).toFixed(2)}.
          </>
        ) : outcome.outcome === 'PENDING_MANUAL' ? (
          <>{outcome.reason} Nothing was charged. Our operations team will follow up with you directly.</>
        ) : null}
      </Alert>
    );
  }

  if (!proposal) return null;

  const priced = canPrice(proposal);

  return (
    <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5">
      <h2 className="text-sm font-semibold text-slate-900">{proposalHeadline(proposal)}</h2>
      <p className="mt-1 text-sm text-slate-600">
        Our team has proposed this. Nothing happens, and nothing is charged, until you confirm below.
      </p>

      {proposal.note && <p className="mt-2 text-sm text-slate-500">&ldquo;{proposal.note}&rdquo;</p>}

      {proposal.kind === 'REROUTE' && proposal.destination && (
        <p className="mt-2 text-sm text-slate-700">
          New address: {[proposal.destination.name, proposal.destination.address, proposal.destination.city, proposal.destination.district]
            .filter(Boolean)
            .join(', ')}
        </p>
      )}

      {priced ? (
        <p className="mt-3 text-sm text-slate-700">
          This will cost{' '}
          <span className="font-semibold tabular-nums">
            ${((proposal.available ? proposal.totalMinor : 0) / 100).toFixed(2)}
          </span>{' '}
          —
          BML&rsquo;s normal pricing for this route, recalculated when you confirm so the amount you pay is always current.
          {proposal.kind === 'REROUTE' &&
            (proposal.legCostsMoreThanOriginal
              ? ' This is more than you already paid.'
              : ' This does not change what you already paid.')}
        </p>
      ) : (
        <Alert tone="warning" className="mt-3">
          We could not calculate a price for this — {priceUnavailableMessage(proposal)} Contact support rather than waiting on
          this screen.
        </Alert>
      )}

      {confirmErr && (
        <Alert tone="warning" className="mt-3">
          {confirmErr}
        </Alert>
      )}

      {priced && (
        <Button onClick={() => void confirm()} disabled={confirming} className="mt-4 min-h-[48px] w-full sm:w-auto">
          {confirming ? 'Confirming…' : confirmLabel(proposal)}
        </Button>
      )}
    </div>
  );
}

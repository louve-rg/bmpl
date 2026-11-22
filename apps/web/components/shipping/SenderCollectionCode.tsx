/**
 * REL-CODE-UNREACHABLE-NO-CONTACT: the sender's own copy of the collection
 * code — rendered only while it exists (`ShipmentView.collectionCode` is
 * non-null; see that field's own doc). Same "sender is the messenger"
 * reasoning as `ShareTrackingLink` on this same page: BML has no channel to
 * a recipient the sender never gave an email or phone for, so the one way
 * that recipient learns the code at all is the sender reading it here and
 * passing it on themselves.
 *
 * Deliberately NOT a request/reveal flow like `UnlinkedCollectionCode` —
 * that component exists for an anonymous link-holder BML must not trust by
 * identity alone. The sender is already authenticated as the shipment's
 * owner by the time this renders, so showing the value directly is not a
 * new exposure; it is the one existing, authorized reader of this value
 * finally being shown it.
 *
 * MDF-926: `code` and `holdMessage` are the two faces of the same fact —
 * `ShipmentView.collectionHoldMessage` is non-null in EXACTLY the case
 * `collectionCode` just went null for (the PIN locked out after 5 wrong
 * attempts), never any of the field's other null cases (not yet
 * AWAITING_COLLECTION, already collected, grandfathered). Before this,
 * a locked-out sender's code simply vanished from this slot with nothing
 * in its place — the dead-end control the owner ruled out. Rendering the
 * message here, in the code's own spot, is the fix.
 */
export function SenderCollectionCode({ code, holdMessage }: { code: string | null; holdMessage?: string | null }) {
  if (!code && !holdMessage) return null;
  return (
    <div data-theme="light" className="mt-4 rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5">
      <h2 className="text-sm font-semibold text-slate-900">Collection code</h2>
      {code ? (
        <>
          <p className="mt-1 text-sm text-slate-600">
            Whoever is collecting this parcel will need this code — pass it on to them.
          </p>
          <p className="mt-3 text-center text-3xl font-bold tracking-[0.3em] text-belize-navy">{code}</p>
        </>
      ) : (
        <p className="mt-1 text-sm text-slate-600">{holdMessage}</p>
      )}
    </div>
  );
}

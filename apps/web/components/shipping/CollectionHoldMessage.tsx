/**
 * MDF-942: `collectionHoldMessage` (MDF-926) already tells a locked-out
 * reader to "contact support", but until now gave them no way to do it —
 * the sentence had no link in it, on all three collection-code readers
 * (`SenderCollectionCode`, `RecipientCollectionCode`, `UnlinkedCollectionCode`).
 *
 * Reuses the ONE existing support address already in the site footer
 * (`Footer.tsx`) and on `DeliveryTracker.tsx` — no second address, no new
 * support route, form or ticket flow. Turns the words already in the
 * server's own message into the link, rather than adding new copy next to
 * it, so a future change to that message's wording still gets a link
 * wherever "contact support" appears.
 *
 * The match is case-sensitive-safe but assumes the phrase is present —
 * every known caller of this message (`COLLECTION_LOCKED_CUSTOMER_MESSAGE`
 * in `apps/api/src/shipping/shipment.service.ts`) ends with exactly
 * "contact support.". If a future message variant omits the phrase, this
 * degrades to rendering the plain sentence with no link, never a crash.
 */
const SUPPORT_HREF = 'mailto:support@bzemarketplace.com?subject=Collection%20code%20locked';
const MARKER = 'contact support';

export function CollectionHoldMessageText({ message }: { message: string }) {
  const i = message.toLowerCase().indexOf(MARKER);
  if (i === -1) return <>{message}</>;

  const before = message.slice(0, i);
  const phrase = message.slice(i, i + MARKER.length);
  const after = message.slice(i + MARKER.length);

  return (
    <>
      {before}
      <a href={SUPPORT_HREF} className="font-medium text-belize-blue hover:underline">
        {phrase}
      </a>
      {after}
    </>
  );
}

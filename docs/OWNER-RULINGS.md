# Owner rulings — standing decisions with no open card

On 2026-09-28 the product owner gave twelve rulings in one sitting to clear a
backlog of decision requests. Eight answered a specific open card directly and
were propagated into that card, and from there into code or other docs as
each required. **The four below answered no open ask.** Until now they
existed only as notes on kanban card BMPL-331 — a decision record stored
where nobody working in the code will ever look. This document is that
record, moved to where it can be found.

This document states each ruling in the owner's own terms and says which
cards it has already settled. It is a record of decisions already made, not
guidance drafted for a hypothetical case — check here before re-asking the
owner a question one of these already answers.

**The owner's own boundary, stated explicitly, binds all twelve rulings:**
none of them extends to pricing, payment, legal, moderation or
marketplace-return policy. Where a card raises a genuinely new business rule
in one of those areas, that specific question stays open. This document
records what was decided; it is not a device for deciding anything further,
and reading it more broadly than it says is exactly the mistake it exists to
prevent.

## Ruling 12 — a tracking token proves possession, not identity

*The load-bearing ruling — a principle, not a single case.*

> A tracking token or link proves possession of a link. It is not
> automatically proof of identity or authorization. Exact addresses, private
> photos, handoff codes/PINs, personal courier data and other sensitive
> operational details require the appropriate authenticated and authorized
> relationship.

Already settled, by this ruling alone:

- **BMPL-119, question 2** ("may a door PIN ever travel on a public tracking
  link?") — closed. The code already never puts a PIN on a public link; this
  ruling confirms that behavior as policy rather than requiring a change.
- **BMPL-179** (recipient account linking) — eliminated one of three proposed
  claim policies. "Accept it: first authenticated claimant wins, the link is
  already trusted" is the exact position this ruling rejects, since claiming
  is itself an authorization-granting act keyed on nothing but possession of
  the link. The choice between the two remaining options is still the
  owner's and is still open.

## Ruling 7 — who can see a pickup/handoff photo

A pickup or handoff photo may be visible to:

- the sender,
- authorized courier/provider staff, as operationally necessary, and
- an authenticated recipient who has been legitimately linked to, or has
  claimed, that shipment.

Possession of an anonymous public tracking link does not by itself authorize
access to photos or any other sensitive shipment detail.

## Ruling 8 — saved addresses

Reuse the existing `SavedAddress` foundation. Do not create a second address
system. It must support customer labels (Home, Work, Mom), a
preferred/default address, selection during checkout/shipping, and edit and
removal. Deleting a saved address must not alter historical shipment/order
snapshots.

## Ruling 11 — recipient availability and ETA changes

Recipients may provide or update an availability window and, where policy
permits, a delivery location, before final delivery. A multi-leg ETA must
derive from actually configured schedules, operating hours, exceptions and
known shipment state — never a fabricated timetable. Notify affected users
when the ETA changes materially, using the already-established 30-minute
threshold as the initial default — configurable, not permanently hard-coded
as business policy. Any reroute that increases the customer's charge must
show the new cost and require confirmation before any charge occurs.

---

## Risk accepted, with a trigger

These are risks the owner has explicitly accepted for now, each with a
stated condition that ends the acceptance. Recorded here for the same reason
as the rulings above: a hold whose trigger nothing is watching is
indistinguishable from a forgotten card.

### BMPL-146 — malware scanning on Belize Connect resume uploads

Resume files are not scanned for malware; `scanStatus` defaults to `PENDING`
and nothing changes it. On 2026-09-22 the owner accepted this risk for now:
existing file-type, size, authorization and owner-scoped access controls
stay in place, and nobody proposes a scanner until the owner approves a
(paid) scanning service.

**Trigger: this must be closed before public launch, and must not be
quietly dropped.** It does not block other Belize Connect work today.
Re-verified still open and still correct on 2026-09-28 — whoever opens the
public-launch checklist should find this card named on it.

---

*Source: kanban card BMPL-331, recorded 2026-09-28. If a ruling above and a
dependent card's own notes ever disagree, check BMPL-331 for the owner's
exact words before trusting either restatement — including this one.*

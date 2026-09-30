# Owner rulings — standing decisions, in one place

On 2026-09-28 the product owner gave twelve rulings in one sitting to clear a
backlog of decision requests. Eight answered a specific open card directly;
until now they lived only in that card's own notes — "propagated into the
card it answered" felt sufficient at the time and was not. Four answered no
open ask at all and existed only as notes on kanban card BMPL-331. Both kinds
are the same failure in different amounts: **a decision stored only in a
kanban card is a decision nobody working in the code will ever find.**
Ruling 10 is the case that forced the fix — it is now load-bearing in code
comments, in other cards, and in two shipped features, and it lived nowhere
a reader of those could follow it back to. This document is all twelve, in
one place, numbered as the owner numbers them.

This document states each ruling in the owner's own terms, says which card
(if any) it answered, and says what it has settled since — a record of
decisions already made, not guidance drafted for a hypothetical case. Check
here before re-asking the owner a question one of these already answers.
Where a ruling answered a specific card, the wording below was taken from
that card's own notes, not from a summary of them.

**The owner's own boundary, stated explicitly, binds all twelve rulings:**
none of them extends to pricing, payment, legal, moderation or
marketplace-return policy. Where a card raises a genuinely new business rule
in one of those areas, that specific question stays open. This document
records what was decided; it is not a device for deciding anything further,
and reading any one ruling more broadly than it says is exactly the mistake
this document exists to prevent.

## Ruling 1 — a courier accepting a job is not custody

Disposition for a leg that becomes stuck or exceptional **after custody has
already transferred**: hold at a hub, enter an exception state, notify both
the sender and the recipient, offer the authorized party an action menu, and
treat any post-custody return as a **new** transport charge that must be
shown and confirmed before it is charged — never a silent reversal of the
original charge.

**Explicitly not settled by this ruling**, and re-asked rather than
inferred: who pays for a leg interrupted mid-carry, and what the customer is
owed when staff cancel a partially-completed journey. Scope fence: non-vendor
courier shipments only; this ruling authorizes no wallet mutation.

Answered **BMPL-109** (the disposition half of its question 1) and
**BMPL-183**, confirming the custody boundary the ruling describes already
matches shipped code — `ShipmentService.cancel()` blocks once a leg reaches
`IN_PROGRESS` (set only by `startLeg`, which appends custody in the same
call), not on acceptance or assignment. Still open on BMPL-183: who may
initiate a return (staff-mediated or sender-direct) and the return-leg
price — both genuinely new decisions this ruling didn't reach.

## Ruling 2 — least privilege: a broad permission must not carry access nothing at that scope needs

No card records a single standalone statement of this ruling — only its
application, in two places from the same review pass:

- **BMPL-247**: a courier's private, application-time phone number was
  reachable by any holder of `logistics.read`, a platform-wide permission
  with no hub or region scope. The ruling required *removing* that exposure,
  not narrowing it.
- **BMPL-183**: a shipment action that creates a customer charge
  (return-to-sender) must use the more restrictive `logistics.manage`; an
  action that only moves a parcel without creating a charge (a reattempt,
  a terminal pickup) stays on the less restrictive `logistics.operate`.

Answered **BMPL-247**, **BMPL-183** and **BMPL-201**. Settled since: the
phone exposure is removed (`719230d`); the return-to-sender permission
choice is recorded but the feature itself remains unbuilt (see requirement
10 in [`EDWARD-REQUIREMENTS.md`](./EDWARD-REQUIREMENTS.md)).

## Ruling 3 — the promotion-metrics backfill: approved on a condition, resolved as impossible

Approved the *direction* on one condition, stated as the first deliverable
rather than the last: only if the historical daily promotion-metrics
counters can be reconstructed **exactly** from authoritative per-event
records does a backfill get designed — and even then it must be idempotent,
narrowly scoped, audit-trailed, tested against a production-shaped copy, and
totals-verified before and after. **"Cannot be reconstructed" is an
accepted, valued outcome** that must be reported with the exact missing
information; estimating or fabricating historical values is forbidden.

Answered **BMPL-330** (revived from archived BMPL-197). Settled since: the
determinism proof came back negative — a pre-fix daily row is an integer
counter that silently mixed two calendar days' events with no marker for
which contributed how much, and no substitute per-event source exists. The
owner then ruled the historical aggregates be **preserved as-is**, with no
estimation, no modification and no fabricated history, and directed that the
card not be left permanently blocked on an impossibility. Closed; the
forward-looking fix for future data is tracked separately as BMPL-332.

## Ruling 4 — a notification type existing is not permission to invent a detector for it

`ADMIN_SECURITY_ALERT` stays in the catalog. The answer to "nothing detects
a security event" is **not** to invent a detector: only events BMPL already
represents authoritatively may fire it. Any detection that would need a
**new threshold** comes back to the owner as its own narrow question — it is
not an invitation to pick a number.

Answered **BMPL-232**. Settled since: wired to exactly two pre-existing,
authoritative events (an admin wallet lock/unlock; an admin permission-set
change), both already gated by the same permission as the action itself and
both notifying inside the same transaction as their own audit row. Ordinary
user suspension was deliberately left unwired — it fires for spam, ToS and
non-payment reasons, none of which are security — and whether it should
count is queued as an open owner question for the next batch, not decided
by implementation.

## Ruling 5 — a driver's declared locality must actually constrain dispatch

Drivers could already declare which localities they serve, and dispatch was
ignoring it, matching on district alone. Finish wiring it — and widen it
**past cities** to towns, villages, islands/cayes and other supported
locality types. District may remain a grouping or filter but must not be
the only dispatch or serviceability boundary. Standing fence, carried into
implementation: no fabricated Belize geography — places come only from what
admins and providers actually configure.

Answered **BMPL-194**. Settled since: shipped — `DriverServiceCity` wired
into dispatch matching via exact-match `sameCity`, documented in
[`DISPATCH.md`](./DISPATCH.md).

## Ruling 6 — an unserviceable travel date: say why, and offer a real next date only if the data supports one

When a customer's chosen travel date can't be served, show the
unavailability **with the reason**, and offer the next operating date — but
only when the configured schedule actually supports naming one. The offer
is best-effort and must degrade cleanly to plain unavailability rather than
guessing past what the data shows; never invent a departure date from
incomplete schedule data.

Answered **BMPL-283**. Settled since: shipped (`42d658f`) — searches forward
through the real route planner up to fourteen days for a serviceable date,
and names the degraded case in the UI rather than leaving it silent.

## Ruling 7 — who can see a pickup/handoff photo

A pickup or handoff photo may be visible to:

- the sender,
- authorized courier/provider staff, as operationally necessary, and
- an authenticated recipient who has been legitimately linked to, or has
  claimed, that shipment.

Possession of an anonymous public tracking link does not by itself authorize
access to photos or any other sensitive shipment detail.

*Answered no open card — recorded here since 2026-09-28.*

## Ruling 8 — saved addresses

Reuse the existing `SavedAddress` foundation. Do not create a second address
system. It must support customer labels (Home, Work, Mom), a
preferred/default address, selection during checkout/shipping, and edit and
removal. Deleting a saved address must not alter historical shipment/order
snapshots.

*Answered no open card — recorded here since 2026-09-28.*

## Ruling 9 — courier identity toward the customer, and the business-number rule

During an active shipment, a customer may see the courier's display name,
approved profile photo, vehicle type, vehicle photo and licence plate —
never legal name, documents, home address, personal phone, emergency
contact, or licence-document images. Customer-to-courier communication
should use BML's own messaging/contact mechanism where available. A
dedicated business or work contact number may be exposed only if the system
explicitly distinguishes it as intended for customer contact; a courier's
private account/application phone must never be repurposed as that number.

First given 2026-09-26 answering **BMPL-180**; reaffirmed and numbered on
2026-09-28 answering **BMPL-201** and **BMPL-247**, which applied the same
rule to an *internal* exposure — the admin hub handoff desk showed the same
private phone to any holder of a platform-wide staff permission — and
required removing it, not narrowing it. Settled since: BMPL-180's
customer-facing half had already shipped (`a4fb20d`) before the ruling was
restated; BMPL-247 removed the private phone from the internal hub desk
(`719230d`). A dedicated business-number field and staff-to-driver messaging
remain unbuilt and gated on a further owner decision (BMPL-201).

## Ruling 10 — what a vendor's posted opening hours mean for an order

Configured vendor hours constrain dispatch; **absence of configured hours
means unconstrained, not closed** — the opposite of what a naive
implementation would default to. If immediate fulfilment would reach a
required facility while it's closed, defer to the next valid configured
opening window rather than fabricating availability. Operations must be
able to see why something was deferred, without a notification firing on
every sweep cycle for the same waiting episode.

Answered **BMPL-259** (raised out of BMPL-257). Settled since: shipped on
both of the rule's consequences — dispatch-side deferral (BMPL-177,
`a072971`; one-off vendor closures, BMPL-334, `81ad57f`) and the
customer-facing closing-soon warning (BMPL-335, and the checkout-quote data
it needs, `1161a6f`/PR #255 — see
[`docs/openapi/marketplace.yaml`](./openapi/marketplace.yaml)).

## Ruling 11 — recipient availability and ETA changes

Recipients may provide or update an availability window and, where policy
permits, a delivery location, before final delivery. A multi-leg ETA must
derive from actually configured schedules, operating hours, exceptions and
known shipment state — never a fabricated timetable. Notify affected users
when the ETA changes materially, using the already-established 30-minute
threshold as the initial default — configurable, not permanently hard-coded
as business policy. Any reroute that increases the customer's charge must
show the new cost and require confirmation before any charge occurs.

*Answered no open card — recorded here since 2026-09-28.* See
[`EDWARD-REQUIREMENTS.md`](./EDWARD-REQUIREMENTS.md) requirements 11 and 12
for what is and is not built against this ruling.

## Ruling 12 — a tracking token proves possession, not identity

*The load-bearing ruling — a principle, not a single case.*

> A tracking token or link proves possession of a link. It is not
> automatically proof of identity or authorization. Exact addresses, private
> photos, handoff codes/PINs, personal courier data and other sensitive
> operational details require the appropriate authenticated and authorized
> relationship.

*Answered no open card as its own ask, but already settled two others:*

- **BMPL-119, question 2** ("may a door PIN ever travel on a public tracking
  link?") — closed. The code already never puts a PIN on a public link; this
  ruling confirms that behavior as policy rather than requiring a change.
- **BMPL-179** (recipient account linking) — eliminated one of three proposed
  claim policies. "Accept it: first authenticated claimant wins, the link is
  already trusted" is the exact position this ruling rejects, since claiming
  is itself an authorization-granting act keyed on nothing but possession of
  the link. The choice between the two remaining options is still the
  owner's and is still open.

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

*Sources: kanban card BMPL-331 (rulings 7, 8, 11, 12 — the four that
answered no open ask) and, for rulings 1–6, 9 and 10, the card each one
answered: BMPL-109, BMPL-183 (1); BMPL-183, BMPL-201, BMPL-247 (2); BMPL-330
(3); BMPL-232 (4); BMPL-194 (5); BMPL-283 (6); BMPL-180, BMPL-201, BMPL-247
(9); BMPL-259 (10). If a ruling above and a dependent card's own notes ever
disagree, the card is the primary source for that ruling — check it for the
owner's exact words before trusting either restatement, including this one.*

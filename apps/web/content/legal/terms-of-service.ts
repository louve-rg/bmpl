// Verbatim content from Angela's draft, cleared by the owner for placeholder-visible
// publication (MDF-109, 2026-10-11). Do not edit this text here -- a content change
// goes back through Angela/the owner and lands as a new copy of the source draft.
// Source: angela--mv08t0fp/drafts/terms-of-service.md
export const TERMS_OF_SERVICE_CONTENT = `# Terms of Service — DRAFT for owner review

**Status:** Draft. Not published. Not legal advice. Contains placeholders marked \`[OWNER DECISION: ...]\` that must be resolved before this page can go live. See the companion cover list for all placeholders in one place.

**Grounding note:** everything describing what the platform *does* below was checked against the current \`packages/database/prisma/schema.prisma\` and related source on \`origin/main\` as of 2026-10-11. Nothing here describes a capability the code does not show exists.

---

## 1. Who this agreement is with

[OWNER DECISION: legal entity name operating BML — a company name, a sole proprietorship, or not yet formed]
[OWNER DECISION: registered address / jurisdiction of operation]
[OWNER DECISION: governing law and venue for disputes]

These Terms govern your use of Belize Marketplace & Logistics ("BML"), accessible at [OWNER DECISION: production domain(s)].

## 2. What BML is

BML is a platform connecting people in Belize across several areas. As of this draft, the following are active:

- **Marketplace** — vendors list products; customers buy them.
- **Shipping & Delivery** — customers send parcels; the platform plans routes across configured hubs and carrier lanes.
- **Delivery driver** — independent drivers accept and fulfil delivery jobs.
- **Passenger Transportation** — in foundation stage. [OWNER DECISION: confirm whether this is customer-visible yet, or back-end only, at the time this page is published.]
- **Belize Connect (jobs)** and **Real estate** listings are also present on the platform.

BML does not manufacture, warehouse, or own what vendors sell, does not employ drivers, and does not operate its own fleet, vehicles, or transport routes. A hub, a courier lane, or a route existing on the platform reflects a carrier or operator who has been onboarded — not a service BML guarantees exists for any particular trip.

**BML currently has no live GPS tracking** of any vehicle, bus, or boat, no fixed timetables for passenger or shipping legs, and does not automatically fill in your town from a map pin — you tell us the town and district directly. Delivery and shipment status is reported by the people and systems carrying your order, not watched live.

## 3. Accounts and roles

One account can hold more than one role at a time (for example: customer and driver, or vendor and job seeker) — each role has its own approval and standing, independent of the others.

Applying for a role that requires approval (vendor, driver, employer, real-estate agent/agency, passenger provider/driver, shipping provider) means submitting the information that role requires — including, where applicable, identity and licensing details and supporting documents — for review. [OWNER DECISION: what happens to that information, and to the account, if an application is rejected — deleted, retained, for how long.]

You are responsible for keeping your account credentials confidential and for activity that happens under your account.

## 4. Money on the platform

**At this time, BML does not move real money.** There is no payment processor, no card or bank rail, and no payout or withdrawal path anywhere on the platform. Any wallet balance, payment, or transaction you see in your account reflects an internal, simulated ledger and does not represent, and cannot be converted into, real currency.

[OWNER DECISION: is there a planned path and timeline to real payments the Terms should foreshadow, or should this section simply state the current state with no forward-looking claim?]

[OWNER DECISION: pricing, fees, commissions, deposits, refunds, cancellation charges, and any dispute-over-money process — none of this exists on the platform today and none of it is described here. If and when a product decision authorizes any of it, this section needs to be rewritten to match, not filled in with standard marketplace language now.]

## 5. Content you post

Product listings, messages, reviews, photos, and job/property listings are your content. You're responsible for it being accurate and for having the right to post it.

The platform has moderation review for vendor stores, products, profile photos, and reported reviews — a human or an automated check may approve, reject, or remove content, and an account may be suspended for violations. [OWNER DECISION: what counts as a violation, in plain terms — this list should come from the owner, not be invented here.]

Messages you send to other users may include file attachments. [OWNER DECISION: the platform currently has a malware-scan status field on attachments but no scanning is actually wired up yet — do you want this disclosed plainly ("attachments are not currently scanned for malware") or do you want to wait until scanning is built before saying anything either way? Recommend disclosing honestly either way; do not claim scanning that isn't happening.]

## 6. Reviews and ratings

You may leave reviews and ratings on vendors, products, and other rated entities, and can report a review you believe violates the rules. [OWNER DECISION: review removal/appeal policy.]

## 7. Suspension and termination

BML may suspend or close an account for violations of these Terms. [OWNER DECISION: notice, appeal process, and what happens to a suspended account's listings/orders/wallet-simulation balance.]

You may close your account at any time by [OWNER DECISION: actual mechanism — is there a self-service account-deletion flow today, or does this require contacting support?].

## 8. Disclaimers and liability

[OWNER DECISION: this entire section needs real legal drafting — warranty disclaimers, liability caps, and indemnification are legal judgment calls this draft will not invent. Flagging explicitly: get legal review before publishing anything here.]

## 9. Changes to these Terms

[OWNER DECISION: how changes are communicated and how much notice is given before they take effect.]

## 10. Contact

[OWNER DECISION: a real contact method — email, address, or support form.]

---

🤖 Drafted by Angela (Claude Code) for owner review via god/Michael. Not published. Not legal advice.`;

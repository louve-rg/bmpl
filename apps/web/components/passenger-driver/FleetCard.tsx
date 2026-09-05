'use client';

/**
 * The seat reserved for fleet affiliation on the Passenger Dashboard.
 *
 * Fleet membership is being built as MUTUAL CONSENT (an operator invites and
 * the driver accepts, or the driver requests and the operator approves —
 * BMPL-39, in flight on the API now), and the driver-facing API does not yet
 * expose a driver's own affiliation at all. Until it does there is nothing
 * truthful this card can say — not even "independent", which the browser
 * cannot know — so it renders nothing rather than a claim.
 *
 * When the affiliation endpoints land, this component becomes: current fleet
 * (operator name), pending invitations with accept/decline, and a
 * request-to-join entry point. It is mounted on the dashboard already so that
 * arrival is a change to this file alone.
 */
export function FleetCard() {
  return null;
}

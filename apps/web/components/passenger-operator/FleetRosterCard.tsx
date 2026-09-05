'use client';

/**
 * The seat reserved for the operator's fleet roster and driver affiliation.
 *
 * Fleet membership is being built as MUTUAL CONSENT (the operator invites and
 * the driver accepts, or the driver requests and the operator approves —
 * BMPL-39, in flight on the API now). Today NO driver can belong to a fleet:
 * nothing in the system can set the affiliation, there is no roster endpoint
 * for an operator to list their drivers, and the server refuses every staffing
 * attempt with "Only the operator's own fleet drivers can staff this
 * departure." So there is nothing truthful this card can show, and it renders
 * nothing rather than a claim.
 *
 * When the affiliation endpoints land, this component becomes: the roster,
 * pending invitations/join requests with approve/decline, and the
 * invite-a-driver entry point — and the departure staffing control (a
 * driver + vehicle picker against POST /passenger/provider/trips/:id/assign,
 * which already exists) becomes buildable at the same time. It is mounted on
 * the dashboard already so that arrival starts here.
 */
export function FleetRosterCard() {
  return null;
}

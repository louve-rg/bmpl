import { api } from './api';

/**
 * Multi-leg shipping, from the customer's side.
 *
 * The whole point of this layer is that the customer never has to think in legs.
 * They booked one journey and they get one status, one price, and one place to
 * look. The legs are shown because a parcel sitting at an airstrip overnight is
 * easier to accept when you can see WHY — not because anyone should have to
 * reason about them.
 */

export interface ShippingHub {
  id: string;
  code: string;
  name: string;
  type: string;
  district: string;
  city: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  modes: string[];
  instructions: string | null;
}

export interface ShipmentLegHub {
  id: string;
  code: string;
  name: string;
  city: string;
  instructions: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Who is actually showing up (BMPL-180). Display name only — never legal
 *  name, phone, or documents. Mirrors DeliveryDriver in lib/deliveries.ts. */
export interface ShipmentCourier {
  displayName: string;
  ratingAverage: number | null;
  completedDeliveries: number | null;
  initials: string;
  avatarUrl: string | null;
}

/** What they are driving. `photoUrl` is set only once the vehicle itself has
 *  cleared admin review — an unapproved photo is never shown. */
export interface ShipmentCourierVehicle {
  type: string | null;
  make: string | null;
  model: string | null;
  color: string | null;
  licencePlate: string | null;
  photoUrl: string | null;
}

export interface ShipmentLegView {
  id: string;
  sequence: number;
  kind: 'DIRECT' | 'FIRST_MILE' | 'LINE_HAUL' | 'LAST_MILE';
  mode: 'LAND' | 'AIR' | 'SEA';
  modeLabel: string;
  status: 'PENDING' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'EXCEPTION';
  description: string | null;
  priceMinor: number;
  durationMinutes: number;
  isCurrent: boolean;
  originHub: ShipmentLegHub | null;
  destinationHub: ShipmentLegHub | null;
  carrier: string | null;
  scheduleNote: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  handoffReceivedByName: string | null;
  exceptionReason: string | null;
  /** Only ever set on the customer's own final delivery leg. */
  handoffPin: string | null;
  /** Null until a courier is actually assigned to this leg. */
  courier: ShipmentCourier | null;
  courierVehicle: ShipmentCourierVehicle | null;
  /**
   * BMPL-290: this leg's own customer<->courier thread, or null before one
   * exists — a driver has to accept the leg before there is anyone to talk to
   * or anything to open. Never a placeholder: null means no thread, full stop.
   * One leg, one thread — a shipment with two courier legs has two separate
   * conversationIds, never one shared id.
   */
  conversationId: string | null;
  /**
   * BMPL-340 (Edward req 12): this leg's own projected finish, or null for a
   * cancelled leg (excluded from the ETA walk entirely) or one that was never
   * reached because an earlier leg is EXCEPTION/UNKNOWN. See {@link ShipmentEtaSummary}.
   */
  eta: ShipmentLegEta | null;
  /**
   * BMPL-178/BMPL-352 (Edward req 2): pickup evidence the assigned courier
   * attached to THIS leg — never pooled onto a sibling leg of the same
   * shipment. Optional: web and api deploy independently, and a required
   * field read unguarded is how /store/[slug] nearly showed a stranger an
   * error page (BMPL-349) — absence here just means "nothing to show yet",
   * same as an empty array, never a crash.
   */
  pickupPhotoUrls?: string[];
}

/**
 * BMPL-340 (Edward req 12): a shipment's own multi-leg ETA, derived ONLY
 * from configured data (packages/shared/src/shipment-eta.ts carries the
 * full reasoning). `UNKNOWN` is a normal, PERMANENT state on this system
 * today — almost nothing writes a LINE_HAUL leg's scheduled departure yet
 * — never a transient "still loading" to be waited out. Always read
 * `confidence`; never infer UNKNOWN from `estimatedArrivalAt` being null,
 * even though the API's own invariant keeps the two in step.
 */
export type EtaConfidence = 'KNOWN' | 'PROJECTED' | 'UNKNOWN';

export interface ShipmentEtaSummary {
  confidence: EtaConfidence;
  /** Null exactly when confidence is UNKNOWN. */
  estimatedArrivalAt: string | null;
}

export interface ShipmentLegEta {
  sequence: number;
  confidence: EtaConfidence;
  /** Null exactly when confidence is UNKNOWN. */
  estimatedCompletionAt: string | null;
  /** A human-readable reason FROM THE API — never invented client-side. Null
   *  when none is needed (a completed leg, a carrier's own commitment, or
   *  the very first live leg starting right away with nothing to wait on). */
  reason: string | null;
}

export interface ShipmentEndpoint {
  name: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  latitude: number | null;
  longitude: number | null;
  instructions: string | null;
}

/**
 * BMPL-284/285: one time range for one door-touching attempt, sender or
 * recipient. `startTime`/`endTime` are "HH:MM" Belize local and may describe
 * an overnight window (endTime < startTime) — see the shared `isAvailable`
 * for how that's read. Absence of a role's rows means unconstrained, not
 * incomplete: every shipment behaves this way until a window is set.
 */
export interface AvailabilityWindowView {
  id: string;
  role: 'SENDER' | 'RECIPIENT';
  startTime: string;
  endTime: string;
}

export interface CustodyEntry {
  id: string;
  fromHolder: string | null;
  toHolder: string;
  actorLabel: string | null;
  note: string | null;
  occurredAt: string;
}

export interface ShipmentView {
  id: string;
  reference: string;
  service: string;
  serviceLabel: string;
  status: string;
  statusLabel: string;
  endsAtHub: boolean;
  quotedTotalMinor: number;
  quotedMinutes: number | null;
  explanation: string | null;
  description: string | null;
  pieces: number;
  bookedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  exceptionReason: string | null;
  origin: ShipmentEndpoint;
  destination: ShipmentEndpoint;
  currentLegSequence: number | null;
  legs: ShipmentLegView[];
  custody: CustodyEntry[];
  availabilityWindows: AvailabilityWindowView[];
  /**
   * Capability token for the recipient's public tracking link — the sender
   * shares it (`GET /shipping/track/{token}`). Null on shipments booked before
   * the token existed; absent until the API that mints it is deployed.
   */
  recipientTrackingToken?: string | null;
  /**
   * BMPL-340 (Edward req 12): the journey's own overall ETA. Optional like
   * `recipientTrackingToken` above and for the same reason — web and api
   * deploy independently (Vercel vs. Railway, which runs `prisma migrate
   * deploy` first and is therefore slower), so there is a real window where
   * this page is live against an API that does not send the field yet.
   * Absence means the same thing `confidence: 'UNKNOWN'` means — read it
   * through {@link etaLine}, never dereferenced directly.
   */
  eta?: ShipmentEtaSummary;
}

/**
 * The recipient's PUBLIC, status-only view — a deliberate allowlist the API
 * builds by hand, never derived from {@link ShipmentView}. It carries no
 * sender identity or address, no money, no parcel description, no handoff PIN,
 * no custody actors and no driver identity. This type must not grow fields the
 * endpoint does not return: the omissions are a security decision, not a gap.
 */
export interface RecipientTrackingStep {
  sequence: number;
  kindLabel: string;
  modeLabel: string;
  description: string;
  completed: boolean;
  isCurrent: boolean;
  completedAt: string | null;
}

export interface RecipientTrackingView {
  reference: string;
  status: string;
  statusLabel: string;
  serviceLabel: string;
  bookedAt: string | null;
  deliveredAt: string | null;
  destination: { city: string | null; district: string | null };
  /** Present only while the shipment is AWAITING_COLLECTION at a terminal. */
  collectionHub: { name: string; city: string; address: string | null; instructions: string | null } | null;
  steps: RecipientTrackingStep[];
  /**
   * BMPL-340 (Edward req 12): the journey's own overall ETA — confidence and
   * arrival only, never the per-leg reasons `ShipmentView` carries. This
   * type is pinned byte-identical across `trackPublic`/`trackAsRecipient`/
   * `listIncoming` (the BMPL-179 parity test), so `eta` must stay exactly
   * this shape on all three.
   *
   * Optional, same reason as `ShipmentView.eta` above: web and api deploy
   * independently, and `trackPublic` in particular is UNAUTHENTICATED — a
   * crash there is a blank page visible to anyone holding the link, not
   * just a signed-in customer. Absence means the same thing UNKNOWN means;
   * read it through {@link etaLine}, never dereferenced directly.
   */
  eta?: ShipmentEtaSummary;
}

/**
 * Edward requirement 11: a linked recipient's own delivery window — a write
 * confirmation / own-data read, deliberately NOT part of RecipientTrackingView
 * above. That type is pinned identical whether reached by the anonymous
 * token or a linked account (recipient-tracking.integration.spec.ts); an
 * authenticated-only field like this one would break that parity rather
 * than extend it, so it travels through its own small endpoints instead.
 */
export interface RecipientAvailabilityWindows {
  reference: string;
  windows: Array<{ startTime: string; endTime: string }>;
}

export interface QuoteLeg {
  sequence: number;
  kind: string;
  mode: string;
  modeLabel: string;
  description: string;
  priceMinor: number;
  durationMinutes: number;
}

export type ShipmentQuote =
  | {
      available: true;
      service: string;
      serviceLabel: string;
      serviceDescription: string;
      totalMinor: number;
      transportMinutes: number;
      explanation: string;
      /** "YYYY-MM-DD", Belize calendar — the date this quote actually priced. */
      requestedDate: string;
      pricingIncomplete: boolean;
      pricingNote: string | null;
      legs: QuoteLeg[];
    }
  | {
      available: false;
      reason: string;
      message: string;
      useLocalDelivery: boolean;
      requestedDate: string;
      /**
       * True when the requested date is specifically why this failed — the
       * route/network otherwise works. False means nothing about the date
       * would help (no hub, no route, no mode at all).
       */
      dateUnavailable: boolean;
      /**
       * "YYYY-MM-DD", or null. Only ever a date the API itself confirmed
       * would actually work by re-running the real planner against it — never
       * guessed from partial schedule data. Null means the configured
       * schedule did not provide enough information to name one; that is not
       * the same as "never runs".
       */
      nextAvailableDate: string | null;
    };

/**
 * What staff has PREPARED for this shipment (a return, or a redirect) and is
 * waiting on the paying customer to confirm — BMPL-375/364. Staff action
 * alone never charges anyone; this is read-only until `confirmRoutingProposal`
 * is called. `...ShipmentQuote` is the price RECOMPUTED FRESH at read time,
 * never the number staff saw when they prepared it — informational, not a
 * locked-in figure, and it may differ again at confirm time.
 */
export type RoutingProposal = {
  kind: 'RETURN' | 'REROUTE';
  legId: string;
  /** Staff's own note on why — may be shown to the customer. */
  note: string;
  preparedAt: string;
  /** REROUTE only: the new destination staff chose, frozen at prepare time. */
  destination?: { name: string | null; address: string | null; city: string | null; district: string | null } | null;
  /**
   * REROUTE only, and only when a real price came back: whether this costs
   * more than what was already paid — informational, never a gate. Every
   * priced reroute requires the same explicit confirmation regardless of
   * this value; there is no "free" path any more (owner ruling, BMPL-375).
   */
  legCostsMoreThanOriginal?: boolean;
} & ShipmentQuote;

export type RoutingProposalOutcome =
  | { outcome: 'PENDING_MANUAL'; reason: string }
  | {
      outcome: 'INITIATED';
      returnShipment?: { id: string; reference: string; quotedTotalMinor: number };
      rerouteShipment?: { id: string; reference: string; quotedTotalMinor: number };
      legCostsMoreThanOriginal?: boolean;
    };

export const shippingApi = {
  hubs: () => api.get<ShippingHub[]>('/shipping/hubs'),
  /** The modes the configured network can actually offer right now. */
  modes: () => api.get<Array<'LAND' | 'AIR' | 'SEA'>>('/shipping/modes'),
  quote: (body: unknown) => api.post<ShipmentQuote>('/shipping/quote', body),
  create: (body: unknown) => api.post<ShipmentView>('/shipping', body),
  mine: () => api.get<ShipmentView[]>('/shipping'),
  track: (reference: string) => api.get<ShipmentView>(`/shipping/${encodeURIComponent(reference)}`),
  cancel: (id: string, reason: string) => api.post<ShipmentView>(`/shipping/${id}/cancel`, { reason }),
  /**
   * Whatever staff has prepared and is awaiting this customer's own
   * confirmation (BMPL-375/364) — a 404 means nothing is pending, the
   * normal case for almost every shipment, never an error to show.
   */
  routingProposal: (id: string) => api.get<RoutingProposal>(`/shipping/${id}/routing-proposal`),
  /**
   * THE explicit confirmation — the only call that may actually book and
   * charge the return/reroute staff prepared. No body: there is nothing left
   * for the customer to supply: the destination (reroute) and the reason
   * were staff's own, frozen at prepare time.
   */
  confirmRoutingProposal: (id: string) => api.post<RoutingProposalOutcome>(`/shipping/${id}/routing-proposal/confirm`),
  /**
   * Replace-all, same shape as the admin hub-hours PUT: every window the
   * sender still wants must be in `windows`, for both roles at once — one
   * omitted from the array is one that no longer applies. The API refuses a
   * role whose leg has already started; see AvailabilityWindows.tsx for why
   * that's never a reason to include it anyway.
   */
  setAvailabilityWindows: (id: string, windows: Array<{ role: 'SENDER' | 'RECIPIENT'; startTime: string; endTime: string }>) =>
    api.put<ShipmentView>(`/shipping/${id}/availability-windows`, { windows }),
  /**
   * The recipient's public tracking view — no session required. The token is a
   * server-minted capability from the sender's shipment; a bad, expired or
   * unknown token answers the same 404 as any other miss.
   */
  trackPublic: (token: string) => api.get<RecipientTrackingView>(`/shipping/track/${encodeURIComponent(token)}`),
  /**
   * Link this signed-in account to a shipment as its recipient, from the SAME
   * token `trackPublic` uses. Holding the token only ever authorised reading
   * that view; this is the deliberate step that lets the shipment show up in
   * the account's own "incoming" list. Requires a session — a 401 here means
   * the visitor needs to sign in (or create an account) first, never that the
   * link is wrong.
   */
  claim: (token: string) => api.post<{ reference: string; linked: boolean }>(`/shipping/track/${encodeURIComponent(token)}/claim`),
  /** Every shipment this account has claimed as recipient. Same allowlisted shape as `trackPublic`. */
  incoming: () => api.get<RecipientTrackingView[]>('/shipping/incoming'),
  /** One claimed shipment by reference — 404 if this account never claimed it. */
  incomingOne: (reference: string) => api.get<RecipientTrackingView>(`/shipping/incoming/${encodeURIComponent(reference)}`),
  /**
   * Edward requirement 11: a linked recipient's own delivery availability
   * window — never the sender's. Read-only; the recipient's own currently-
   * stored window(s), possibly empty.
   */
  incomingAvailabilityWindow: (reference: string) =>
    api.get<RecipientAvailabilityWindows>(`/shipping/incoming/${encodeURIComponent(reference)}/availability-window`),
  /**
   * Set or clear the recipient's own window — replace-all, same shape the
   * sender's own `setAvailabilityWindows` uses, but every row must be
   * `role: 'RECIPIENT'` (the API refuses anything else) and the write can
   * never touch the sender's own row.
   */
  setIncomingAvailabilityWindow: (reference: string, windows: Array<{ startTime: string; endTime: string }>) =>
    api.put<RecipientAvailabilityWindows>(`/shipping/incoming/${encodeURIComponent(reference)}/availability-window`, {
      windows: windows.map((w) => ({ ...w, role: 'RECIPIENT' as const })),
    }),
};

/** Minor units to a Belize dollar string. */
export function shippingMoney(minor: number): string {
  return `BZ$${(minor / 100).toFixed(2)}`;
}

/**
 * "45 minutes", "1h 20m", "2 days".
 *
 * Transport time only — it deliberately does NOT promise an arrival time. A
 * flight that runs three days a week has a duration but not a schedule, and
 * dressing an estimate up as an appointment is how you get an angry phone call.
 */
export function formatTransitTime(minutes: number | null): string | null {
  if (minutes == null || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  if (hours < 24) return hours % 1 === 0 ? `${hours}h` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  const days = Math.round(minutes / 60 / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** Where a leg sits in the journey, for the stepper. */
export type LegPhase = 'done' | 'current' | 'upcoming' | 'stopped';

export function legPhase(leg: ShipmentLegView): LegPhase {
  if (leg.status === 'COMPLETED') return 'done';
  if (leg.status === 'EXCEPTION' || leg.status === 'CANCELLED') return 'stopped';
  if (leg.status === 'IN_PROGRESS' || leg.isCurrent) return 'current';
  return 'upcoming';
}

/**
 * Once a parcel is delivered, cancelled, returned or rerouted there is
 * nothing left to estimate — the journey already ended, one way or
 * another. Shared by every surface that carries `eta` (sender, recipient,
 * incoming list) so they agree on when to show it at all, not just what it
 * says while shown.
 *
 * RETURNED (BMPL-356) / REROUTED (BMPL-367): without this, a finished
 * shipment would still show a live "arrival" estimate for a journey that is
 * not completing — the same kind of false-progress reading both cards exist
 * to close, just on this surface instead of the status badge.
 */
export function showsEta(status: string): boolean {
  return status !== 'DELIVERED' && status !== 'CANCELLED' && status !== 'RETURNED' && status !== 'REROUTED';
}

/**
 * The one line a customer reads for "when will this arrive" — driven
 * ENTIRELY by `eta.confidence`, never by whether `estimatedArrivalAt`
 * happens to be null (BMPL-340). UNKNOWN is common and permanent on this
 * system today, not a loading state: say so in plain words, never a blank
 * or a spinner that never resolves.
 *
 * `eta` itself is optional — a real, non-hypothetical case, not just a
 * defensive type: web and api deploy independently, so a response can
 * legitimately arrive with no `eta` field at all while api is still
 * rolling out. Absence is read exactly like UNKNOWN, never a crash.
 *
 * `formattedDate` is passed in already localized — this function has no
 * opinion on date formatting, only on what the confidence means.
 */
export function etaLine(eta: ShipmentEtaSummary | undefined, formattedDate: string | null): string {
  if (!eta || eta.confidence === 'UNKNOWN' || !formattedDate) {
    return 'We don’t have an estimate for this yet';
  }
  // KNOWN: a carrier's own commitment, or the leg already finished — not a
  // projection at all. PROJECTED: computed from configured duration and
  // hours/windows, still entirely from configured data, but said as the
  // estimate it is.
  return eta.confidence === 'KNOWN' ? `Arriving ${formattedDate}` : `Estimated to arrive ${formattedDate}`;
}

/**
 * The one extra line a leg gets, explaining WHY its own timing looks the
 * way it does — always the exact reason the API sent, never invented here.
 * Skipped for a leg already showing its own `exceptionReason`: an
 * EXCEPTION leg's ETA reason ("this leg needs attention…") would otherwise
 * say almost the same thing a second time, in a second box.
 */
export function legEtaNote(leg: ShipmentLegView): string | null {
  if (leg.exceptionReason) return null;
  return leg.eta?.reason ?? null;
}

/**
 * The one line a customer actually reads.
 *
 * A journey that ends at a terminal says where to collect from, because
 * "Delivered" would be a lie and "Awaiting collection" without a place is
 * useless.
 */
export function headlineFor(s: ShipmentView): string {
  if (s.cancelledAt) return 'Cancelled';
  if (s.status === 'EXCEPTION') return s.exceptionReason ?? 'Needs attention';
  if (s.status === 'AWAITING_COLLECTION') {
    const hub = [...s.legs].reverse().find((l) => l.destinationHub)?.destinationHub;
    return hub ? `Ready to collect at ${hub.name}` : 'Ready to collect';
  }
  return s.statusLabel;
}

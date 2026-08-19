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

export interface ShipmentLegView {
  id: string;
  sequence: number;
  kind: 'FIRST_MILE' | 'LINE_HAUL' | 'LAST_MILE';
  mode: 'LAND' | 'AIR' | 'SEA';
  modeLabel: string;
  status: 'PENDING' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'EXCEPTION';
  description: string | null;
  priceMinor: number;
  durationMinutes: number;
  isCurrent: boolean;
  originHub: { id: string; code: string; name: string; city: string; instructions: string | null } | null;
  destinationHub: { id: string; code: string; name: string; city: string; instructions: string | null } | null;
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
      pricingIncomplete: boolean;
      pricingNote: string | null;
      legs: QuoteLeg[];
    }
  | { available: false; reason: string; message: string; useLocalDelivery: boolean };

export const shippingApi = {
  hubs: () => api.get<ShippingHub[]>('/shipping/hubs'),
  quote: (body: unknown) => api.post<ShipmentQuote>('/shipping/quote', body),
  create: (body: unknown) => api.post<ShipmentView>('/shipping', body),
  mine: () => api.get<ShipmentView[]>('/shipping'),
  track: (reference: string) => api.get<ShipmentView>(`/shipping/${encodeURIComponent(reference)}`),
  cancel: (id: string, reason: string) => api.post<ShipmentView>(`/shipping/${id}/cancel`, { reason }),
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

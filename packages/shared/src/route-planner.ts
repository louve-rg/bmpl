/**
 * Deterministic route planning: turn "Placencia to San Pedro, door to door, by
 * air" into an ordered list of legs.
 *
 * NOT AI. This is a graph problem over a small, configured network — hubs and
 * the routes between them are DATA, and the answer is a shortest path with a
 * couple of domain rules layered on. A language model would be slower, less
 * repeatable, and unable to explain itself; this returns the same plan for the
 * same inputs every time and can say exactly why it chose what it chose.
 *
 * Placencia and San Pedro appear nowhere in this file. They are rows.
 *
 * Pure and framework-free so the API and the tests share one planner, and so it
 * can be reasoned about without a database.
 */

import type { LegKind, ShippingService, TransportMode } from './shipping';
import { needsFirstMile, needsLastMile } from './shipping';

/* ------------------------------------------------------------- network */

export interface PlannerHub {
  id: string;
  code: string;
  name: string;
  district: string;
  city: string;
  /** Modes this hub can actually handle. An airstrip cannot take a boat. */
  modes: readonly TransportMode[];
  isActive: boolean;
}

export interface PlannerRoute {
  id: string;
  originHubId: string;
  destinationHubId: string;
  mode: TransportMode;
  /** Minutes, as configured by operations. */
  durationMinutes: number;
  /** Minor units. The line-haul component of the quote. */
  priceMinor: number;
  isActive: boolean;
}

/**
 * Two towns one courier can drive between.
 *
 * The planner can recognise one journey that obviously needs no terminal — both
 * ends in the same town — and nothing beyond it. Belize City and Ladyville are
 * fifteen minutes apart on the Northern Highway; Belize City and San Pedro are
 * in the same district and one of them is on an island. Nothing in a district
 * column separates those two cases, so guessing meant either refusing the first
 * or despatching a road courier across water for the second.
 *
 * Which towns share a road is a fact about Belize, so it arrives here as data.
 * Like hubs and routes, no place name appears in this file.
 */
export interface PlannerLane {
  id: string;
  originDistrict: string;
  originCity: string;
  destinationDistrict: string;
  destinationCity: string;
  /** Minor units. What BML charges for the run; 0 means "not priced yet". */
  priceMinor: number;
  durationMinutes: number;
  isActive: boolean;
}

/** Where a shipment starts or ends. A door has a district; a hub has an id. */
export type Endpoint = { kind: 'DOOR'; district: string; city?: string | null } | { kind: 'HUB'; hubId: string };

export interface PlanRequest {
  origin: Endpoint;
  destination: Endpoint;
  service: ShippingService;
  /** Restrict the line-haul to one mode. Omitted means "whatever works". */
  preferredMode?: TransportMode | null;
}

export interface PlannedLeg {
  sequence: number;
  kind: LegKind;
  mode: TransportMode;
  /** Null when the leg starts at a door rather than a hub. */
  originHubId: string | null;
  destinationHubId: string | null;
  routeId: string | null;
  durationMinutes: number;
  priceMinor: number;
  /** Plain-language description of this step, for the customer. */
  description: string;
}

export type PlanResult =
  | { ok: true; legs: PlannedLeg[]; totalMinutes: number; totalMinor: number; explanation: string }
  | { ok: false; reason: PlanFailure; explanation: string };

export type PlanFailure =
  | 'NO_ORIGIN_HUB'
  | 'NO_DESTINATION_HUB'
  | 'NO_ROUTE'
  | 'SAME_HUB'
  | 'MODE_UNAVAILABLE'
  | 'LOCAL_DELIVERY';

/* ------------------------------------------------------------- pricing */

/**
 * Courier legs are priced by the EXISTING delivery pricing rules, which live in
 * the API and know about vendor zones and free-delivery thresholds. The planner
 * does not invent money — the caller passes in what a courier leg costs, and the
 * planner only adds up what it is given.
 */
export interface PlannerPricing {
  firstMileMinor: number;
  lastMileMinor: number;
  firstMileMinutes: number;
  lastMileMinutes: number;
  /** One courier, door to door, when the journey needs no terminal at all. */
  directMinor?: number;
  directMinutes?: number;
}

const NO_COURIER: PlannerPricing = {
  firstMileMinor: 0,
  lastMileMinor: 0,
  firstMileMinutes: 0,
  lastMileMinutes: 0,
  directMinor: 0,
  directMinutes: 0,
};

/* -------------------------------------------------------------- planner */

/**
 * Plan the legs for a shipment.
 *
 * The rules, in order:
 *  1. A door endpoint is attached to the nearest usable hub in its own district.
 *     Districts are the coarsest unit the network is configured in, and using
 *     them keeps the planner honest: it never guesses that a hub two districts
 *     away is "close enough".
 *  2. Same origin and destination hub means there is no line-haul to plan — this
 *     is a local delivery and the caller should use the ordinary courier flow.
 *  3. Otherwise find the cheapest active route chain between the two hubs,
 *     respecting the preferred mode when one is given.
 */
export function planRoute(
  req: PlanRequest,
  hubs: readonly PlannerHub[],
  routes: readonly PlannerRoute[],
  pricing: PlannerPricing = NO_COURIER,
  /**
   * Configured direct-courier lanes. Empty by default, and an empty list means
   * the planner behaves exactly as it did before lanes existed: same town is
   * local, everything else goes to the network.
   */
  lanes: readonly PlannerLane[] = [],
): PlanResult {
  const activeHubs = hubs.filter((h) => h.isActive);
  const byId = new Map(activeHubs.map((h) => [h.id, h]));

  // A local door-to-door journey has no terminal in it. Ask that question BEFORE
  // looking for hubs, because the old order of operations demanded a terminal
  // for a trip that never needed one and then refused the booking when the
  // district had no hub configured — which is not a routing answer, it is the
  // planner failing to recognise the simplest journey it can be asked for.
  const lane = findCourierLane(req, lanes);
  if (isLocalDoorToDoor(req) || lane) {
    if (req.preferredMode && req.preferredMode !== 'LAND') {
      return {
        ok: false,
        reason: 'MODE_UNAVAILABLE',
        explanation: `This is a local journey, so it travels by road. There is no ${req.preferredMode.toLowerCase()} leg to book.`,
      };
    }
    // A lane carries its own price and duration: a run up the highway is not
    // the same job as a run across town, and quoting it at the local rate
    // would undercharge for every mile of it.
    const leg: PlannedLeg = {
      sequence: 1,
      kind: 'DIRECT',
      mode: 'LAND',
      originHubId: null,
      destinationHubId: null,
      routeId: null,
      durationMinutes: lane ? lane.durationMinutes : pricing.directMinutes ?? 0,
      priceMinor: lane ? lane.priceMinor : pricing.directMinor ?? 0,
      description: lane
        ? `Direct courier from ${townOf(req.origin)} to ${townOf(req.destination)}`
        : 'Collection from the sender and delivery to the recipient',
    };
    return {
      ok: true,
      legs: [leg],
      totalMinutes: leg.durationMinutes,
      totalMinor: leg.priceMinor,
      explanation: leg.description,
    };
  }

  const originHub = resolveHub(req.origin, activeHubs, req.preferredMode);
  if (!originHub) {
    return {
      ok: false,
      reason: 'NO_ORIGIN_HUB',
      explanation: describeMissingHub(req.origin, req.preferredMode, 'collection'),
    };
  }
  const destinationHub = resolveHub(req.destination, activeHubs, req.preferredMode);
  if (!destinationHub) {
    return {
      ok: false,
      reason: 'NO_DESTINATION_HUB',
      explanation: describeMissingHub(req.destination, req.preferredMode, 'delivery'),
    };
  }

  if (originHub.id === destinationHub.id) {
    return {
      ok: false,
      reason: 'LOCAL_DELIVERY',
      explanation:
        'Both ends are served by the same terminal, so this is a local delivery — no transport leg is needed.',
    };
  }

  const path = cheapestPath(originHub.id, destinationHub.id, routes, req.preferredMode);
  if (!path) {
    return {
      ok: false,
      reason: req.preferredMode ? 'MODE_UNAVAILABLE' : 'NO_ROUTE',
      explanation: req.preferredMode
        ? `No ${req.preferredMode.toLowerCase()} service currently runs between ${originHub.name} and ${destinationHub.name}.`
        : `No transport service is currently configured between ${originHub.name} and ${destinationHub.name}.`,
    };
  }

  const legs: PlannedLeg[] = [];
  let sequence = 1;

  if (needsFirstMile(req.service)) {
    legs.push({
      sequence: sequence++,
      kind: 'FIRST_MILE',
      mode: 'LAND',
      originHubId: null,
      destinationHubId: originHub.id,
      routeId: null,
      durationMinutes: pricing.firstMileMinutes,
      priceMinor: pricing.firstMileMinor,
      description: `Collection from the sender and transport to ${originHub.name}`,
    });
  }

  for (const route of path) {
    const from = byId.get(route.originHubId);
    const to = byId.get(route.destinationHubId);
    legs.push({
      sequence: sequence++,
      kind: 'LINE_HAUL',
      mode: route.mode,
      originHubId: route.originHubId,
      destinationHubId: route.destinationHubId,
      routeId: route.id,
      durationMinutes: route.durationMinutes,
      priceMinor: route.priceMinor,
      description: `${modeVerb(route.mode)} from ${from?.name ?? 'origin'} to ${to?.name ?? 'destination'}`,
    });
  }

  if (needsLastMile(req.service)) {
    legs.push({
      sequence: sequence++,
      kind: 'LAST_MILE',
      mode: 'LAND',
      originHubId: destinationHub.id,
      destinationHubId: null,
      routeId: null,
      durationMinutes: pricing.lastMileMinutes,
      priceMinor: pricing.lastMileMinor,
      description: `Delivery from ${destinationHub.name} to the recipient`,
    });
  }

  const totalMinutes = legs.reduce((s, l) => s + l.durationMinutes, 0);
  const totalMinor = legs.reduce((s, l) => s + l.priceMinor, 0);

  return {
    ok: true,
    legs,
    totalMinutes,
    totalMinor,
    explanation: legs.map((l) => l.description).join(', then '),
  };
}

/* ------------------------------------------------------------ internals */

/**
 * Both ends are addresses in the same TOWN, and the customer asked us to collect
 * and deliver. One courier can do the whole job.
 *
 * Same town, not same district, and the difference matters in Belize: Belize
 * City and San Pedro are both in the Belize District, and San Pedro is on
 * Ambergris Caye. A district-wide rule would have planned a road courier for a
 * parcel that has to cross water — the driver would accept a job they could not
 * possibly finish, and the parcel would never arrive.
 *
 * The cost of being conservative is that two mainland towns in one district
 * (Belize City and Ladyville, say) are sent to the terminal network rather than
 * given a courier, and will be refused until a lane exists between them. That
 * is a worse quote, not a wrong delivery, and it is the right way round: the
 * planner can only tell towns apart, it cannot tell which ones share a road.
 * Making that distinction properly needs road-reachability in the data, not a
 * guess here.
 */
export function isLocalDoorToDoor(req: PlanRequest): boolean {
  if (req.service !== 'DOOR_TO_DOOR') return false;
  if (req.origin.kind !== 'DOOR' || req.destination.kind !== 'DOOR') return false;
  if (req.origin.district !== req.destination.district) return false;

  const from = req.origin.city?.trim().toLowerCase();
  const to = req.destination.city?.trim().toLowerCase();
  // A town we do not have is a QUESTION, not a permission.
  //
  // This used to read "no town on either end" as a district-level enquiry and
  // answer local. That was survivable while every booking typed an address, and
  // stopped being survivable the moment a customer could hand us a pin instead:
  // a pin in Belize City and a pin in San Pedro are both the Belize District
  // with no town on either end, and one road courier would have been sent to
  // drive a parcel across open water.
  //
  // Both towns, or it is not local. The booking schema asks for a town at every
  // door end, so this costs a correctly-filled booking nothing.
  return !!from && !!to && from === to;
}

/**
 * The configured lane that covers this journey, if there is one.
 *
 * BOTH DIRECTIONS. A road that carries a parcel one way carries it back, and
 * requiring operations to enter each lane twice only creates the chance for the
 * two rows to disagree about the price.
 *
 * DOOR_TO_DOOR ONLY, like same-town. The other three services mean the customer
 * is handling one end at a terminal themselves, and "one courier does the whole
 * job" is not a description of that journey.
 *
 * Town names are compared trimmed and case-folded, because they are typed by
 * customers. "ladyville " and "Ladyville" are the same place and a parcel should
 * not be routed differently for a trailing space.
 */
export function findCourierLane(req: PlanRequest, lanes: readonly PlannerLane[]): PlannerLane | null {
  if (req.service !== 'DOOR_TO_DOOR') return null;
  if (req.origin.kind !== 'DOOR' || req.destination.kind !== 'DOOR') return null;
  // Same town is already local, and it needs no lane to be configured.
  if (isLocalDoorToDoor(req)) return null;
  // A road lane cannot honour a request to fly or sail. Saying so is the
  // caller's job, further down; here we simply do not offer one.
  if (req.preferredMode && req.preferredMode !== 'LAND') return null;

  const from = place(req.origin.district, req.origin.city);
  const to = place(req.destination.district, req.destination.city);
  if (!from || !to) return null;

  return (
    lanes.find((l) => {
      if (!l.isActive) return null;
      const a = place(l.originDistrict, l.originCity);
      const b = place(l.destinationDistrict, l.destinationCity);
      return (a === from && b === to) || (a === to && b === from);
    }) ?? null
  );
}

/** A comparable "district/town" key, or null when the town is unknown. */
function place(district: string, city?: string | null): string | null {
  const town = city?.trim().toLowerCase();
  return town ? `${district}/${town}` : null;
}

/** The town name to show a customer, for a leg description. */
function townOf(e: Endpoint): string {
  return e.kind === 'DOOR' ? e.city?.trim() || e.district.replace(/_/g, ' ') : 'the terminal';
}

/** A door attaches to a hub in its own district; a hub endpoint is itself. */
function resolveHub(
  endpoint: Endpoint,
  hubs: readonly PlannerHub[],
  mode?: TransportMode | null,
): PlannerHub | null {
  if (endpoint.kind === 'HUB') return hubs.find((h) => h.id === endpoint.hubId) ?? null;
  const inDistrict = hubs.filter((h) => h.district === endpoint.district);

  // A town that has its own terminal uses it, full stop.
  //
  // The fallback used to be "any hub in the district", which quietly attached a
  // San Pedro address to the Belize City terminal whenever San Pedro's own
  // terminal could not take the requested mode. Both are in the Belize
  // District, and one of them is on an island — so the plan looked reasonable
  // and described a journey that does not exist. If the town's own terminal
  // cannot do the job, that is a refusal to explain, not a different town to
  // substitute.
  const inCity = endpoint.city
    ? inDistrict.filter((h) => h.city.toLowerCase() === endpoint.city!.toLowerCase())
    : [];
  const candidates = inCity.length > 0 ? inCity : inDistrict;

  const usable = mode ? candidates.filter((h) => h.modes.includes(mode)) : candidates;
  if (usable.length === 0) return null;
  // Deterministic when a town has several: hub code, so the same inputs always
  // give the same plan.
  return [...usable].sort((a, b) => a.code.localeCompare(b.code))[0]!;
}

function describeMissingHub(endpoint: Endpoint, mode: TransportMode | null | undefined, role: string): string {
  if (endpoint.kind === 'HUB') return `That ${role} terminal is not available.`;
  const where = endpoint.city || endpoint.district.replace(/_/g, ' ');
  return mode
    ? `There is no ${mode.toLowerCase()} terminal serving ${where} for ${role}.`
    : `There is no terminal serving ${where} for ${role}.`;
}

/**
 * Cheapest chain of routes from one hub to another (Dijkstra on price).
 *
 * Small networks, so clarity beats cleverness. Ties break on fewer legs then on
 * route id, which keeps the result stable — an unstable planner would quote a
 * customer one price and plan another.
 */
function cheapestPath(
  fromId: string,
  toId: string,
  routes: readonly PlannerRoute[],
  mode?: TransportMode | null,
): PlannerRoute[] | null {
  const usable = routes.filter((r) => r.isActive && (!mode || r.mode === mode));
  const out = new Map<string, PlannerRoute[]>();
  for (const r of usable) {
    const list = out.get(r.originHubId) ?? [];
    list.push(r);
    out.set(r.originHubId, list);
  }

  interface Node {
    hubId: string;
    cost: number;
    path: PlannerRoute[];
  }
  const best = new Map<string, number>([[fromId, 0]]);
  const frontier: Node[] = [{ hubId: fromId, cost: 0, path: [] }];

  while (frontier.length > 0) {
    frontier.sort((a, b) => a.cost - b.cost || a.path.length - b.path.length);
    const node = frontier.shift()!;
    if (node.hubId === toId) return node.path;
    if (node.cost > (best.get(node.hubId) ?? Infinity)) continue;

    for (const r of [...(out.get(node.hubId) ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
      // No revisiting a hub within one plan — a parcel that loops is a bug.
      if (node.path.some((p) => p.originHubId === r.destinationHubId) || r.destinationHubId === fromId) continue;
      const cost = node.cost + r.priceMinor;
      if (cost >= (best.get(r.destinationHubId) ?? Infinity)) continue;
      best.set(r.destinationHubId, cost);
      frontier.push({ hubId: r.destinationHubId, cost, path: [...node.path, r] });
    }
  }
  return null;
}

function modeVerb(mode: TransportMode): string {
  return mode === 'AIR' ? 'Flight' : mode === 'SEA' ? 'Boat' : 'Road transport';
}

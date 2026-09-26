import { describe, expect, it } from 'vitest';
import { planRoute, type PlannerHub, type PlannerLane, type PlannerRoute, type PlanRequest } from './route-planner';
import type { TransportMode } from './shipping';

/**
 * A fixture network that looks like Belize but is entirely DATA. Nothing in the
 * planner knows these places exist; changing the network means changing rows.
 *
 * Note San Pedro and Belize City share a district — the awkward real case — so
 * these tests also prove that town is what separates them, not district alone.
 */
const hub = (
  code: string,
  name: string,
  district: string,
  city: string,
  modes: TransportMode[],
  isActive = true,
): PlannerHub => ({ id: `hub_${code}`, code, name, district, city, modes, isActive });

const HUBS: PlannerHub[] = [
  hub('MUN', 'Belize City Municipal Airstrip', 'BELIZE', 'Belize City', ['LAND', 'AIR']),
  hub('WTB', 'Belize City Water Taxi Terminal', 'BELIZE', 'Belize City', ['LAND', 'SEA']),
  hub('SPA', 'San Pedro Airstrip', 'BELIZE', 'San Pedro', ['LAND', 'AIR']),
  hub('SPW', 'San Pedro Water Taxi Terminal', 'BELIZE', 'San Pedro', ['LAND', 'SEA']),
  hub('PLA', 'Placencia Airstrip', 'STANN_CREEK', 'Placencia', ['LAND', 'AIR']),
  hub('DGA', 'Dangriga Depot', 'STANN_CREEK', 'Dangriga', ['LAND']),
  hub('PGA', 'Punta Gorda Airstrip', 'TOLEDO', 'Punta Gorda', ['LAND', 'AIR']),
];

const route = (
  id: string,
  from: string,
  to: string,
  mode: TransportMode,
  durationMinutes: number,
  priceMinor: number,
  isActive = true,
): PlannerRoute => ({
  id,
  originHubId: `hub_${from}`,
  destinationHubId: `hub_${to}`,
  mode,
  durationMinutes,
  priceMinor,
  isActive,
});

const ROUTES: PlannerRoute[] = [
  route('r_pla_mun', 'PLA', 'MUN', 'AIR', 45, 8000),
  route('r_mun_spa', 'MUN', 'SPA', 'AIR', 20, 6000),
  route('r_mun_wtb', 'MUN', 'WTB', 'LAND', 15, 500),
  route('r_wtb_spw', 'WTB', 'SPW', 'SEA', 90, 3000),
  route('r_dga_mun', 'DGA', 'MUN', 'LAND', 150, 2500),
  route('r_pga_mun', 'PGA', 'MUN', 'LAND', 240, 3000),
];

const COURIER = { firstMileMinor: 1000, lastMileMinor: 1200, firstMileMinutes: 30, lastMileMinutes: 25 };

const door = (city: string, district: string) => ({ kind: 'DOOR' as const, city, district });
const at = (code: string) => ({ kind: 'HUB' as const, hubId: `hub_${code}` });

const plan = (req: PlanRequest, pricing = COURIER) => planRoute(req, HUBS, ROUTES, pricing);

/** Compact view of a plan for assertions. */
const shape = (r: ReturnType<typeof plan>) =>
  r.ok ? r.legs.map((l) => [l.sequence, l.kind, l.mode].join(':')) : ['FAILED:' + r.reason];

describe('the four service types', () => {
  const placencia = door('Placencia', 'STANN_CREEK');
  const sanPedro = door('San Pedro', 'BELIZE');

  it('DOOR_TO_DOOR wraps the transport in a collection and a delivery', () => {
    const r = plan({ origin: placencia, destination: sanPedro, service: 'DOOR_TO_DOOR', preferredMode: 'AIR' });
    expect(shape(r)).toEqual(['1:FIRST_MILE:LAND', '2:LINE_HAUL:AIR', '3:LINE_HAUL:AIR', '4:LAST_MILE:LAND']);
  });

  it('DOOR_TO_HUB collects but stops at the terminal', () => {
    const r = plan({ origin: placencia, destination: sanPedro, service: 'DOOR_TO_HUB', preferredMode: 'AIR' });
    expect(shape(r)).toEqual(['1:FIRST_MILE:LAND', '2:LINE_HAUL:AIR', '3:LINE_HAUL:AIR']);
  });

  it('HUB_TO_DOOR starts at the terminal and delivers to the door', () => {
    const r = plan({ origin: placencia, destination: sanPedro, service: 'HUB_TO_DOOR', preferredMode: 'AIR' });
    expect(shape(r)).toEqual(['1:LINE_HAUL:AIR', '2:LINE_HAUL:AIR', '3:LAST_MILE:LAND']);
  });

  it('HUB_TO_HUB is transport only, and costs no courier money', () => {
    const r = plan({ origin: at('PLA'), destination: at('SPA'), service: 'HUB_TO_HUB' });
    expect(shape(r)).toEqual(['1:LINE_HAUL:AIR', '2:LINE_HAUL:AIR']);
    if (!r.ok) throw new Error('expected a plan');
    expect(r.totalMinor).toBe(8000 + 6000);
    expect(r.totalMinutes).toBe(45 + 20);
  });
});

describe('one price', () => {
  it('adds the courier legs the caller priced to the transport it planned', () => {
    const r = plan({
      origin: door('Placencia', 'STANN_CREEK'),
      destination: door('San Pedro', 'BELIZE'),
      service: 'DOOR_TO_DOOR',
      preferredMode: 'AIR',
    });
    if (!r.ok) throw new Error('expected a plan');
    // The planner never invents money: transport comes from the route rows and
    // the courier legs come from the existing delivery pricing rules.
    expect(r.totalMinor).toBe(1000 + 8000 + 6000 + 1200);
    expect(r.totalMinutes).toBe(30 + 45 + 20 + 25);
  });
});

describe('choosing the transport', () => {
  it('takes the cheapest chain, even when a single longer hop exists', () => {
    // MUN to SPW: road to the water taxi then a boat costs 3500; there is no
    // direct sailing, and the planner must find the two-step answer itself.
    const r = plan({ origin: at('MUN'), destination: at('SPW'), service: 'HUB_TO_HUB' });
    if (!r.ok) throw new Error('expected a plan');
    expect(r.legs.map((l) => l.routeId)).toEqual(['r_mun_wtb', 'r_wtb_spw']);
    expect(r.totalMinor).toBe(3500);
  });

  it('honours a preferred mode and says so plainly when none runs', () => {
    const r = plan({
      origin: door('Punta Gorda', 'TOLEDO'),
      destination: door('Belize City', 'BELIZE'),
      service: 'DOOR_TO_DOOR',
      preferredMode: 'AIR',
    });
    if (r.ok) throw new Error('expected no plan');
    expect(r.reason).toBe('MODE_UNAVAILABLE');
    expect(r.explanation).toContain('Punta Gorda Airstrip');
  });

  it('finds the land route when no mode is insisted on', () => {
    const r = plan({
      origin: door('Punta Gorda', 'TOLEDO'),
      destination: door('Belize City', 'BELIZE'),
      service: 'DOOR_TO_DOOR',
    });
    expect(shape(r)).toEqual(['1:FIRST_MILE:LAND', '2:LINE_HAUL:LAND', '3:LAST_MILE:LAND']);
  });

  it('attaches a door to a terminal that can handle the chosen mode', () => {
    const byAir = plan({
      origin: at('MUN'),
      destination: door('San Pedro', 'BELIZE'),
      service: 'HUB_TO_DOOR',
      preferredMode: 'AIR',
    });
    const bySea = plan({
      origin: at('WTB'),
      destination: door('San Pedro', 'BELIZE'),
      service: 'HUB_TO_DOOR',
      preferredMode: 'SEA',
    });
    if (!byAir.ok || !bySea.ok) throw new Error('expected plans');
    expect(byAir.legs[0]!.destinationHubId).toBe('hub_SPA');
    expect(bySea.legs[0]!.destinationHubId).toBe('hub_SPW');
  });

  it('ignores hubs and routes operations have switched off', () => {
    const grounded = ROUTES.map((r) => (r.id === 'r_mun_spa' ? { ...r, isActive: false } : r));
    expect(planRoute({ origin: at('MUN'), destination: at('SPA'), service: 'HUB_TO_HUB' }, HUBS, grounded).ok).toBe(
      false,
    );

    const closed = HUBS.map((h) => (h.code === 'PGA' ? { ...h, isActive: false } : h));
    const noHub = planRoute(
      { origin: door('Punta Gorda', 'TOLEDO'), destination: at('MUN'), service: 'DOOR_TO_HUB' },
      closed,
      ROUTES,
    );
    if (noHub.ok) throw new Error('expected no plan');
    expect(noHub.reason).toBe('NO_ORIGIN_HUB');
  });
});

describe('when there is nothing to plan', () => {
  it('plans a local door-to-door job as one courier run, with no terminal', () => {
    // This used to be refused with LOCAL_DELIVERY, which is what produced
    // "There is no terminal serving Belize City for collection" on a journey
    // that never goes near a terminal. A door-to-door booking inside one
    // district is a real shipment and gets a real plan.
    const r = plan({
      origin: door('Belize City', 'BELIZE'),
      destination: door('Belize City', 'BELIZE'),
      service: 'DOOR_TO_DOOR',
    });
    if (!r.ok) throw new Error(`expected a plan, got ${r.reason}: ${r.explanation}`);
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0]!.kind).toBe('DIRECT');
    expect(r.legs[0]!.mode).toBe('LAND');
    expect(r.legs[0]!.originHubId).toBeNull();
    expect(r.legs[0]!.destinationHubId).toBeNull();
  });

  it('plans the local run even when the district has no terminal at all', () => {
    // Edward's exact case: production had no hubs configured, and the planner
    // demanded one before it would consider a journey that needs none.
    const r = planRoute(
      { origin: door('Belize City', 'BELIZE'), destination: door('Belize City', 'BELIZE'), service: 'DOOR_TO_DOOR' },
      [],
      [],
      { firstMileMinor: 0, lastMileMinor: 0, firstMileMinutes: 0, lastMileMinutes: 0, directMinor: 1500, directMinutes: 45 },
    );
    if (!r.ok) throw new Error(`expected a plan, got ${r.reason}: ${r.explanation}`);
    expect(r.legs[0]!.kind).toBe('DIRECT');
    expect(r.totalMinor).toBe(1500);
    expect(r.totalMinutes).toBe(45);
  });

  it('does NOT treat two towns in one district as a local courier run', () => {
    // Belize City and San Pedro share the Belize District, and San Pedro is on
    // an island. A road courier cannot make that trip, so it has to go to the
    // network even though the district matches.
    const r = plan({
      origin: door('Belize City', 'BELIZE'),
      destination: door('San Pedro', 'BELIZE'),
      service: 'DOOR_TO_DOOR',
    });
    if (!r.ok) throw new Error(`expected a plan, got ${r.reason}`);
    expect(r.legs.map((l) => l.kind)).not.toContain('DIRECT');
    expect(r.legs.map((l) => l.kind)).toContain('LINE_HAUL');
  });

  it('does NOT treat a townless door end as local, however local it might be', () => {
    // Now that a customer can give us a pin instead of a typed address, ends
    // with no town are possible. The old rule read "no town on either end" as a
    // district-level enquiry and answered LOCAL — so a pin in Belize City and a
    // pin in San Pedro, both in the Belize District, would have been handed to
    // one road courier and a parcel would have been sent across open water by
    // car.
    //
    // A town we do not have is a QUESTION, not a permission. What the planner
    // does instead — route it through the network, or refuse and say why — is a
    // separate decision; what it must never do is invent a direct courier run.
    const nowhere = { kind: 'DOOR' as const, district: 'BELIZE', city: null };
    const r = plan({ origin: nowhere, destination: nowhere, service: 'DOOR_TO_DOOR' });
    expect(r.ok ? r.legs.map((l) => l.kind) : []).not.toContain('DIRECT');
  });

  it('does not call a journey local when only one end names its town', () => {
    const r = plan({
      origin: door('Belize City', 'BELIZE'),
      destination: { kind: 'DOOR' as const, district: 'BELIZE', city: null },
      service: 'DOOR_TO_DOOR',
    });
    expect(r.ok ? r.legs.map((l) => l.kind) : []).not.toContain('DIRECT');
  });

  it('a townless pair with no network at all is refused, not guessed at', () => {
    // Production has no hubs configured, so this is the shape the refusal
    // actually takes today. It has to be a refusal the customer can act on
    // ("tell us the town") rather than a courier despatched on a hunch.
    const r = planRoute(
      {
        origin: { kind: 'DOOR', district: 'BELIZE', city: null },
        destination: { kind: 'DOOR', district: 'BELIZE', city: null },
        service: 'DOOR_TO_DOOR',
      },
      [],
      [],
    );
    expect(r.ok).toBe(false);
  });

  it('still refuses a local job that asks for a mode it cannot use', () => {
    // Asking to fly a parcel across one town is not a routing answer we can
    // give, and quietly downgrading it to a road run would misrepresent it.
    const r = plan({
      origin: door('Belize City', 'BELIZE'),
      destination: door('Belize City', 'BELIZE'),
      service: 'DOOR_TO_DOOR',
      preferredMode: 'AIR',
    });
    if (r.ok) throw new Error('expected no plan');
    expect(r.reason).toBe('MODE_UNAVAILABLE');
    expect(r.explanation).toMatch(/local journey/i);
  });

  it('a cross-district door-to-door still uses the terminal network', () => {
    // The local rule must not swallow journeys that genuinely need transport.
    const r = plan({
      origin: door('Placencia', 'STANN_CREEK'),
      destination: door('San Pedro', 'BELIZE'),
      service: 'DOOR_TO_DOOR',
    });
    if (!r.ok) throw new Error(`expected a plan, got ${r.reason}`);
    expect(r.legs.map((l) => l.kind)).toContain('LINE_HAUL');
    expect(r.legs.map((l) => l.kind)).not.toContain('DIRECT');
  });

  it('explains an unserved district in words a customer can act on', () => {
    const r = plan({ origin: door('Corozal Town', 'COROZAL'), destination: at('MUN'), service: 'DOOR_TO_HUB' });
    if (r.ok) throw new Error('expected no plan');
    expect(r.reason).toBe('NO_ORIGIN_HUB');
    expect(r.explanation).toContain('Corozal Town');
    expect(r.explanation).not.toMatch(/NO_ORIGIN_HUB|undefined|null/);
  });

  it('reports no route rather than inventing one', () => {
    const r = plan({ origin: at('SPA'), destination: at('PLA'), service: 'HUB_TO_HUB' });
    if (r.ok) throw new Error('expected no plan');
    expect(r.reason).toBe('NO_ROUTE');
  });
});

describe('determinism', () => {
  it('gives the identical plan for identical inputs', () => {
    const req: PlanRequest = {
      origin: door('Placencia', 'STANN_CREEK'),
      destination: door('San Pedro', 'BELIZE'),
      service: 'DOOR_TO_DOOR',
      preferredMode: 'AIR',
    };
    const first = plan(req);
    for (let i = 0; i < 5; i++) expect(plan(req)).toEqual(first);
  });

  it('does not depend on the order the network rows arrive in', () => {
    const req: PlanRequest = { origin: at('MUN'), destination: at('SPW'), service: 'HUB_TO_HUB' };
    const forwards = planRoute(req, HUBS, ROUTES);
    const backwards = planRoute(req, [...HUBS].reverse(), [...ROUTES].reverse());
    expect(backwards).toEqual(forwards);
  });

  it('never routes a parcel through the same terminal twice', () => {
    const looping = [
      ...ROUTES,
      route('r_spa_mun', 'SPA', 'MUN', 'AIR', 20, 10),
      route('r_spa_wtb', 'SPA', 'WTB', 'AIR', 20, 10),
    ];
    const r = planRoute({ origin: at('PLA'), destination: at('SPW'), service: 'HUB_TO_HUB' }, HUBS, looping);
    if (!r.ok) throw new Error('expected a plan');
    const arrivals = r.legs.map((l) => l.destinationHubId);
    expect(arrivals).toEqual([...new Set(arrivals)]);
  });
});

/**
 * BMPL-196: a configured route schedule (BMPL-186) actually governs whether
 * the planner will use the route on a given date.
 *
 * The load-bearing case is the FIRST test below: every route in production
 * has zero schedule configuration today, and that must keep planning exactly
 * as it always has. Everything else here is the opt-in behaviour on top.
 */
describe('route schedules (BMPL-196)', () => {
  // Belize is a fixed UTC-6 with no daylight saving (see service-schedule.ts).
  // `belizeInstant` names a moment by its Belize local wall-clock date/hour;
  // `calendarDate` names a pure calendar date the way RouteScheduleException's
  // date column stores one. Using plain UTC-midnight Dates for both, as this
  // fixture used to, was the exact BMPL-196 bug: it made every "today" here
  // silently mean the PRIOR Belize calendar day.
  const belizeInstant = (year: number, month: number, day: number, hour = 12): Date =>
    new Date(Date.UTC(year, month - 1, day, hour + 6, 0, 0));
  const calendarDate = (year: number, month: number, day: number): Date => new Date(Date.UTC(year, month - 1, day));

  const sunday = belizeInstant(2026, 11, 1); // Belize noon, a Sunday
  const wednesday = belizeInstant(2026, 11, 4); // Belize noon, a Wednesday

  it('plans exactly as before when no date is supplied at all', () => {
    const r = planRoute({ origin: at('PLA'), destination: at('SPA'), service: 'HUB_TO_HUB' }, HUBS, ROUTES, COURIER);
    expect(r.ok).toBe(true);
  });

  it('an unconfigured route - no weekly pattern, no exceptions - still runs on any date', () => {
    // This is the case that matters most: it is the state of every real route
    // today, and a schedule feature that broke it would silently ground the
    // entire network on deploy.
    const r = planRoute(
      { origin: at('PLA'), destination: at('SPA'), service: 'HUB_TO_HUB', date: sunday },
      HUBS,
      ROUTES,
      COURIER,
    );
    expect(r.ok).toBe(true);
  });

  it('excludes a route a carrier has marked NOT_OPERATING for that date, via a weekly pattern', () => {
    const grounded = ROUTES.map((r) =>
      r.id === 'r_mun_spa' ? { ...r, weeklyPattern: [{ dayOfWeek: 0, status: 'NOT_OPERATING' as const }] } : r,
    );
    const onSunday = planRoute(
      { origin: at('MUN'), destination: at('SPA'), service: 'HUB_TO_HUB', date: sunday },
      HUBS,
      grounded,
    );
    expect(onSunday.ok).toBe(false);
    // A Wednesday is not configured on this route at all, so it defaults OPERATING.
    const onWednesday = planRoute(
      { origin: at('MUN'), destination: at('SPA'), service: 'HUB_TO_HUB', date: wednesday },
      HUBS,
      grounded,
    );
    expect(onWednesday.ok).toBe(true);
  });

  it('excludes a route via a date-specific exception, overriding an otherwise-operating weekly pattern', () => {
    const withException = ROUTES.map((r) =>
      r.id === 'r_mun_spa'
        ? {
            ...r,
            weeklyPattern: [{ dayOfWeek: 0, status: 'OPERATING' as const }],
            scheduleExceptions: [
              { date: calendarDate(2026, 11, 1), status: 'NOT_OPERATING' as const, reason: 'Synthetic test holiday' },
            ],
          }
        : r,
    );
    const r = planRoute(
      { origin: at('MUN'), destination: at('SPA'), service: 'HUB_TO_HUB', date: sunday },
      HUBS,
      withException,
    );
    expect(r.ok).toBe(false);
  });

  it('a REDUCED day still plans - operations said thinner, not stopped', () => {
    const reduced = ROUTES.map((r) =>
      r.id === 'r_mun_spa' ? { ...r, weeklyPattern: [{ dayOfWeek: 0, status: 'REDUCED' as const }] } : r,
    );
    const r = planRoute(
      { origin: at('MUN'), destination: at('SPA'), service: 'HUB_TO_HUB', date: sunday },
      HUBS,
      reduced,
    );
    expect(r.ok).toBe(true);
  });

  it('routes around a grounded leg of a multi-hop chain when another path exists', () => {
    // MUN -> SPA is grounded on Sunday, but MUN -> WTB -> SPW is unaffected.
    const grounded = ROUTES.map((r) =>
      r.id === 'r_mun_spa' ? { ...r, weeklyPattern: [{ dayOfWeek: 0, status: 'NOT_OPERATING' as const }] } : r,
    );
    const r = planRoute(
      { origin: at('MUN'), destination: at('SPW'), service: 'HUB_TO_HUB', date: sunday },
      HUBS,
      grounded,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected a plan');
    expect(r.legs.map((l) => l.routeId)).toEqual(['r_mun_wtb', 'r_wtb_spw']);
  });
});

describe('explaining itself', () => {
  it('describes each step in plain language, with no identifiers or enums', () => {
    const r = plan({
      origin: door('Placencia', 'STANN_CREEK'),
      destination: door('San Pedro', 'BELIZE'),
      service: 'DOOR_TO_DOOR',
      preferredMode: 'AIR',
    });
    if (!r.ok) throw new Error('expected a plan');
    expect(r.explanation).toBe(
      'Collection from the sender and transport to Placencia Airstrip, then ' +
        'Flight from Placencia Airstrip to Belize City Municipal Airstrip, then ' +
        'Flight from Belize City Municipal Airstrip to San Pedro Airstrip, then ' +
        'Delivery from San Pedro Airstrip to the recipient',
    );
    for (const leg of r.legs) expect(leg.description).not.toMatch(/hub_|LINE_HAUL|FIRST_MILE|LAST_MILE/);
  });

  it('names the transport the way a customer would', () => {
    const sea = plan({ origin: at('WTB'), destination: at('SPW'), service: 'HUB_TO_HUB' });
    const land = plan({ origin: at('DGA'), destination: at('MUN'), service: 'HUB_TO_HUB' });
    if (!sea.ok || !land.ok) throw new Error('expected plans');
    expect(sea.legs[0]!.description).toContain('Boat from');
    expect(land.legs[0]!.description).toContain('Road transport from');
  });
});

/**
 * Belize City → Ladyville, which the business asked for by name.
 *
 * Two mainland towns fifteen minutes apart on the Northern Highway, in one
 * district. The planner could not tell them apart from Belize City → San Pedro,
 * which crosses open water, so it conservatively sent both to the terminal
 * network and refused both. That was the right way round to be wrong — a bad
 * quote beats a parcel handed to a driver who cannot reach it — but it made the
 * commonest inter-town courier run impossible to book.
 *
 * The missing piece was never logic. It was a fact about the road, and facts
 * about Belize are configured rows, not code.
 */
describe('direct courier lanes', () => {
  const lane = (
    originCity: string,
    destinationCity: string,
    over: Partial<PlannerLane> = {},
  ): PlannerLane => ({
    id: `lane_${originCity}_${destinationCity}`.replace(/\s+/g, '_'),
    originDistrict: 'BELIZE',
    originCity,
    destinationDistrict: 'BELIZE',
    destinationCity,
    priceMinor: 2000,
    durationMinutes: 40,
    isActive: true,
    ...over,
  });

  const bzToLadyville = [lane('Belize City', 'Ladyville')];

  const doorToDoor = (from: string, to: string, fromDistrict = 'BELIZE', toDistrict = 'BELIZE') => ({
    origin: { kind: 'DOOR' as const, city: from, district: fromDistrict },
    destination: { kind: 'DOOR' as const, city: to, district: toDistrict },
    service: 'DOOR_TO_DOOR' as const,
  });

  it('plans one courier and no terminal when a lane is configured', () => {
    const r = planRoute(doorToDoor('Belize City', 'Ladyville'), HUBS, ROUTES, COURIER, bzToLadyville);
    if (!r.ok) throw new Error(`expected a plan, got ${r.reason}: ${r.explanation}`);
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0]!.kind).toBe('DIRECT');
    expect(r.legs[0]!.originHubId).toBeNull();
    expect(r.legs[0]!.destinationHubId).toBeNull();
  });

  it('reads a lane in both directions, because a road goes both ways', () => {
    const r = planRoute(doorToDoor('Ladyville', 'Belize City'), HUBS, ROUTES, COURIER, bzToLadyville);
    if (!r.ok) throw new Error(`expected a plan, got ${r.reason}`);
    expect(r.legs[0]!.kind).toBe('DIRECT');
  });

  it('prices and times the lane from its own row, not from the local-run default', () => {
    const r = planRoute(doorToDoor('Belize City', 'Ladyville'), HUBS, ROUTES, COURIER, bzToLadyville);
    if (!r.ok) throw new Error('expected a plan');
    expect(r.totalMinor).toBe(2000);
    expect(r.totalMinutes).toBe(40);
  });

  it('names both towns, so the customer can see what was planned', () => {
    const r = planRoute(doorToDoor('Belize City', 'Ladyville'), HUBS, ROUTES, COURIER, bzToLadyville);
    if (!r.ok) throw new Error('expected a plan');
    expect(r.legs[0]!.description).toContain('Belize City');
    expect(r.legs[0]!.description).toContain('Ladyville');
  });

  it('does NOT extend to a town with no lane — San Pedro still crosses water', () => {
    // The whole point. Configuring Belize City ↔ Ladyville must not quietly
    // license every other pair of towns in the district.
    const r = planRoute(doorToDoor('Belize City', 'San Pedro'), HUBS, ROUTES, COURIER, bzToLadyville);
    if (!r.ok) throw new Error(`expected a plan, got ${r.reason}`);
    expect(r.legs.map((l) => l.kind)).not.toContain('DIRECT');
    expect(r.legs.map((l) => l.kind)).toContain('LINE_HAUL');
  });

  it('ignores a lane operations have closed', () => {
    // A flooded road is a closed lane. Refused, or routed through the network —
    // either is a fine answer. What must never happen is a courier being sent
    // down a lane operations have taken out of service.
    const r = planRoute(
      doorToDoor('Belize City', 'Ladyville'),
      HUBS,
      ROUTES,
      COURIER,
      [lane('Belize City', 'Ladyville', { isActive: false })],
    );
    expect(r.ok ? r.legs.map((l) => l.kind) : []).not.toContain('DIRECT');
  });

  it('carries a lane across district lines when one is configured', () => {
    // Nothing about a lane is district-bound. Corozal Town → Orange Walk Town is
    // one road, and the planner should say so if operations have said so.
    const crossDistrict = lane('Corozal Town', 'Orange Walk Town', {
      originDistrict: 'COROZAL',
      destinationDistrict: 'ORANGE_WALK',
    });
    const r = planRoute(
      doorToDoor('Corozal Town', 'Orange Walk Town', 'COROZAL', 'ORANGE_WALK'),
      HUBS,
      ROUTES,
      COURIER,
      [crossDistrict],
    );
    if (!r.ok) throw new Error(`expected a plan, got ${r.reason}`);
    expect(r.legs[0]!.kind).toBe('DIRECT');
  });

  it('matches town names regardless of case and stray spacing', () => {
    const r = planRoute(doorToDoor('  belize city ', 'LADYVILLE'), HUBS, ROUTES, COURIER, bzToLadyville);
    if (!r.ok) throw new Error(`expected a plan, got ${r.reason}`);
    expect(r.legs[0]!.kind).toBe('DIRECT');
  });

  it('will not fly a parcel down a road lane', () => {
    const r = planRoute(
      { ...doorToDoor('Belize City', 'Ladyville'), preferredMode: 'AIR' },
      HUBS,
      ROUTES,
      COURIER,
      bzToLadyville,
    );
    expect(r.ok).toBe(false);
  });

  it('a lane is only a courier answer when we are doing BOTH ends', () => {
    // DOOR_TO_HUB means the customer is handing the parcel to a terminal at the
    // far end. A direct courier run does not describe that journey.
    const r = planRoute(
      { ...doorToDoor('Belize City', 'Ladyville'), service: 'DOOR_TO_HUB', destination: at('SPA') },
      HUBS,
      ROUTES,
      COURIER,
      bzToLadyville,
    );
    if (!r.ok) throw new Error(`expected a plan, got ${r.reason}`);
    expect(r.legs.map((l) => l.kind)).not.toContain('DIRECT');
  });

  it('changes nothing at all when no lanes are configured', () => {
    // Production ships with an empty table. Same-town still works; everything
    // else behaves exactly as it did before lanes existed.
    const sameTown = planRoute(doorToDoor('Belize City', 'Belize City'), HUBS, ROUTES, COURIER, []);
    expect(sameTown.ok && sameTown.legs[0]!.kind).toBe('DIRECT');
    const twoTowns = planRoute(doorToDoor('Belize City', 'Ladyville'), HUBS, ROUTES, COURIER, []);
    expect(twoTowns.ok && twoTowns.legs.map((l) => l.kind)).not.toContain('DIRECT');
  });
});

import { describe, expect, it } from 'vitest';
import { planRoute, type PlannerHub, type PlannerRoute, type PlanRequest } from './route-planner';
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
  it('sends a same-town job back to the ordinary courier flow', () => {
    // This is the guard that keeps local single-courier delivery out of the
    // shipment engine entirely.
    const r = plan({
      origin: door('Belize City', 'BELIZE'),
      destination: door('Belize City', 'BELIZE'),
      service: 'DOOR_TO_DOOR',
    });
    if (r.ok) throw new Error('expected no plan');
    expect(r.reason).toBe('LOCAL_DELIVERY');
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

import { describe, expect, it } from 'vitest';
import { shipmentListSchema, createHubSchema, createRouteSchema, shipmentQuoteSchema } from './shipping';

describe('shipmentListSchema', () => {
  it('treats the WORD "false" as false', () => {
    // z.coerce.boolean() would say true here, because Boolean('false') is true.
    // On a filter that hides simulation shipments from an operations board, that
    // is the wrong direction to be wrong in.
    expect(shipmentListSchema.parse({ includeTest: 'false' }).includeTest).toBe(false);
    expect(shipmentListSchema.parse({ includeTest: '0' }).includeTest).toBe(false);
    expect(shipmentListSchema.parse({ includeTest: 'true' }).includeTest).toBe(true);
    expect(shipmentListSchema.parse({ includeTest: '1' }).includeTest).toBe(true);
  });

  it('defaults to a first page of twenty', () => {
    const parsed = shipmentListSchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(20);
    expect(parsed.includeTest).toBeUndefined();
  });
});

describe('createHubSchema', () => {
  const base = { code: 'spa', name: 'San Pedro Airstrip', type: 'AIRSTRIP', district: 'BELIZE', city: 'San Pedro', modes: ['AIR'] };

  it('uppercases the code, because "spa" and "SPA" must not be two hubs', () => {
    expect(createHubSchema.parse(base).code).toBe('SPA');
  });

  it('refuses a hub that handles no mode of transport', () => {
    // It could never appear in a plan, so accepting it would only create a row
    // that silently does nothing.
    expect(createHubSchema.safeParse({ ...base, modes: [] }).success).toBe(false);
  });

  it('refuses half a pin, and a pin outside Belize', () => {
    expect(createHubSchema.safeParse({ ...base, latitude: 17.9 }).success).toBe(false);
    expect(createHubSchema.safeParse({ ...base, latitude: 51.5, longitude: -0.12 }).success).toBe(false);
    expect(createHubSchema.safeParse({ ...base, latitude: 17.9, longitude: -87.96 }).success).toBe(true);
  });
});

describe('createRouteSchema', () => {
  const base = { originHubId: 'clh0000000000000000000000', destinationHubId: 'clh1111111111111111111111', mode: 'AIR', durationMinutes: 45, priceMinor: 8000 };

  it('refuses a route from a hub to itself', () => {
    // The planner would be free to loop through it at no cost.
    expect(createRouteSchema.safeParse({ ...base, destinationHubId: base.originHubId }).success).toBe(false);
  });

  it('accepts a free route but not a negative one', () => {
    expect(createRouteSchema.safeParse({ ...base, priceMinor: 0 }).success).toBe(true);
    expect(createRouteSchema.safeParse({ ...base, priceMinor: -1 }).success).toBe(false);
  });
});

describe('shipmentQuoteSchema', () => {
  it('wants a district for a door end and a terminal for a hub end', () => {
    const doorToDoor = {
      service: 'DOOR_TO_DOOR',
      origin: { district: 'STANN_CREEK' },
      destination: { district: 'BELIZE' },
    };
    expect(shipmentQuoteSchema.safeParse(doorToDoor).success).toBe(true);
    // Same service, but the origin now names a terminal instead of a district.
    expect(
      shipmentQuoteSchema.safeParse({ ...doorToDoor, origin: { hubId: 'clh0000000000000000000000' } }).success,
    ).toBe(false);
  });

  it('wants terminals at both ends of a hub-to-hub booking', () => {
    const hubToHub = {
      service: 'HUB_TO_HUB',
      origin: { hubId: 'clh0000000000000000000000' },
      destination: { hubId: 'clh1111111111111111111111' },
    };
    expect(shipmentQuoteSchema.safeParse(hubToHub).success).toBe(true);
    expect(shipmentQuoteSchema.safeParse({ ...hubToHub, destination: { district: 'BELIZE' } }).success).toBe(false);
  });
});

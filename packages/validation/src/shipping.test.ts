import { describe, expect, it } from 'vitest';
import { UNLOCATABLE_ADDRESS_MESSAGE } from '@bmpl/shared';
import {
  createHubSchema,
  createRouteSchema,
  createShipmentSchema,
  shipmentListSchema,
  shipmentQuoteSchema,
  updateHubSchema,
} from './shipping';

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

describe('updateHubSchema', () => {
  // The one place the phone rule is asserted (shared phoneSchema): the API and
  // the browser both import this schema, so stating it once here covers both.
  it('refuses a contact phone that is not a phone', () => {
    expect(updateHubSchema.safeParse({ contactPhone: 'not-a-phone' }).success).toBe(false);
    expect(updateHubSchema.safeParse({ contactPhone: '+501-226-2194' }).success).toBe(true);
  });

  it('refuses an empty update outright', () => {
    // PATCH {} would otherwise be a 200 that did nothing — a lie to the caller.
    expect(updateHubSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a partial operational-metadata edit', () => {
    const parsed = updateHubSchema.parse({ name: 'Belize City Water Taxi Terminal', instructions: 'Counter 2, 8am-5pm.' });
    expect(parsed.name).toBe('Belize City Water Taxi Terminal');
    expect(parsed.code).toBeUndefined();
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

/**
 * Booking, not just quoting.
 *
 * The form already lets a customer choose "drop a pin" and hides the street
 * field when they do — but this schema demanded an address anyway, so the pin
 * they dropped produced "We need the address to collect from" at the last step.
 * The same defect as the marketplace checkout, one layer further down.
 *
 * The TOWN is a separate matter and is now required at every door end. It is not
 * decoration: the planner compares towns to decide whether one courier can do
 * the whole job, and a door end with no town would be read as "as local as the
 * customer has told us", which is how a road courier gets planned for a parcel
 * that has to cross water.
 */
describe('createShipmentSchema — a door end is written OR pinned', () => {
  const pin = { latitude: 17.4995, longitude: -88.1976 };
  const street = { address: '5 Front Street' };
  const here = { city: 'Belize City', district: 'BELIZE' };
  const recipient = { name: 'Marisol Cano', phone: '501-600-1234' };

  const doorToDoor = (origin: object, destination: object) => ({
    service: 'DOOR_TO_DOOR',
    origin: { ...here, ...origin },
    destination: { ...here, ...recipient, ...destination },
  });

  it('accepts a pinned collection with no typed address', () => {
    expect(createShipmentSchema.safeParse(doorToDoor(pin, street)).success).toBe(true);
  });

  it('accepts a pinned delivery with no typed address', () => {
    expect(createShipmentSchema.safeParse(doorToDoor(street, pin)).success).toBe(true);
  });

  it('still refuses a door end that is neither written nor pinned', () => {
    const r = createShipmentSchema.safeParse(doorToDoor({}, pin));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toBe(UNLOCATABLE_ADDRESS_MESSAGE);
  });

  it('refuses a door end with no town, pin or no pin', () => {
    expect(createShipmentSchema.safeParse(doorToDoor({ ...pin, city: undefined }, pin)).success).toBe(false);
    expect(createShipmentSchema.safeParse(doorToDoor(pin, { ...pin, city: undefined })).success).toBe(false);
  });

  it('still needs somebody reachable at the far end', () => {
    expect(createShipmentSchema.safeParse(doorToDoor(pin, { ...pin, phone: undefined })).success).toBe(false);
  });

  it('asks for neither town nor address at an end the customer handles at a terminal', () => {
    expect(
      createShipmentSchema.safeParse({
        service: 'HUB_TO_HUB',
        origin: { hubId: 'clh0000000000000000000000' },
        destination: { hubId: 'clh1111111111111111111111', ...recipient },
      }).success,
    ).toBe(true);
  });
});

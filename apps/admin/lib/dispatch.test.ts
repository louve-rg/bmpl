import { describe, expect, it } from 'vitest';
import {
  addressLines,
  byFewestActiveJobs,
  canAssign,
  canReassign,
  money,
  vehicleSummary,
  type AssignedVehicle,
  type PostalAddress,
} from './dispatch';

/**
 * Characterization tests: these record what the dispatch console does TODAY,
 * not what it arguably should do. Where today's behaviour is surprising it is
 * called out in a comment rather than "corrected" — changing it is a separate,
 * deliberate decision.
 *
 * This is the console that hand-assigns deliveries and reassigns them away from
 * a driver, so the gating rules below are the ones worth locking down.
 */

const address = (over: Partial<PostalAddress> = {}): PostalAddress => ({
  fullName: 'Maya Customer',
  phone: '501-555-0100',
  addressLine1: '12 Front Street',
  addressLine2: null,
  city: 'Belize City',
  district: 'BELIZE',
  ...over,
});

const vehicle = (over: Partial<AssignedVehicle> = {}): AssignedVehicle => ({
  type: 'MOTORCYCLE',
  make: 'Honda',
  model: 'CG125',
  color: 'red',
  licencePlate: 'C-12345',
  ...over,
});

describe('money', () => {
  it('renders minor units as dollars with two decimals', () => {
    expect(money(1000)).toBe('$10.00');
    expect(money(1)).toBe('$0.01');
    expect(money(0)).toBe('$0.00');
  });

  it('shows an em dash rather than $0.00 when there is no amount at all', () => {
    // null and undefined mean "no value"; zero is a real amount and prints.
    expect(money(null)).toBe('—');
    expect(money(undefined)).toBe('—');
  });
});

describe('addressLines', () => {
  it('joins the street lines and leaves city/district to their own rows', () => {
    expect(addressLines(address({ addressLine2: 'Apt 3' }))).toBe('12 Front Street, Apt 3');
    expect(addressLines(address())).toBe('12 Front Street');
  });

  it('falls back to an em dash when there is no address and when there is no street', () => {
    expect(addressLines(null)).toBe('—');
    // A pin-only address has no street line. The town is NOT substituted in
    // here — it is rendered separately — so this row legitimately shows "—".
    expect(addressLines(address({ addressLine1: null, addressLine2: null }))).toBe('—');
  });
});

describe('vehicleSummary', () => {
  it('reads colour, make and model, with the plate after a separator', () => {
    expect(vehicleSummary(vehicle())).toBe('red Honda CG125 · C-12345');
  });

  it('omits the separator when there is no plate, and skips missing parts', () => {
    expect(vehicleSummary(vehicle({ licencePlate: null }))).toBe('red Honda CG125');
    expect(vehicleSummary(vehicle({ color: null, make: null }))).toBe('CG125 · C-12345');
  });

  it('falls back to the vehicle type, then to the word Vehicle', () => {
    expect(vehicleSummary(vehicle({ color: null, make: null, model: null }))).toBe('MOTORCYCLE · C-12345');
    expect(
      vehicleSummary({ type: null, make: null, model: null, color: null, licencePlate: 'C-1' }),
    ).toBe('Vehicle · C-1');
  });

  it('shows an em dash when there is no vehicle', () => {
    expect(vehicleSummary(null)).toBe('—');
  });
});

describe('canAssign / canReassign — who the operator may move', () => {
  it('allows a hand assignment only before anything has been done with the delivery', () => {
    expect(canAssign('PENDING_ASSIGNMENT')).toBe(true);
    for (const s of ['ASSIGNED', 'DRIVER_ACCEPTED', 'PICKED_UP', 'DELIVERED', 'CANCELLED']) {
      expect(canAssign(s)).toBe(false);
    }
  });

  it('allows reassignment only while a driver is attached and the parcel is not yet picked up', () => {
    expect(canReassign('ASSIGNED')).toBe(true);
    expect(canReassign('DRIVER_ACCEPTED')).toBe(true);
    expect(canReassign('DRIVER_DECLINED')).toBe(true);
  });

  it('stops reassignment once the parcel is in the driver’s hands', () => {
    // The invariant that matters: custody has moved, so the console must not
    // silently hand the job to somebody else.
    for (const s of ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']) {
      expect(canReassign(s)).toBe(false);
    }
  });

  it('treats an unknown status as neither assignable nor reassignable', () => {
    // Fail closed: a status this build has never heard of grants no powers.
    expect(canAssign('SOMETHING_NEW')).toBe(false);
    expect(canReassign('SOMETHING_NEW')).toBe(false);
    expect(canAssign('')).toBe(false);
    expect(canReassign('')).toBe(false);
  });

  it('is case sensitive, matching the persisted enum exactly', () => {
    expect(canAssign('pending_assignment')).toBe(false);
    expect(canReassign('assigned')).toBe(false);
  });

  it('never offers assign and reassign at the same time', () => {
    for (const s of ['PENDING_ASSIGNMENT', 'ASSIGNED', 'DRIVER_ACCEPTED', 'DRIVER_DECLINED', 'PICKED_UP']) {
      expect(canAssign(s) && canReassign(s)).toBe(false);
    }
  });
});

describe('byFewestActiveJobs', () => {
  it('sorts the least busy driver first', () => {
    const drivers = [{ activeJobs: 3 }, { activeJobs: 0 }, { activeJobs: 1 }];
    expect([...drivers].sort(byFewestActiveJobs).map((d) => d.activeJobs)).toEqual([0, 1, 3]);
  });

  it('sorts a driver whose load is unknown as if they were idle', () => {
    // NOTE, today's behaviour: null sorts as 0, so a driver whose load the API
    // could not report is offered FIRST, ahead of a driver known to be free.
    // Recorded, not corrected.
    const drivers = [{ activeJobs: 2 }, { activeJobs: null }, { activeJobs: 0 }];
    expect([...drivers].sort(byFewestActiveJobs).map((d) => d.activeJobs)).toEqual([null, 0, 2]);
  });

  it('is a pure comparator that does not mutate its inputs', () => {
    const a = { activeJobs: 5 };
    const b = { activeJobs: 1 };
    byFewestActiveJobs(a, b);
    expect(a.activeJobs).toBe(5);
    expect(b.activeJobs).toBe(1);
  });
});

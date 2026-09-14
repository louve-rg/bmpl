import { describe, expect, it } from 'vitest';
import {
  addressLines,
  byFewestActiveJobs,
  canAssign,
  canReassign,
  manualDispatchNotice,
  money,
  parseDispatchList,
  rowAction,
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

  it('sorts a driver whose load is unknown LAST, never ahead of a known load', () => {
    // This was once a characterization of the opposite: null sorted as 0, so a
    // driver whose load the API could not report was offered FIRST, ahead of a
    // driver known to be free. Unknown must not beat known-zero.
    const drivers = [{ activeJobs: 2 }, { activeJobs: null }, { activeJobs: 0 }];
    expect([...drivers].sort(byFewestActiveJobs).map((d) => d.activeJobs)).toEqual([0, 2, null]);
  });

  it('treats two unknown loads as equal rather than reordering them', () => {
    expect(byFewestActiveJobs({ activeJobs: null }, { activeJobs: null })).toBe(0);
  });

  it('is a pure comparator that does not mutate its inputs', () => {
    const a = { activeJobs: 5 };
    const b = { activeJobs: 1 };
    byFewestActiveJobs(a, b);
    expect(a.activeJobs).toBe(5);
    expect(b.activeJobs).toBe(1);
  });
});

/* ------------------------------------------------------------- BMPL-129 --- */

describe('parseDispatchList', () => {
  const row = { id: 'd1' };

  it('accepts the historical bare array (older API): rows pass through, mode unknown', () => {
    expect(parseDispatchList([row])).toEqual({ rows: [row], automaticDispatch: null });
  });

  it('accepts the BMPL-128 envelope and reads automaticDispatch', () => {
    expect(parseDispatchList({ deliveries: [row], automaticDispatch: false })).toEqual({
      rows: [row],
      automaticDispatch: false,
    });
    expect(parseDispatchList({ items: [row], automaticDispatch: true })).toEqual({
      rows: [row],
      automaticDispatch: true,
    });
  });

  it('never crashes on an empty or malformed payload', () => {
    expect(parseDispatchList(null)).toEqual({ rows: [], automaticDispatch: null });
    expect(parseDispatchList(undefined)).toEqual({ rows: [], automaticDispatch: null });
    expect(parseDispatchList({})).toEqual({ rows: [], automaticDispatch: null });
  });
});

describe('manualDispatchNotice', () => {
  it('names the true holdup when automatic dispatch is off — the sentence an operator acts on', () => {
    expect(manualDispatchNotice(false)).toBe(
      'Automatic dispatch is off — a delivery that is ready to go stays unassigned until an operator assigns a driver by hand.',
    );
  });

  it('shows nothing when automatic dispatch is on or unknown — never claim a mode we have not read', () => {
    expect(manualDispatchNotice(true)).toBeNull();
    expect(manualDispatchNotice(null)).toBeNull();
  });
});

describe('rowAction', () => {
  it('a row waiting on a human says Assign; every other row keeps View', () => {
    expect(rowAction(true)).toBe('Assign');
    expect(rowAction(false)).toBe('View');
    expect(rowAction(undefined)).toBe('View'); // older API rows carry no flag
  });
});

import { describe, expect, it } from 'vitest';
import { audienceForRoles, notificationHref } from './notification-links';

describe('notificationHref — driver', () => {
  const asDriver = (data: Record<string, unknown>, category = 'DELIVERY') =>
    notificationHref({ category, data }, 'DRIVER');

  it('opens the job itself, not a list to search', () => {
    expect(asDriver({ deliveryId: 'del_1' })).toBe('/dashboard/driver/jobs/del_1');
  });

  // Was '/dashboard/driver/profile?section=vehicle', which had no page behind it —
  // a driver clicking "Vehicle approved" landed on a 404. Vehicles now have their
  // own route, so the target is a page that exists.
  it('sends a vehicle decision to the vehicle profile', () => {
    expect(notificationHref({ category: 'ACCOUNT', data: { vehicleId: 'v1' } }, 'DRIVER')).toBe(
      '/dashboard/driver/vehicles',
    );
  });

  it('falls back to the driver profile for other account events', () => {
    expect(notificationHref({ category: 'ACCOUNT', data: {} }, 'DRIVER')).toBe('/dashboard/driver/profile');
  });

  it('opens the earnings ledger for a credited earning', () => {
    expect(asDriver({ earningId: 'e1' })).toBe('/dashboard/driver/earnings');
    expect(notificationHref({ category: 'PAYMENT', data: {} }, 'DRIVER')).toBe('/dashboard/driver/earnings');
  });

  it('opens Application & Documents for a driver application decision', () => {
    expect(
      notificationHref({ category: 'ROLE_APPLICATION', data: { roleCode: 'DELIVERY_DRIVER', applicationId: 'a1' } }, 'DRIVER'),
    ).toBe('/dashboard/driver/documents');
  });

  it('prefers the delivery over anything else in the same payload', () => {
    expect(asDriver({ deliveryId: 'd1', earningId: 'e1', vehicleId: 'v1' })).toBe('/dashboard/driver/jobs/d1');
  });
});

describe('notificationHref — customer', () => {
  it('opens order tracking, which is what the question really is', () => {
    expect(notificationHref({ category: 'DELIVERY', data: { orderId: 'o1' } })).toBe('/orders/o1');
  });

  it('falls back to a delivery-filtered order list when only a delivery is known', () => {
    expect(notificationHref({ category: 'DELIVERY', data: { deliveryId: 'd1' } })).toBe(
      '/orders?delivery=d1',
    );
  });
});

describe('notificationHref — vendor', () => {
  it('opens the vendor order', () => {
    expect(notificationHref({ data: { vendorOrderId: 'vo1' } }, 'VENDOR')).toBe('/dashboard/orders/vo1');
  });
});

describe('notificationHref — no specific target', () => {
  it('returns null rather than dumping the user on a generic dashboard', () => {
    // A broadcast announcement has no entity. Navigating somewhere arbitrary is
    // worse than staying put, so callers treat null as "mark read only".
    expect(notificationHref({ category: 'SYSTEM', data: {} })).toBeNull();
    expect(notificationHref({ category: 'SYSTEM' })).toBeNull();
    expect(notificationHref({ category: 'SYSTEM', data: null })).toBeNull();
  });

  it('ignores non-string ids instead of building a broken URL', () => {
    expect(notificationHref({ data: { orderId: 123 } })).toBeNull();
    expect(notificationHref({ data: { orderId: '' } })).toBeNull();
  });

  it('routes messaging the same way for everyone', () => {
    const n = { category: 'MESSAGE', data: { conversationId: 'c1' } };
    for (const a of ['CUSTOMER', 'VENDOR', 'DRIVER'] as const) {
      expect(notificationHref(n, a)).toBe('/dashboard/messages?conversation=c1');
    }
  });
});

describe('audienceForRoles', () => {
  it('prefers the driver view for delivery work — that is the role with an action', () => {
    // The same account is very often a customer AND a driver. A driver told
    // "new offer" needs the job screen; the customer view only watches progress.
    expect(
      audienceForRoles(['CUSTOMER', 'DELIVERY_DRIVER'], {
        category: 'DELIVERY',
        data: { deliveryId: 'd1' },
      }),
    ).toBe('DRIVER');
  });

  it('treats a driver as a customer for their own shopping orders', () => {
    expect(
      audienceForRoles(['CUSTOMER', 'DELIVERY_DRIVER'], {
        category: 'ORDER',
        data: { orderId: 'o1' },
      }),
    ).toBe('CUSTOMER');
  });

  it('uses the vendor view when the payload names a vendor order', () => {
    expect(audienceForRoles(['CUSTOMER', 'VENDOR'], { data: { vendorOrderId: 'vo1' } })).toBe('VENDOR');
  });

  it('defaults to customer for a plain shopper', () => {
    expect(audienceForRoles(['CUSTOMER'], { category: 'DELIVERY', data: { deliveryId: 'd1' } })).toBe(
      'CUSTOMER',
    );
  });

  it('treats a credited delivery earning as driver business', () => {
    // Settlement files this under DELIVERY with only an earningId, so it used to
    // fall through to CUSTOMER and resolve to no target at all.
    expect(audienceForRoles(['CUSTOMER', 'DELIVERY_DRIVER'], { category: 'DELIVERY', data: { earningId: 'e1' } })).toBe(
      'DRIVER',
    );
  });

  it('routes a driver-application decision to the driver even before approval', () => {
    // These arrive precisely when DELIVERY_DRIVER is not yet an approved role, so
    // gating on the held roles would send the applicant nowhere.
    expect(
      audienceForRoles(['CUSTOMER'], { category: 'ROLE_APPLICATION', data: { roleCode: 'DELIVERY_DRIVER' } }),
    ).toBe('DRIVER');
  });

  it('does not hijack a job-seeker application that happens to carry an applicationId', () => {
    expect(audienceForRoles(['CUSTOMER'], { category: 'JOB', data: { applicationId: 'a1' } })).toBe('CUSTOMER');
  });
});

describe('multi-leg shipping', () => {
  it('sends every customer shipping event to the one tracker', () => {
    // The whole point of the unified view: booked, collected, in transit and
    // ready-to-collect all open the same page, not a page per leg.
    for (const event of ['SHIPMENT_STATUS', 'SHIPMENT_COURIER']) {
      expect(
        notificationHref({ category: 'DELIVERY', event, data: { shipmentId: 's1', reference: 'BMPL-ABCD2345' } }, 'CUSTOMER'),
      ).toBe('/dashboard/shipments/BMPL-ABCD2345');
    }
  });

  it('opens the driver on their own leg, not the shipment', () => {
    expect(
      notificationHref(
        { category: 'DELIVERY', event: 'SHIPMENT_LEG_OFFERED', data: { driverJobId: 'leg1', jobKind: 'FIRST_MILE', reference: 'BMPL-ABCD2345' } },
        'DRIVER',
      ),
    ).toBe('/dashboard/driver/shipping/leg1');
  });

  it('still prefers a marketplace delivery link when both are somehow present', () => {
    // A driver notification carrying both is a bug upstream, but routing to the
    // delivery is the safer of the two: it is the older, more-used path.
    expect(
      notificationHref({ category: 'DELIVERY', data: { deliveryId: 'd1', driverJobId: 'leg1' } }, 'DRIVER'),
    ).toBe('/dashboard/driver/jobs/d1');
  });

  it('escapes a reference rather than trusting it into a URL', () => {
    expect(notificationHref({ data: { reference: 'BMPL /../x' } }, 'CUSTOMER')).toBe(
      '/dashboard/shipments/BMPL%20%2F..%2Fx',
    );
  });
});

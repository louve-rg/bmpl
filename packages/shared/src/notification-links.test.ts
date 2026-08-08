import { describe, expect, it } from 'vitest';
import { audienceForRoles, notificationHref } from './notification-links';

describe('notificationHref — driver', () => {
  const asDriver = (data: Record<string, unknown>, category = 'DELIVERY') =>
    notificationHref({ category, data }, 'DRIVER');

  it('opens the job itself, not a list to search', () => {
    expect(asDriver({ deliveryId: 'del_1' })).toBe('/dashboard/driver/jobs/del_1');
  });

  it('sends a vehicle decision to the vehicle section', () => {
    expect(notificationHref({ category: 'ACCOUNT', data: { vehicleId: 'v1' } }, 'DRIVER')).toBe(
      '/dashboard/driver/profile?section=vehicle',
    );
  });

  it('falls back to the driver profile for other account events', () => {
    expect(notificationHref({ category: 'ACCOUNT', data: {} }, 'DRIVER')).toBe('/dashboard/driver/profile');
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
});

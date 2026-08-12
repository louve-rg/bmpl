import { describe, expect, it } from 'vitest';
import { DELIVERY_STATUSES, type DeliveryStatus } from './dispatch';
import {
  DRIVER_DELIVERY_VIEWS,
  DRIVER_VIEW_STATUSES,
  canReorderQueueItem,
  driverViewForStatus,
  isDriverDeliveryView,
  nextDriverAction,
  queueStopKind,
  reorderBlockedReason,
} from './driver-queue';

const ACCEPTED = new Date('2026-08-01T10:00:00Z');

describe('driverViewForStatus', () => {
  it('splits an outstanding offer from an accepted job on acceptedAt', () => {
    expect(driverViewForStatus('ASSIGNED', null)).toBe('available');
    expect(driverViewForStatus('ASSIGNED', ACCEPTED)).toBe('assigned');
    expect(driverViewForStatus('DRIVER_ACCEPTED', ACCEPTED)).toBe('assigned');
  });

  it('treats every post-pickup, pre-delivery status as active', () => {
    expect(driverViewForStatus('PICKUP_CONFIRMED', ACCEPTED)).toBe('active');
    expect(driverViewForStatus('IN_TRANSIT', ACCEPTED)).toBe('active');
    expect(driverViewForStatus('ARRIVING', ACCEPTED)).toBe('active');
  });

  it('maps DELIVERED to completed', () => {
    expect(driverViewForStatus('DELIVERED', ACCEPTED)).toBe('completed');
  });

  it('shows the driver nothing for statuses that are not their work', () => {
    expect(driverViewForStatus('PENDING_ASSIGNMENT', null)).toBeNull();
    expect(driverViewForStatus('DRIVER_DECLINED', null)).toBeNull();
    expect(driverViewForStatus('CANCELLED', ACCEPTED)).toBeNull();
  });

  it('accepts an ISO string for acceptedAt as well as a Date', () => {
    expect(driverViewForStatus('ASSIGNED', ACCEPTED.toISOString())).toBe('assigned');
  });

  it('only ever returns a declared view', () => {
    for (const status of DELIVERY_STATUSES) {
      for (const accepted of [null, ACCEPTED]) {
        const view = driverViewForStatus(status, accepted);
        if (view !== null) expect(DRIVER_DELIVERY_VIEWS).toContain(view);
      }
    }
  });
});

describe('DRIVER_VIEW_STATUSES', () => {
  it('never narrows out a row the mapping would have placed in that view', () => {
    for (const status of DELIVERY_STATUSES) {
      for (const accepted of [null, ACCEPTED]) {
        const view = driverViewForStatus(status, accepted);
        if (view) expect(DRIVER_VIEW_STATUSES[view]).toContain(status);
      }
    }
  });

  it('contains no status outside the delivery state machine', () => {
    for (const statuses of Object.values(DRIVER_VIEW_STATUSES)) {
      for (const s of statuses) expect(DELIVERY_STATUSES).toContain(s);
    }
  });
});

describe('isDriverDeliveryView', () => {
  it('rejects anything not in the declared set', () => {
    expect(isDriverDeliveryView('active')).toBe(true);
    expect(isDriverDeliveryView('ACTIVE')).toBe(false);
    expect(isDriverDeliveryView('all')).toBe(false);
    expect(isDriverDeliveryView(undefined)).toBe(false);
    expect(isDriverDeliveryView(null)).toBe(false);
  });
});

describe('nextDriverAction', () => {
  it('asks for a decision on an unanswered offer and a collection once accepted', () => {
    expect(nextDriverAction('ASSIGNED', null).kind).toBe('ACCEPT');
    expect(nextDriverAction('ASSIGNED', ACCEPTED).kind).toBe('CONFIRM_PICKUP');
    expect(nextDriverAction('DRIVER_ACCEPTED', ACCEPTED).kind).toBe('CONFIRM_PICKUP');
  });

  it('walks the remaining lifecycle in order', () => {
    expect(nextDriverAction('PICKUP_CONFIRMED', ACCEPTED).kind).toBe('IN_TRANSIT');
    expect(nextDriverAction('IN_TRANSIT', ACCEPTED).kind).toBe('ARRIVING');
    expect(nextDriverAction('ARRIVING', ACCEPTED).kind).toBe('DELIVER');
  });

  it('has nothing to suggest for terminal or unowned states', () => {
    for (const s of ['DELIVERED', 'CANCELLED', 'DRIVER_DECLINED', 'PENDING_ASSIGNMENT'] as DeliveryStatus[]) {
      expect(nextDriverAction(s, ACCEPTED).kind).toBe('NONE');
    }
  });
});

describe('queueStopKind', () => {
  it('routes to the store until the goods are collected, then to the customer', () => {
    expect(queueStopKind('ASSIGNED')).toBe('PICKUP');
    expect(queueStopKind('DRIVER_ACCEPTED')).toBe('PICKUP');
    expect(queueStopKind('PICKUP_CONFIRMED')).toBe('DROPOFF');
    expect(queueStopKind('IN_TRANSIT')).toBe('DROPOFF');
    expect(queueStopKind('ARRIVING')).toBe('DROPOFF');
  });
});

describe('canReorderQueueItem', () => {
  it('refuses an offer the driver has not accepted', () => {
    expect(canReorderQueueItem('ASSIGNED', null)).toBe(false);
    expect(reorderBlockedReason('ASSIGNED', null)).toMatch(/accept this offer/i);
  });

  it('allows accepted work that is still on the road', () => {
    expect(canReorderQueueItem('ASSIGNED', ACCEPTED)).toBe(true);
    expect(canReorderQueueItem('DRIVER_ACCEPTED', ACCEPTED)).toBe(true);
    expect(canReorderQueueItem('PICKUP_CONFIRMED', ACCEPTED)).toBe(true);
    expect(canReorderQueueItem('IN_TRANSIT', ACCEPTED)).toBe(true);
  });

  it('pins a delivery being handed over and anything terminal', () => {
    expect(canReorderQueueItem('ARRIVING', ACCEPTED)).toBe(false);
    expect(canReorderQueueItem('DELIVERED', ACCEPTED)).toBe(false);
    expect(canReorderQueueItem('CANCELLED', ACCEPTED)).toBe(false);
    expect(reorderBlockedReason('ARRIVING', ACCEPTED)).toBeTruthy();
  });

  it('gives no blocked reason when reordering is allowed', () => {
    expect(reorderBlockedReason('DRIVER_ACCEPTED', ACCEPTED)).toBeNull();
  });
});

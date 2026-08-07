import { describe, expect, it } from 'vitest';
import {
  buildDeliveryProgress,
  DELIVERY_PROGRESS_STEPS,
  type DeliveryProgressInput,
} from './delivery-progress';

const T = (min: number) => new Date(Date.UTC(2026, 7, 7, 12, min));

const input = (over: Partial<DeliveryProgressInput> = {}): DeliveryProgressInput => ({
  placedAt: T(0),
  preparingAt: null,
  readyAt: null,
  assignedAt: null,
  acceptedAt: null,
  pickupConfirmedAt: null,
  inTransitAt: null,
  arrivingAt: null,
  deliveredAt: null,
  cancelledAt: null,
  ...over,
});

const stateOf = (entries: ReturnType<typeof buildDeliveryProgress>, step: string) =>
  entries.find((e) => e.step === step)!.state;

describe('buildDeliveryProgress', () => {
  it('always returns every step so the customer can see what is left', () => {
    const entries = buildDeliveryProgress(input());
    expect(entries).toHaveLength(DELIVERY_PROGRESS_STEPS.length);
    expect(entries.map((e) => e.step)).toEqual([...DELIVERY_PROGRESS_STEPS]);
  });

  it('marks a freshly placed order as current at ORDER_PLACED', () => {
    const entries = buildDeliveryProgress(input());
    expect(stateOf(entries, 'ORDER_PLACED')).toBe('CURRENT');
    expect(stateOf(entries, 'PREPARING')).toBe('PENDING');
  });

  it('advances as the vendor works, before any driver exists', () => {
    // The gap this fixes: a paid order being packed used to show nothing at all.
    const entries = buildDeliveryProgress(input({ preparingAt: T(5) }));
    expect(stateOf(entries, 'ORDER_PLACED')).toBe('DONE');
    expect(stateOf(entries, 'PREPARING')).toBe('CURRENT');
    expect(stateOf(entries, 'DRIVER_ASSIGNED')).toBe('PENDING');
  });

  it('treats acceptance, not assignment, as the driver being on the way', () => {
    const offered = buildDeliveryProgress(input({ readyAt: T(9), assignedAt: T(10) }));
    expect(offered.find((e) => e.step === 'DRIVER_ASSIGNED')!.at).toEqual(T(10));

    // Once accepted, the accepted time wins — that is the committed moment.
    const accepted = buildDeliveryProgress(
      input({ readyAt: T(9), assignedAt: T(10), acceptedAt: T(11) }),
    );
    expect(accepted.find((e) => e.step === 'DRIVER_ASSIGNED')!.at).toEqual(T(11));
  });

  it('treats a skipped intermediate step as done rather than leaving a hole', () => {
    // Vendor packs the order without pressing "start preparing", so PREPARING has
    // no timestamp. Progress must sit on READY — and PREPARING reads DONE, not
    // PENDING: reaching a later step implies the earlier one happened, and
    // "Ready for a driver" above "Store preparing: not started" is incoherent.
    // The step keeps a null timestamp, so nothing is fabricated.
    const entries = buildDeliveryProgress(input({ readyAt: T(6) }));
    expect(stateOf(entries, 'PREPARING')).toBe('DONE');
    expect(entries.find((e) => e.step === 'PREPARING')!.at).toBeNull();
    expect(stateOf(entries, 'READY')).toBe('CURRENT');
  });

  it('marks everything done once delivered', () => {
    const entries = buildDeliveryProgress(
      input({
        preparingAt: T(5),
        readyAt: T(6),
        acceptedAt: T(10),
        pickupConfirmedAt: T(15),
        inTransitAt: T(16),
        arrivingAt: T(25),
        deliveredAt: T(30),
      }),
    );
    expect(entries.every((e) => e.state === 'DONE')).toBe(true);
  });

  it('leaves no step CURRENT when cancelled', () => {
    // The caller renders the cancellation, which carries a reason; leaving a step
    // blinking "in progress" would contradict it.
    const entries = buildDeliveryProgress(input({ preparingAt: T(5), cancelledAt: T(7) }));
    expect(entries.some((e) => e.state === 'CURRENT')).toBe(false);
    expect(stateOf(entries, 'PREPARING')).toBe('DONE');
  });
});

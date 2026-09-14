import { describe, expect, it } from 'vitest';
import { deliveryStatusDisplay } from './delivery-stage';

/**
 * BMPL-129 — the customer must never read "Awaiting driver" while the store
 * is still packing. The server names the true stage; the client's only job is
 * to prefer the server's stage sentence when one is given and fall back to
 * the status badge when it is not.
 */
describe('deliveryStatusDisplay', () => {
  it('renders the server stage sentence when a stage is named', () => {
    expect(
      deliveryStatusDisplay({
        status: 'PENDING_ASSIGNMENT',
        stage: 'AWAITING_VENDOR',
        stageLabel: 'Waiting for the store to pack your order',
      }),
    ).toEqual({ kind: 'stage', label: 'Waiting for the store to pack your order' });
  });

  it('falls back to the status badge when the API sends no stage (older API — deploy-window safe)', () => {
    expect(deliveryStatusDisplay({ status: 'PENDING_ASSIGNMENT' })).toEqual({
      kind: 'status',
      status: 'PENDING_ASSIGNMENT',
    });
    expect(deliveryStatusDisplay({ status: 'PENDING_ASSIGNMENT', stage: null, stageLabel: null })).toEqual({
      kind: 'status',
      status: 'PENDING_ASSIGNMENT',
    });
  });

  it('keeps the status badge after dispatch, when the stage is absent', () => {
    for (const status of ['DRIVER_ACCEPTED', 'PICKUP_CONFIRMED', 'IN_TRANSIT', 'ARRIVING', 'DELIVERED', 'CANCELLED']) {
      expect(deliveryStatusDisplay({ status })).toEqual({ kind: 'status', status });
    }
  });

  it('never invents a sentence: a stage without a label falls back to the status', () => {
    expect(deliveryStatusDisplay({ status: 'PENDING_ASSIGNMENT', stage: 'AWAITING_DISPATCH', stageLabel: null })).toEqual(
      { kind: 'status', status: 'PENDING_ASSIGNMENT' },
    );
    expect(deliveryStatusDisplay({ status: 'PENDING_ASSIGNMENT', stage: 'AWAITING_DISPATCH', stageLabel: '' })).toEqual({
      kind: 'status',
      status: 'PENDING_ASSIGNMENT',
    });
  });
});

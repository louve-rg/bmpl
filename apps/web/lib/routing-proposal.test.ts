import { describe, expect, it } from 'vitest';
import { canPrice, confirmLabel, priceUnavailableMessage, proposalHeadline } from './routing-proposal';
import type { RoutingProposal } from './shipping';

function returnProposal(over: Partial<RoutingProposal> = {}): RoutingProposal {
  return {
    kind: 'RETURN',
    legId: 'leg_1',
    note: 'Customer refused delivery.',
    preparedAt: new Date().toISOString(),
    available: true,
    service: 'DOOR_TO_DOOR',
    serviceLabel: 'Door to door',
    serviceDescription: '',
    totalMinor: 4500,
    transportMinutes: 60,
    explanation: '',
    requestedDate: '2026-10-02',
    pricingIncomplete: false,
    pricingNote: null,
    legs: [],
    ...over,
  } as RoutingProposal;
}

describe('canPrice (BMPL-364/375)', () => {
  it('is true for a real, positive, available price', () => {
    expect(canPrice(returnProposal({ totalMinor: 2500 }))).toBe(true);
  });

  it('is false when the planner could not route it at all', () => {
    const p = { kind: 'RETURN', legId: 'l1', note: 'n', preparedAt: 'x', available: false, reason: 'NO_LANE', message: 'No lane.', useLocalDelivery: false, requestedDate: '2026-10-02', dateUnavailable: false, nextAvailableDate: null } as unknown as RoutingProposal;
    expect(canPrice(p)).toBe(false);
  });

  it('is false for a technically-available but zero price — zero is not a price', () => {
    expect(canPrice(returnProposal({ totalMinor: 0, pricingIncomplete: true }))).toBe(false);
  });

  it('never gates on legCostsMoreThanOriginal — every priced reroute confirms the same way', () => {
    expect(canPrice(returnProposal({ kind: 'REROUTE', totalMinor: 1200, legCostsMoreThanOriginal: false }))).toBe(true);
    expect(canPrice(returnProposal({ kind: 'REROUTE', totalMinor: 1200, legCostsMoreThanOriginal: true }))).toBe(true);
  });
});

describe('priceUnavailableMessage', () => {
  it('uses the planner message when the route is unavailable', () => {
    const p = { kind: 'RETURN', legId: 'l1', note: 'n', preparedAt: 'x', available: false, reason: 'NO_LANE', message: 'This leg is still mid-journey.', useLocalDelivery: false, requestedDate: '2026-10-02', dateUnavailable: false, nextAvailableDate: null } as unknown as RoutingProposal;
    expect(priceUnavailableMessage(p)).toBe('This leg is still mid-journey.');
  });

  it('uses the pricing note for a zero-priced but "available" quote', () => {
    expect(priceUnavailableMessage(returnProposal({ totalMinor: 0, pricingNote: 'No courier fee is configured.' }))).toBe(
      'No courier fee is configured.',
    );
  });
});

describe('confirmLabel — states the price out loud, never a bare "Confirm"', () => {
  it('a return names the real amount', () => {
    expect(confirmLabel(returnProposal({ totalMinor: 4575 }))).toBe('Confirm and pay $45.75');
  });

  it('a reroute names the real amount regardless of legCostsMoreThanOriginal', () => {
    expect(confirmLabel(returnProposal({ kind: 'REROUTE', totalMinor: 1200, legCostsMoreThanOriginal: false }))).toBe(
      'Confirm the new address and pay $12.00',
    );
    expect(confirmLabel(returnProposal({ kind: 'REROUTE', totalMinor: 3200, legCostsMoreThanOriginal: true }))).toBe(
      'Confirm the new address and pay $32.00',
    );
  });
});

describe('proposalHeadline', () => {
  it('names the fate plainly', () => {
    expect(proposalHeadline(returnProposal())).toBe('Return this shipment to you');
    expect(proposalHeadline(returnProposal({ kind: 'REROUTE' }))).toBe('Redirect this shipment to a new address');
  });
});

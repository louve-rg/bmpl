import { describe, expect, it } from 'vitest';
import { computeInventoryAdjustment, reasonForMode } from './inventory-adjust';

describe('computeInventoryAdjustment', () => {
  it('adds stock (current + qty)', () => {
    expect(computeInventoryAdjustment('ADD', 5, 15)).toEqual({ delta: 5, result: 20, valid: true });
  });

  it('removes stock without a minus sign (current − qty)', () => {
    expect(computeInventoryAdjustment('REMOVE', 3, 15)).toEqual({ delta: -3, result: 12, valid: true });
  });

  it('sets an exact quantity (delta = target − current)', () => {
    expect(computeInventoryAdjustment('SET', 10, 15)).toEqual({ delta: -5, result: 10, valid: true });
    expect(computeInventoryAdjustment('SET', 0, 5)).toEqual({ delta: -5, result: 0, valid: true }); // set to zero is allowed
  });

  it('blocks reductions that would drive on-hand below zero', () => {
    const r = computeInventoryAdjustment('REMOVE', 20, 15);
    expect(r.valid).toBe(false);
    expect(r.result).toBe(-5);
    expect(r.error).toMatch(/only 15 in stock/i);
  });

  it('rejects no-op adjustments', () => {
    expect(computeInventoryAdjustment('ADD', 0, 15).valid).toBe(false);
    expect(computeInventoryAdjustment('REMOVE', 0, 15).valid).toBe(false);
    expect(computeInventoryAdjustment('SET', 10, 10)).toMatchObject({ delta: 0, valid: false });
  });

  it('rejects malformed quantities', () => {
    expect(computeInventoryAdjustment('ADD', -1, 15).valid).toBe(false);
    expect(computeInventoryAdjustment('ADD', 1.5, 15).valid).toBe(false);
  });

  it('maps each mode to the correct adjustment reason', () => {
    expect(reasonForMode('ADD')).toBe('RESTOCK');
    expect(reasonForMode('REMOVE')).toBe('CORRECTION');
    expect(reasonForMode('SET')).toBe('CORRECTION');
  });
});

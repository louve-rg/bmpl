import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * STATIC GUARDS. These read source text, they do not exercise behaviour. They
 * exist to prove absences (no direct wallet write, no new payment rail) that a
 * behavioural test cannot prove. A behavioural test of the same property would
 * be a false comfort.
 */
const SHIPPING_SERVICES = ['shipment.service.ts', 'shipment-driver.service.ts', 'shipment-dispatch.service.ts'];

const sourceOf = (file: string) => readFileSync(resolve(process.cwd(), 'src/shipping', file), 'utf8');

describe('shipping money boundary (STATIC GUARD, source read)', () => {
  it('STATIC GUARD: no shipping service writes a wallet table or a cached balance directly', () => {
    for (const file of SHIPPING_SERVICES) {
      expect(sourceOf(file), file).not.toMatch(/prisma\.wallet\w*\./);
      expect(sourceOf(file), file).not.toMatch(/cachedBalanceMinor/);
    }
  });

  it('STATIC GUARD: money leaves shipping only through the payments service, and only these three calls', () => {
    const calls = new Set<string>();
    for (const file of SHIPPING_SERVICES) {
      for (const match of sourceOf(file).matchAll(/this\.payments\.(\w+)/g)) calls.add(match[1]!);
    }
    expect([...calls].sort()).toEqual(['createForShipment', 'escrowInTx', 'releaseForShipment']);
  });

  it('STATIC GUARD: shipping imports no payment provider SDK (no new payment rail)', () => {
    for (const file of SHIPPING_SERVICES) {
      expect(sourceOf(file), file).not.toMatch(/from ['"](stripe|@stripe\/[^'"]*|paypal[^'"]*)['"]/i);
    }
  });
});

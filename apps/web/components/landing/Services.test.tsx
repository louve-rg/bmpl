// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { Services } from './Services';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * S2-READINESS: extends the convention Wallet.test.tsx already uses -- the
 * passenger card's "Next departure · 45 min · from BZ$30" row claimed both
 * a scheduled departure and a fare that passenger-operations.service.ts has
 * no code for at all (fareQuotedMinor stays null, zero wallet/escrow code).
 * Bans the shape (any currency figure, the word "departure"), not just the
 * instance, so a future edit can't quietly reintroduce either claim.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function renderPassengerCard(): string {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Services />));
  // Services renders the whole bento (Marketplace's real BZ$ prices and the
  // wallet's real balance sit right next to this card), so the assertions
  // below must scope to the passenger card's own subtree, not the page.
  const heading = Array.from(container.querySelectorAll('h3')).find((h) => h.textContent === 'Passenger Service');
  const card = heading?.closest('article');
  if (!card) throw new Error('Passenger Service card not found');
  return card.textContent ?? '';
}

describe('Services passenger card claims', () => {
  it('never promises a scheduled departure time or a fare for passenger service', () => {
    const text = renderPassengerCard();
    // Guard: prove the card rendered its real content before asserting on what is absent.
    expect(text).toContain('Passenger Service');
    expect(text).toContain('Request seats');
    expect(text).toContain('Confirmed by provider');
    expect(text).not.toMatch(/departure/i);
    expect(text).not.toMatch(/BZ\$\s?\d/);
    expect(text).not.toMatch(/\d+\s*min\b/i);
  });
});

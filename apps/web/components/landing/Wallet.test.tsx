// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { WalletSection } from './Wallet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * S2-WALLET-CLAIMS: extends the convention AccountSummary.test.tsx and
 * DeleteAccountForm.test.tsx already use elsewhere -- the landing page's
 * wallet pitch was simply never covered by it. No payment provider, payout,
 * transfer or bank/withdrawal rail exists anywhere in this system, so none
 * of that language belongs in this section's rendered copy, ever again.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(): string {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<WalletSection />));
  return container.textContent ?? '';
}

describe('WalletSection claims', () => {
  it('never promises a payment, payout, transfer, bank or cash-out rail that does not exist', () => {
    const text = render();
    // Guard: prove the section rendered its real content before asserting on what is absent.
    expect(text).toContain('Escrow Protection');
    expect(text).toContain('Secure Ledger');
    expect(text).toContain('Recent activity');
    expect(text).not.toMatch(/payout/i);
    expect(text).not.toMatch(/withdraw/i);
    expect(text).not.toMatch(/\bbank\b/i);
    expect(text).not.toMatch(/cash.?out/i);
    expect(text).not.toMatch(/\btransfer/i);
  });

  it('does not re-introduce the removed quick-action affordances (Send/Request/Top up/QR)', () => {
    const text = render();
    expect(text).toContain('Recent activity');
    expect(text).not.toMatch(/\bsend\b/i);
    expect(text).not.toMatch(/\brequest\b/i);
    expect(text).not.toMatch(/top.?up/i);
    expect(text).not.toMatch(/\bqr\b/i);
  });
});

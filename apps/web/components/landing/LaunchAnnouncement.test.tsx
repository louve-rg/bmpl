// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { LaunchAnnouncement } from './LaunchAnnouncement';
import { contactMailto } from '../../lib/contact';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * S2-ANNOUNCE homepage block. Pins the owner's required content (company
 * name, "Coming February 2027", the exact tagline) and the hard constraints:
 * no countdown, and the contact CTA is the one shared `contactMailto()`
 * constant (S2-EMAIL, lib/contact.ts) -- never a hardcoded second copy of
 * the address, and never a link to a Contact/About/FAQ page, none of which
 * exist in this app (god's own verified ruling on main).
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<LaunchAnnouncement />));
  return container;
}

describe('LaunchAnnouncement', () => {
  it('renders the required heading, tagline and company name', () => {
    const el = render();
    expect(el.querySelector('#launch-heading')?.textContent).toBe('Coming February 2027');
    expect(el.textContent).toContain('One platform. More possibilities for Belize.');
    expect(el.textContent).toContain('Belize Marketplace & Logistics');
  });

  it('is anchorable at #launch, the target the site-wide bar links to', () => {
    const el = render();
    expect(el.querySelector('section#launch')).not.toBeNull();
  });

  it('gives a working contact CTA, not a dead or unmocked signup form', () => {
    const el = render();
    expect(el.querySelector('form')).toBeNull();
    const links = Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toContain(contactMailto('Belize Marketplace & Logistics launch'));
  });

  it('renders no countdown timer', () => {
    const el = render();
    expect(el.textContent).not.toMatch(/\d+\s*(days?|hours?|minutes?|seconds?)\s*(left|remaining)?/i);
  });

  it('previews the same four service names Services.tsx uses one section down', () => {
    const el = render();
    for (const label of ['Marketplace', 'Shipping & Delivery', 'Passenger Service', 'Platform Wallet']) {
      expect(el.textContent).toContain(label);
    }
  });
});

// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { Footer } from './Footer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * P3 defect fix: the footer's "Platform" links pointed at "/#services" or a
 * dead "#". MDF-110 finished the job: every remaining dead link is either a real
 * destination or removed. Privacy and Terms stay as "#" on purpose: they are
 * owner-gated legal pages, not ours to create or point anywhere.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(): Map<string, string> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Footer />));
  const links = new Map<string, string>();
  container.querySelectorAll('a').forEach((a) => links.set(a.textContent ?? '', a.getAttribute('href') ?? ''));
  return links;
}

describe('Footer links', () => {
  it('points the Platform links at real destinations, not the landing anchor', () => {
    const links = render();
    // Guard: prove the footer rendered before asserting on what is absent.
    expect(links.get('Marketplace')).toBe('/products');
    expect(links.get('Shipping')).toBe('/shipping');
    expect(links.get('Passenger')).toBe('/dashboard/passenger');
    expect(links.get('Jobs')).toBe('/jobs');
    expect(links.get('Real Estate')).toBe('/properties');
  });

  it('does not render the parked gaps (Marketing, Help Center) as dead links', () => {
    const links = render();
    expect(links.get('Marketplace')).toBe('/products');
    expect(links.has('Marketing')).toBe(false);
    expect(links.has('Help Center')).toBe(false);
  });

  it('removes the Company, Resources and legal-bar links that have no BMPL page behind them', () => {
    const links = render();
    expect(links.get('Marketplace')).toBe('/products');
    for (const gap of ['About', 'Careers', 'Press', 'Blog', 'Developers', 'API', 'Status', 'Accessibility', 'Security', 'Sitemap']) {
      expect(links.has(gap), gap).toBe(false);
    }
  });

  it('keeps Contact, pointed at the support address the product already publishes', () => {
    const links = render();
    expect(links.get('Contact')).toBe('mailto:support@bzemarketplace.com');
  });

  it('leaves Privacy and Terms as the only "#" links, both owner-gated', () => {
    const links = render();
    expect(links.get('Marketplace')).toBe('/products');
    const dead = [...links].filter(([, href]) => href === '#').map(([label]) => label);
    expect([...new Set(dead)].sort()).toEqual(['Privacy', 'Terms']);
  });

  it('shows no social icons, because no BMPL account is verified in the repo', () => {
    render();
    expect(container!.querySelector('a[aria-label="LinkedIn"], a[aria-label="Facebook"], a[aria-label="Instagram"], a[aria-label="YouTube"]')).toBeNull();
  });
});

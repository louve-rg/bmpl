// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { Footer } from './Footer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * P3 defect fix: the footer's "Platform" links pointed at "/#services" or a
 * dead "#", and "Help Center" was a dead "#". Each link now either goes to a
 * real destination or is removed (Marketing and Help Center have no customer
 * page; they are named gaps, not stubs).
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
});

// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { LaunchAnnouncementBar } from './LaunchAnnouncementBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * S2-ANNOUNCE: a static launch-month strip, not operational state (see the
 * component's own comment vs. AnnouncementBanner.tsx). Pins the content the
 * owner required and the two hard constraints: no exact day/countdown, and
 * the learn-more link resolves to the homepage's real announcement section,
 * never a dead "#".
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
  act(() => root!.render(<LaunchAnnouncementBar />));
  return container;
}

describe('LaunchAnnouncementBar', () => {
  it('states the launch month, not a specific day', () => {
    const el = render();
    expect(el.textContent).toContain('Coming February 2027');
    expect(el.textContent).not.toMatch(/February \d{1,2},? 2027/);
  });

  it('renders no countdown timer (no digit-only day/hour/minute/second fields)', () => {
    const el = render();
    expect(el.querySelectorAll('[data-countdown]').length).toBe(0);
    expect(el.textContent).not.toMatch(/\d+\s*(days?|hours?|minutes?|seconds?)/i);
  });

  it('points "learn more" at the homepage launch section, not a dead anchor', () => {
    const el = render();
    const link = el.querySelector('a');
    expect(link?.textContent).toBe('learn more');
    expect(link?.getAttribute('href')).toBe('/#launch');
  });
});

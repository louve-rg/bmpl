// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// react-dom's act() checks this flag; see StorefrontView.test.tsx / LocationPicker.test.tsx
// for the same convention (no @testing-library/react dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'job1' }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Same minimal fake as LocationPicker.test.tsx / the established precedent for
// a component that dynamically import()s leaflet inside a useEffect — a real
// browser dependency jsdom doesn't provide, mocked rather than loaded.
vi.mock('leaflet', () => {
  function fakeMap() {
    return {
      setView: vi.fn(),
      on: vi.fn(),
      getZoom: vi.fn(() => 13),
      invalidateSize: vi.fn(),
      remove: vi.fn(),
      fitBounds: vi.fn(),
      dragging: { enable: vi.fn(), disable: vi.fn() },
    };
  }
  const L = {
    map: vi.fn(() => fakeMap()),
    tileLayer: vi.fn(() => ({ addTo: vi.fn().mockReturnThis() })),
    divIcon: vi.fn(() => ({})),
    marker: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), on: vi.fn().mockReturnThis(), remove: vi.fn() })),
    latLngBounds: vi.fn(() => ({})),
  };
  return { default: L };
});
vi.mock('leaflet/dist/leaflet.css', () => ({}));

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('../../../../../lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
}));

const { default: DriverShippingJobPage } = await import('./page');

function place(over: Partial<{ address: string | null; pinnedLocation: { latitude: number; longitude: number } | null }> = {}) {
  return {
    kind: 'ADDRESS' as const,
    name: 'Sender',
    phone: null,
    address: '1 Market Sq',
    area: 'Belize City',
    instructions: null,
    navigationUrl: null,
    pinnedLocation: null,
    ...over,
  };
}

function shippingJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job1',
    jobKind: 'FIRST_MILE',
    reference: 'BML-ABCD2345',
    status: 'DRIVER_ACCEPTED',
    statusLabel: 'Accepted',
    nextActionLabel: 'Confirm pickup',
    modeLabel: 'Road',
    addressUnlocked: true,
    pickup: place({ pinnedLocation: { latitude: 17.5, longitude: -88.2 } }),
    dropoff: place({ pinnedLocation: { latitude: 17.6, longitude: -88.3 } }),
    routeStops: [place({ pinnedLocation: { latitude: 17.5, longitude: -88.2 } }), place({ pinnedLocation: { latitude: 17.6, longitude: -88.3 } })],
    parcel: { description: 'A box', pieces: 1, weightGrams: null },
    feeMinor: 2500,
    handoffCodeHeldBy: 'the recipient',
    offerExpiresAt: null,
    pinAttemptsRemaining: 5,
    ...overrides,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  apiGet.mockReset();
  apiPost.mockReset();
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<DriverShippingJobPage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

/**
 * BMPL-349/350: ShippingJob.routeStops is optional on the web type — web and
 * api deploy independently, so there is a real window where this GET returns
 * a 200 with the key simply not there yet. Proven with a real missing key
 * (JSON round-trip + delete), same technique as StorefrontView.test.tsx.
 */
describe('DriverShippingJobPage — route map (BMPL-349/350)', () => {
  it('renders the route map normally when routeStops has real pins', async () => {
    apiGet.mockResolvedValue(shippingJob());
    const el = await mount();
    expect(el.textContent).toContain('BML-ABCD2345');
  });

  it('SHIP-C: labels a stop by matching this leg\'s own pickup/dropoff pin, not by its position in the whole-shipment route', async () => {
    // An extra hub ahead of this leg's own two points, belonging to a
    // different leg of the same shipment — must read as "Via", never as
    // this driver's own "Collect", even though it sits first in the array.
    const otherLegHub = place({ pinnedLocation: { latitude: 16.0, longitude: -89.0 } });
    apiGet.mockResolvedValue(
      shippingJob({
        routeStops: [
          otherLegHub,
          place({ pinnedLocation: { latitude: 17.5, longitude: -88.2 } }),
          place({ pinnedLocation: { latitude: 17.6, longitude: -88.3 } }),
        ],
      }),
    );
    const el = await mount();
    // The legend only renders once the map is revealed (lazy by default).
    const showMap = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Show map');
    await act(async () => {
      showMap!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(el.textContent).toMatch(/Via: Sender/);
    expect(el.textContent).toMatch(/Collect: Sender/);
    expect(el.textContent).toMatch(/Deliver: Sender/);
  });

  it('does not crash when routeStops is missing from the wire entirely', async () => {
    const raw = JSON.parse(JSON.stringify(shippingJob())) as Record<string, unknown>;
    delete raw.routeStops;
    apiGet.mockResolvedValue(raw);

    let threw = false;
    try {
      await mount();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(container!.textContent).toContain('BML-ABCD2345');
  });
});

/**
 * SHIP-B/SHIP-C: availabilityWindows is "HH:MM" Belize-local wall-clock
 * strings, never a timestamp — must render as given, never through `Date`.
 * An overnight window (endTime < startTime) is legal and must read clearly,
 * not as an invalid or empty range. The server already scopes the array to
 * the role(s) that govern THIS leg, so the page only needs to split
 * SENDER -> pickup block / RECIPIENT -> dropoff block.
 */
describe('DriverShippingJobPage — availability windows (SHIP-C)', () => {
  it('shows the pickup window beside Collect from, scoped to SENDER', async () => {
    apiGet.mockResolvedValue(
      shippingJob({ availabilityWindows: [{ role: 'SENDER', startTime: '08:00', endTime: '12:00' }] }),
    );
    const el = await mount();
    expect(el.textContent).toMatch(/Pickup Window: 8:00 AM–12:00 PM/);
  });

  it('shows an overnight window clearly rather than as an invalid range', async () => {
    apiGet.mockResolvedValue(
      shippingJob({ availabilityWindows: [{ role: 'SENDER', startTime: '22:00', endTime: '02:00' }] }),
    );
    const el = await mount();
    expect(el.textContent).toMatch(/Pickup Window: 10:00 PM–2:00 AM \(overnight\)/);
  });

  it('a RECIPIENT window appears beside Deliver to, never beside Collect from', async () => {
    apiGet.mockResolvedValue(
      shippingJob({ availabilityWindows: [{ role: 'RECIPIENT', startTime: '09:00', endTime: '17:00' }] }),
    );
    const el = await mount();
    const text = el.textContent ?? '';
    const collectIndex = text.indexOf('Collect from');
    const deliverIndex = text.indexOf('Deliver to');
    const availableIndex = text.indexOf('Delivery Window: 9:00 AM–5:00 PM');
    expect(availableIndex).toBeGreaterThan(deliverIndex);
    expect(availableIndex).toBeGreaterThan(collectIndex);
    // Nothing window-shaped sits between the two blocks (i.e. on pickup).
    expect(text.slice(collectIndex, deliverIndex)).not.toMatch(/Pickup Window:|Delivery Window:/);
  });

  it('renders nothing extra when no window was set — "attempt at any time" stays silent, not an empty line', async () => {
    apiGet.mockResolvedValue(shippingJob());
    const el = await mount();
    expect(el.textContent).not.toMatch(/Pickup Window:|Delivery Window:/);
  });

  it('does not crash when availabilityWindows is missing from the wire entirely', async () => {
    const raw = JSON.parse(JSON.stringify(shippingJob())) as Record<string, unknown>;
    delete raw.availabilityWindows;
    apiGet.mockResolvedValue(raw);

    let threw = false;
    try {
      await mount();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(container!.textContent).toContain('BML-ABCD2345');
  });
});

/**
 * SHIP-B Bug 1 (owner ruling, conv-7ffab9): address/pin are no longer
 * withheld pre-acceptance on this leg's own door end — only name/phone stay
 * gated, tracked by the new `contactUnlocked`. `addressUnlocked` stays true
 * for this leg's own ends but is still the only signal an OLDER api deploy
 * sends, so the page must fall back to it when `contactUnlocked` is absent.
 */
describe('DriverShippingJobPage — name/phone gate uses contactUnlocked, not addressUnlocked (SHIP-B Bug 1)', () => {
  it('shows the name/phone caption when contactUnlocked is false, even though addressUnlocked is true', async () => {
    apiGet.mockResolvedValue(shippingJob({ addressUnlocked: true, contactUnlocked: false }));
    const el = await mount();
    expect(el.textContent).toMatch(/The name and phone number appear once you accept\./);
    expect(el.textContent).not.toMatch(/address and phone number/);
  });

  it('hides the caption once contactUnlocked is true', async () => {
    apiGet.mockResolvedValue(shippingJob({ addressUnlocked: true, contactUnlocked: true }));
    const el = await mount();
    expect(el.textContent).not.toMatch(/appear once you accept/);
  });

  it('falls back to addressUnlocked when contactUnlocked is absent from the wire (pre-fix API)', async () => {
    const raw = JSON.parse(JSON.stringify(shippingJob({ addressUnlocked: false }))) as Record<string, unknown>;
    delete raw.contactUnlocked;
    apiGet.mockResolvedValue(raw);
    const el = await mount();
    expect(el.textContent).toMatch(/appear once you accept/);
  });
});

/**
 * SHIP-B Bug 1 / SHIP-H: the route-map caption used to key off
 * `addressUnlocked`, which meant "some stop is still area-only" only because
 * every door end was gated alike. Now this driver's own two ends are always
 * unlocked, so the caption must check the actual OTHER-leg stop instead, or
 * it would go silently stale (claim a stop is hidden when it is actually
 * shown, or stay silent about one that genuinely still is).
 *
 * SHIP-H (owner QA, conv-24e312) also caught that the caption's wording — not
 * just its gate — was stale: "until you accept" implied this driver's own
 * acceptance would eventually reveal the other leg's door. On current main
 * it never does; `mine` in the api's `addressPlace` is structural (which leg
 * this is), not acceptance-based, so a different leg's door stays area-only
 * regardless of what this driver does. The caption now says that instead.
 */
describe('DriverShippingJobPage — route map "other end" caption tracks the actual stop, not addressUnlocked (SHIP-B Bug 1 / SHIP-H)', () => {
  it('shows the caption when an other-leg stop is still area-only, even though addressUnlocked is true', async () => {
    // A genuinely hidden stop has neither a pin nor an address — same as
    // today's real server shape for a door end this driver has no claim to.
    const hiddenOtherLegDoor = place({ address: null, pinnedLocation: null });
    apiGet.mockResolvedValue(
      shippingJob({
        addressUnlocked: true,
        routeStops: [
          hiddenOtherLegDoor,
          place({ pinnedLocation: { latitude: 17.5, longitude: -88.2 } }),
          place({ pinnedLocation: { latitude: 17.6, longitude: -88.3 } }),
        ],
      }),
    );
    const el = await mount();
    expect(el.textContent).toMatch(/The other end belongs to a different leg — only its area is ever shown here\./);
    // Must not revert to promising a reveal this driver's own acceptance can never cause.
    expect(el.textContent).not.toMatch(/until you accept/);
  });

  it('hides the caption once every route stop has a real address, even if addressUnlocked were false and a stop has no pin', async () => {
    // A stop with no pin is dropped from the map's visible points (so
    // points.length < routeStops.length is true, same shape as a genuinely
    // hidden stop) — but its address IS present, so this is not a hidden
    // stop, and the caption must stay silent rather than keying off the pin.
    const unpinnedButRevealed = place({ pinnedLocation: null });
    apiGet.mockResolvedValue(
      shippingJob({
        addressUnlocked: false,
        routeStops: [unpinnedButRevealed, place({ pinnedLocation: { latitude: 17.5, longitude: -88.2 } })],
      }),
    );
    const el = await mount();
    expect(el.textContent).not.toMatch(/belongs to a different leg/);
  });
});

/**
 * MDF-560: the API requires a collection code (`requiresPickupPin`) on a
 * leg that genuinely starts at a door, but the screen only ever rendered a
 * code field for handoff — a driver confirming pickup on such a leg had no
 * field to put the code in, so the click was stuck (server 400 "Enter the
 * collection code."). `requiresPickupPin` is additive/optional on the wire,
 * same reasoning as `legStatus`/`routeStops` above.
 */
describe('DriverShippingJobPage — pickup needs its own collection code (MDF-560)', () => {
  it('renders a collection-code field for pickup when requiresPickupPin is true, with no "who took it" field', async () => {
    apiGet.mockResolvedValue(shippingJob({ status: 'DRIVER_ACCEPTED', requiresPickupPin: true }));
    const el = await mount();

    expect(el.textContent).toContain('Collection code');
    expect(el.textContent).toContain('Ask the sender for the collection code');
    expect(el.textContent).not.toContain('Who took it');
    expect(el.querySelector('#code')).not.toBeNull();
    expect(el.querySelector('#who')).toBeNull();
  });

  it('posts only the pin for a pickup confirmation, never receivedByName', async () => {
    apiGet.mockResolvedValue(shippingJob({ status: 'DRIVER_ACCEPTED', requiresPickupPin: true }));
    apiPost.mockResolvedValue(undefined);
    const el = await mount();

    const input = el.querySelector('#code') as HTMLInputElement;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      nativeInputValueSetter.call(input, '1234');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Confirm pickup')!;
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiPost).toHaveBeenCalledWith('/driver/shipping-jobs/job1/pickup', { pin: '1234' });
  });

  it('shows no code field for pickup when requiresPickupPin is false — the click completes with an empty body, as before', async () => {
    apiGet.mockResolvedValue(shippingJob({ status: 'DRIVER_ACCEPTED', requiresPickupPin: false }));
    apiPost.mockResolvedValue(undefined);
    const el = await mount();

    expect(el.textContent).not.toContain('Collection code');
    expect(el.querySelector('#code')).toBeNull();

    const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Confirm pickup')!;
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiPost).toHaveBeenCalledWith('/driver/shipping-jobs/job1/pickup', {});
  });

  it('shows no code field for pickup when requiresPickupPin is absent from the wire (older/degraded response)', async () => {
    const raw = JSON.parse(JSON.stringify(shippingJob({ status: 'DRIVER_ACCEPTED' }))) as Record<string, unknown>;
    delete raw.requiresPickupPin;
    apiGet.mockResolvedValue(raw);
    const el = await mount();

    expect(el.textContent).not.toContain('Collection code');
    expect(el.querySelector('#code')).toBeNull();
  });

  it('still asks for both the code and who took it at handoff, unchanged', async () => {
    apiGet.mockResolvedValue(shippingJob({ status: 'ARRIVING', nextActionLabel: 'Confirm handoff' }));
    const el = await mount();

    expect(el.textContent).toContain('Finish the handover');
    expect(el.textContent).toContain('Handover code');
    expect(el.textContent).toContain('Who took it');
    expect(el.querySelector('#who')).not.toBeNull();
  });
});

/**
 * MDF-96 / Edward req 10 — the courier-facing screen for an endpoint
 * (POST /driver/shipping-jobs/:id/report-issue) that already existed, worked
 * and was correctly restricted server-side, but had zero references anywhere
 * in apps/web. This is the button's own regression guard.
 */
describe('DriverShippingJobPage — report an issue (MDF-96)', () => {
  it('shows "Report an issue" once the driver actually holds the parcel (IN_TRANSIT)', async () => {
    apiGet.mockResolvedValue(shippingJob({ status: 'IN_TRANSIT', nextActionLabel: 'Mark as arriving' }));
    const el = await mount();
    expect(el.textContent).toContain('Report an issue');
  });

  it('hides "Report an issue" before pickup (ASSIGNED) — nothing attempted yet', async () => {
    apiGet.mockResolvedValue(shippingJob({ status: 'ASSIGNED', nextActionLabel: 'Accept' }));
    const el = await mount();
    expect(el.textContent).not.toContain('Report an issue');
  });

  it('hides "Report an issue" once the leg is terminal (DELIVERED)', async () => {
    apiGet.mockResolvedValue(shippingJob({ status: 'DELIVERED', nextActionLabel: null }));
    const el = await mount();
    expect(el.textContent).not.toContain('Report an issue');
  });

  it('declining the prompt never calls the API', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    apiGet.mockResolvedValue(shippingJob({ status: 'IN_TRANSIT', nextActionLabel: 'Mark as arriving' }));
    const el = await mount();
    const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Report an issue')!;
    await act(async () => {
      button.click();
    });
    expect(apiPost).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it('a reason under 4 characters never calls the API', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('no');
    apiGet.mockResolvedValue(shippingJob({ status: 'IN_TRANSIT', nextActionLabel: 'Mark as arriving' }));
    const el = await mount();
    const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Report an issue')!;
    await act(async () => {
      button.click();
    });
    expect(apiPost).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it('reporting posts the reason, shows the confirmation, and hides the primary action — this screen stops offering it, without claiming more than the system does', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Nobody answered at the address');
    apiGet.mockResolvedValue(shippingJob({ status: 'IN_TRANSIT', nextActionLabel: 'Mark as arriving' }));
    apiPost.mockResolvedValue(undefined);

    const el = await mount();
    expect(el.textContent).toContain('Mark as arriving');

    const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Report an issue')!;
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiPost).toHaveBeenCalledWith('/driver/shipping-jobs/job1/report-issue', { reason: 'Nobody answered at the address' });
    expect(el.textContent).toContain('Issue reported');
    expect(el.textContent).toContain('Nobody answered at the address');
    expect(el.textContent).not.toContain('Mark as arriving');
    expect(el.textContent).not.toContain('Report an issue');
    promptSpy.mockRestore();
  });

  /**
   * god, conv-mission-2026-10-13: Jim found the courier status machine has
   * no check against EXCEPTION at all, so "this delivery is on hold" was a
   * promise nothing in the backend keeps -- same overclaim class #385's own
   * gate exists to catch. Permanent guard against that specific wording
   * ever coming back, not just a happy-path assertion.
   */
  it('never claims the delivery is "on hold" — the backend does not enforce that', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Nobody answered at the address');
    apiGet.mockResolvedValue(shippingJob({ status: 'IN_TRANSIT', nextActionLabel: 'Mark as arriving' }));
    apiPost.mockResolvedValue(undefined);

    const el = await mount();
    const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Report an issue')!;
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(el.textContent).toContain('our team has been notified and will review it');
    expect(el.textContent?.toLowerCase()).not.toContain('on hold');
    promptSpy.mockRestore();
  });

  it('does not invent a refund, fee or timeframe in the confirmation copy', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Could not find the recipient');
    apiGet.mockResolvedValue(shippingJob({ status: 'IN_TRANSIT', nextActionLabel: 'Mark as arriving' }));
    apiPost.mockResolvedValue(undefined);

    const el = await mount();
    const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Report an issue')!;
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = el.textContent!.toLowerCase();
    expect(text).not.toMatch(/refund|fee|within \d|hours?\b.*(credit|refund)/);
    promptSpy.mockRestore();
  });
});

/**
 * Owner ruling (god, conv-mission-2026-10-13): an active delivery exception
 * blocks further courier progression until staff resolve it — in apps/api's
 * own guard AND here. `legStatus` is additive on the wire (see
 * isExceptionBlocked in lib/driver-shipping-job.ts); these prove both states.
 */
describe('DriverShippingJobPage — an open exception blocks progression (owner ruling)', () => {
  it('hides the primary action and explains why, once legStatus is EXCEPTION', async () => {
    apiGet.mockResolvedValue(shippingJob({ status: 'IN_TRANSIT', nextActionLabel: 'Mark as arriving', legStatus: 'EXCEPTION' }));
    const el = await mount();

    expect(el.textContent).not.toContain('Mark as arriving');
    expect(el.textContent).toContain('This leg has an open issue');
    expect(el.textContent).toContain('Nothing can move forward until our team resolves it.');
  });

  it('never states a timeframe or a promise about what happens next', async () => {
    apiGet.mockResolvedValue(shippingJob({ status: 'IN_TRANSIT', nextActionLabel: 'Mark as arriving', legStatus: 'EXCEPTION' }));
    const el = await mount();

    const text = el.textContent!.toLowerCase();
    expect(text).not.toMatch(/within \d|\d+\s*(hours?|days?|minutes?)|will be (resolved|reopened)|refund|fee/);
  });

  it('shows the normal primary action when legStatus is absent (additive field not arrived yet)', async () => {
    const raw = JSON.parse(JSON.stringify(shippingJob({ status: 'IN_TRANSIT', nextActionLabel: 'Mark as arriving' }))) as Record<string, unknown>;
    delete raw.legStatus;
    apiGet.mockResolvedValue(raw);
    const el = await mount();

    expect(el.textContent).toContain('Mark as arriving');
    expect(el.textContent).not.toContain('This leg has an open issue');
  });

  it('shows the normal primary action when legStatus is a non-exception value', async () => {
    apiGet.mockResolvedValue(shippingJob({ status: 'IN_TRANSIT', nextActionLabel: 'Mark as arriving', legStatus: 'IN_PROGRESS' }));
    const el = await mount();

    expect(el.textContent).toContain('Mark as arriving');
    expect(el.textContent).not.toContain('This leg has an open issue');
  });
});

/**
 * Resolved 2026-10-14, reconciling this PR (#393) against #398: report-issue
 * calls `flagException`, which the backend refuses outright once a leg is
 * already EXCEPTION (`isLegActionable`, packages/shared/src/shipping.ts) —
 * so it is one of the controls the EXCEPTION-blocks-progression rule exists
 * to hide, not an exception to it. Neither PR's own test set proved this
 * combined behaviour on its own.
 */
/**
 * A driver whose leg was reassigned, expired, or no longer belongs to them
 * (404) was stranded: the Alert rendered, but the back link lived INSIDE the
 * `{job && (...)}` block, which never renders when the job failed to load.
 */
describe('DriverShippingJobPage — a 404 never strands the driver (MDF-nav2)', () => {
  it('shows a working link back to available jobs when the job is no longer theirs', async () => {
    apiGet.mockRejectedValue({ status: 404, message: 'Not found' });
    const el = await mount();

    expect(el.textContent).toContain('This job is no longer yours.');
    const link = Array.from(el.querySelectorAll('a')).find((a) => a.textContent === 'Back to my deliveries');
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toBe('/dashboard/driver/jobs');
  });

  it('does not show the stranded-state back link once the job loads normally', async () => {
    apiGet.mockResolvedValue(shippingJob());
    const el = await mount();

    expect(el.textContent).not.toContain('This job is no longer yours.');
  });
});

/**
 * MDF-717 (god/Stanley, live walkthrough): a FIRST_MILE driver who accepted,
 * passed the pickup code, started the trip and arrived at the terminal hit
 * a dead end — nothing showed him the handoff code he is supposed to
 * present, and the copy told him to go ask the terminal staff for it
 * instead, backwards from how TERM-5's reveal (GET
 * /driver/shipping-jobs/:id/code) and the terminal's own Hand off card are
 * both built: the courier presents, the staff verifies. These tests use a
 * synthetic fixture code, never a value from a live system.
 */
describe('DriverShippingJobPage — the courier sees his own handoff code at a terminal (MDF-717)', () => {
  const FIXTURE_CODE = 'TEST-CODE-0007';

  it('fetches and shows the courier his own code on a FIRST_MILE leg at ARRIVING, with show-this-code copy', async () => {
    apiGet.mockImplementation((path: string) =>
      path.endsWith('/code')
        ? Promise.resolve({ kind: 'handoff', code: FIXTURE_CODE, attempts: 5 })
        : Promise.resolve(shippingJob({ status: 'ARRIVING', jobKind: 'FIRST_MILE', nextActionLabel: 'Confirm handoff' })),
    );
    const el = await mount();

    expect(apiGet).toHaveBeenCalledWith('/driver/shipping-jobs/job1/code');
    expect(el.textContent).toContain('Show this code to the terminal staff');
    expect(el.textContent).toContain(FIXTURE_CODE);
    // The old, backwards sentence must be gone for this exact case.
    expect(el.textContent).not.toContain('Ask the terminal staff for the code');
  });

  it('still tells a LAST_MILE driver to ask the recipient for their own code at ARRIVING — unchanged, never the driver\'s own code', async () => {
    apiGet.mockImplementation((path: string) =>
      path.endsWith('/code')
        ? Promise.resolve({ kind: 'pickup', code: FIXTURE_CODE, attempts: 5 })
        : Promise.resolve(
            shippingJob({ status: 'ARRIVING', jobKind: 'LAST_MILE', handoffCodeHeldBy: 'the person receiving it', nextActionLabel: 'Confirm handoff' }),
          ),
    );
    const el = await mount();

    expect(el.textContent).toContain('Ask the person receiving it for the code and enter it here.');
    expect(el.textContent).not.toContain('Show this code to the terminal staff');
    expect(el.textContent).not.toContain(FIXTURE_CODE);
  });

  it('does not fetch the courier code before ARRIVING — nothing to present yet', async () => {
    apiGet.mockResolvedValue(shippingJob({ status: 'IN_TRANSIT', jobKind: 'FIRST_MILE', nextActionLabel: 'Mark as arriving' }));
    await mount();

    expect(apiGet).not.toHaveBeenCalledWith('/driver/shipping-jobs/job1/code');
  });

  it('falls back to a plain placeholder, never a crash, when the code fetch fails', async () => {
    apiGet.mockImplementation((path: string) =>
      path.endsWith('/code')
        ? Promise.reject({ status: 403, message: 'You are not the courier assigned to this leg.' })
        : Promise.resolve(shippingJob({ status: 'ARRIVING', jobKind: 'FIRST_MILE', nextActionLabel: 'Confirm handoff' })),
    );

    let threw = false;
    try {
      await mount();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(container!.textContent).toContain('Show this code to the terminal staff');
  });
});

describe('DriverShippingJobPage — report-issue is itself blocked during an open exception', () => {
  it('hides "Report an issue" once legStatus is EXCEPTION, even while courierStatus is still reportable', async () => {
    apiGet.mockResolvedValue(shippingJob({ status: 'IN_TRANSIT', nextActionLabel: 'Mark as arriving', legStatus: 'EXCEPTION' }));
    const el = await mount();

    expect(el.textContent).toContain('This leg has an open issue');
    expect(el.textContent).not.toContain('Report an issue');
  });

  it('still shows "Report an issue" when legStatus is a non-exception value', async () => {
    apiGet.mockResolvedValue(shippingJob({ status: 'IN_TRANSIT', nextActionLabel: 'Mark as arriving', legStatus: 'IN_PROGRESS' }));
    const el = await mount();

    expect(el.textContent).toContain('Report an issue');
  });
});

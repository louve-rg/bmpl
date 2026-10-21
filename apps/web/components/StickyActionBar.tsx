'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * The fixed action bar pinned to the bottom of a long form on a phone (e.g.
 * "Pay & book shipment") -- its own literal opaque surface regardless of
 * theme, same reasoning as `FormCard` (components/ui.tsx), for the same
 * reason: it must stay legible over whatever scrolls under it.
 *
 * `z-30` and `isolate` are the stacking-context half of the fix, not the
 * padding: a Leaflet map embedded earlier on the same page paints its own
 * panes (markers, popups, controls) at z-index up to 700, and a `position:
 * fixed`/`sticky` element with no z-index of its own does not automatically
 * out-rank that. `isolate` here is defence in depth -- the map's own
 * container is where that containment actually belongs (see
 * LocationPicker's `mapBox`) -- but a shared action bar is also exactly the
 * kind of element a future page might stack a map underneath without
 * knowing to think about it, so it carries its own floor too.
 *
 * `env(safe-area-inset-bottom)` keeps the button clear of an iPhone's home
 * indicator -- `max()` so it never loses the bar's own minimum padding on a
 * device that reports no inset at all (desktop browsers, older phones). Set
 * through a CSS variable and consumed by a `pb-[...]` utility rather than an
 * inline `style`, specifically so a caller's own `sm:pb-0` (e.g. collapsing
 * to a plain static footer on desktop, as the booking page does) can still
 * win at that breakpoint -- an inline style always beats a class, which
 * would otherwise leave desktop stuck with a phantom bottom gap no `sm:`
 * override could remove.
 *
 * SPACE RESERVATION (MDF-376): a `fixed` element is out of flow by
 * definition, so without this the page simply scrolls underneath it --
 * whatever happens to land at the viewport's bottom edge stays covered, with
 * no way to scroll further and clear it once nothing else exists below.
 * Reproduced live on /dashboard/shipments/new: the "Collect from" map and,
 * via the browser's own focus-triggered scrollIntoView, the required
 * street-address input. Two different mechanisms, two fixes, both scoped to
 * whichever caller is ACTUALLY rendering `position: fixed` right now --
 * read from `getComputedStyle`, not from the `sticky` prop, because a caller
 * can (and the booking page does) override to `sm:static` at a breakpoint,
 * at which point the bar already participates in flow and reserving space
 * for it a second time would just add a phantom gap:
 *   1. A sibling spacer div, exactly the bar's own measured height, so the
 *      last thing on the page can always be scrolled clear of it -- this is
 *      the same job the booking page's own `pb-28` used to hand-guess, now
 *      exact and automatic (and that guess is removed from the page).
 *   2. `scroll-padding-bottom` on the scrolling root, equal to the bar's
 *      height, so the one case a spacer alone cannot reach -- the browser
 *      scrolling a focused field into view on its own -- stops short of the
 *      bar instead of landing a field's bottom few px behind it.
 * `sticky` mode (the driver job screen) needs neither: a sticky element
 * already reserves its own space in flow, confirmed by rendering (not just
 * reading the keyword) -- measured 115px+ of clearance at every width
 * tested, no fix needed there.
 */
export function StickyActionBar({
  sticky = false,
  className = '',
  children,
}: {
  /** `sticky` for a bar inside a normal scrolling page (no viewport-fixed
   * behaviour needed); the default `fixed` pins it to the viewport even
   * while the rest of the page scrolls underneath -- the right choice for
   * a long one-page form where the price and the button must stay reachable
   * without scrolling back down. */
  sticky?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [spacerHeight, setSpacerHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const previousScrollPadding = root.style.scrollPaddingBottom;

    const sync = () => {
      // Computed position, not the `sticky` prop: a caller's own responsive
      // override (e.g. `sm:static`) can take the bar out of `fixed` mode at
      // a breakpoint the prop itself knows nothing about.
      const isFixed = getComputedStyle(el).position === 'fixed';
      const height = isFixed ? el.offsetHeight : 0;
      setSpacerHeight(height);
      root.style.scrollPaddingBottom = isFixed ? `${height}px` : previousScrollPadding;
    };

    sync();

    // MDF-376: ResizeObserver is absent in some environments (jsdom in this
    // app's own unit tests; conceivably a locked-down browser) -- this bar
    // sits on /dashboard/shipments/new, a route that takes payments, so it
    // must degrade to the one-time static measurement above rather than
    // throw at mount.
    if (typeof ResizeObserver === 'undefined') {
      return () => {
        root.style.scrollPaddingBottom = previousScrollPadding;
      };
    }

    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.scrollPaddingBottom = previousScrollPadding;
    };
  }, []);

  return (
    <>
      {/* Fully opaque, no backdrop-blur -- this bar's own call sites rely on it
          being a LITERAL opaque surface regardless of theme (see e.g.
          dashboard/driver/shipping/[id]/page.tsx's comment on this component).
          It previously painted at /95 with backdrop-blur: on a /dashboard glass
          route there is no opaque ancestor between this bar and .bml-mural
          (#0a1526), so the 5% gap let the dark mural bleed through -- confirmed
          real, not hypothetical, by computed style: text-red-600 on the
          resulting rgb(242,242,242)-ish composite measured 4.31:1, below 4.5.
          --bmpl-oncolor-light-bg is documented opaque-by-construction; using it
          at less than full opacity was the bug. */}
      <div
        ref={ref}
        className={`${sticky ? 'sticky' : 'fixed inset-x-0'} isolate z-30 bottom-0 border-t border-[color:var(--bmpl-oncolor-light-border)] bg-[color:var(--bmpl-oncolor-light-bg)] px-3 pt-3 pb-[max(0.75rem,var(--bmpl-safe-bottom,0px))] ${className}`}
        style={{ '--bmpl-safe-bottom': 'env(safe-area-inset-bottom)' } as CSSProperties}
      >
        {children}
      </div>
      <div aria-hidden style={{ height: spacerHeight }} />
    </>
  );
}

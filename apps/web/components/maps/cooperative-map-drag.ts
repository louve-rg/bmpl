import type * as LeafletNS from 'leaflet';

/**
 * An embedded map sits inside a scrollable page, but Leaflet's own touch-drag
 * handler (`dragging`, backed by L.Draggable) listens to touchstart/touchmove
 * directly and repositions the map pane in its own JavaScript. That is not the
 * "default action" the container's `touchAction: 'pan-y'` CSS suppresses --
 * touch-action only governs the browser's own default touch handling, not a
 * library's own listeners -- so the CSS alone never stops a one-finger swipe
 * from panning the map instead of scrolling the page. Observed in Chromium
 * with `hasTouch` at 375px: a one-finger swipe on the embedded map pans the
 * map and the page does not scroll at all, before this fix.
 *
 * The web-standard shape for an embedded map in a scrollable page: one finger
 * scrolls the page, two fingers position the map. Leaflet 1.9 has no built-in
 * option for this, so this wires it by hand with Leaflet's own public
 * `dragging.enable()`/`disable()` -- exactly the mechanism that already
 * governs single-pointer panning. Two-finger pinch AND two-finger pan both go
 * through the separate, always-on `touchZoom` handler (Map.TouchZoom.js
 * computes a centre-point delta from the two touch points independently of
 * `dragging` -- read directly from the Leaflet 1.9.4 source, not assumed), so
 * toggling `dragging` never touches that path: a two-finger drag keeps
 * working, observed live, whether or not this fix is enabled.
 *
 * Recomputed from the CURRENT touch count on every touchstart/touchmove/
 * touchend/touchcancel, never incremented or decremented, so a lifted finger,
 * a second finger joining mid-gesture, or an interrupted gesture (an incoming
 * call, the OS taking over -- touchcancel) can never leave `dragging` stuck
 * in the wrong state: whatever the event, the rule is the same -- exactly one
 * active touch means dragging off, anything else (zero or two-plus) means
 * dragging on.
 */
export function attachCooperativeMapDrag(map: LeafletNS.Map, container: HTMLElement): () => void {
  const sync = (e: TouchEvent) => {
    if (e.touches.length === 1) map.dragging.disable();
    else map.dragging.enable();
  };
  container.addEventListener('touchstart', sync, { passive: true });
  container.addEventListener('touchend', sync, { passive: true });
  container.addEventListener('touchcancel', sync, { passive: true });
  return () => {
    container.removeEventListener('touchstart', sync);
    container.removeEventListener('touchend', sync);
    container.removeEventListener('touchcancel', sync);
    map.dragging.enable();
  };
}

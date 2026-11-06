/**
 * Formatting shared between the sender's own availability-window editor
 * (components/shipping/AvailabilityWindows.tsx) and the driver's read-only
 * view of the same windows (SHIP-C) — extracted rather than re-implemented,
 * since a second copy of this is exactly how the pin-only address defect
 * started (root CLAUDE.md §2).
 *
 * `startTime`/`endTime` are bare "HH:MM" wall-clock strings (Belize local),
 * never timestamps — see packages/shared/src/availability-windows.ts. They
 * must never be put through `Date`/`toLocaleTimeString`: doing so invents a
 * calendar date and then reinterprets the string under the VIEWER's own
 * timezone, which is wrong on any device not already set to Belize time.
 * Parsed and printed as plain numbers instead.
 */

export interface AvailabilityWindowRow {
  startTime: string;
  endTime: string;
}

/** "HH:MM" (24h) -> "H:MM AM/PM". */
export function formatClock(hhmm: string): string {
  const parts = hhmm.split(':');
  const h = Number(parts[0] ?? 0);
  const m = Number(parts[1] ?? 0);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Overnight (e.g. 22:00-02:00) is a legitimate, deliberately-supported shape
 * — packages/shared/src/availability-windows.ts's own `isAvailable` handles
 * the wraparound comparison; this only ever describes it, never refuses or
 * hides it.
 */
export function formatWindow(w: AvailabilityWindowRow): string {
  const overnight = w.endTime < w.startTime;
  return `${formatClock(w.startTime)}–${formatClock(w.endTime)}${overnight ? ' (overnight)' : ''}`;
}

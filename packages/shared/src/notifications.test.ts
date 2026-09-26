import { describe, expect, it } from 'vitest';
import { NOTIFICATION_EVENTS } from './notifications';

/**
 * BMPL-219: nine event codes were emitted in production (promotions + shipping)
 * without ever being added here — the catalog was wrong, not the emitted code.
 * The protected state is catalog membership itself, asserted directly rather
 * than inferred from a passing typecheck (`event` is a plain string column
 * with no type-level enumeration, so the compiler cannot catch a missing or a
 * wrong entry — only this assertion can).
 */
describe('NOTIFICATION_EVENTS catalog includes every code production actually emits (BMPL-219)', () => {
  it('lists the promotion codes', () => {
    expect(NOTIFICATION_EVENTS).toContain('PROMOTION_REPORTED');
    expect(NOTIFICATION_EVENTS).toContain('PROMOTION_SUBMITTED');
    expect(NOTIFICATION_EVENTS).toContain('PROMOTION_MODERATED');
  });

  it('lists the shipping codes', () => {
    expect(NOTIFICATION_EVENTS).toContain('SHIPMENT_LEG_OFFERED');
    expect(NOTIFICATION_EVENTS).toContain('SHIPMENT_LEG_DISPATCH_EXHAUSTED');
    expect(NOTIFICATION_EVENTS).toContain('SHIPMENT_COURIER');
    expect(NOTIFICATION_EVENTS).toContain('SHIPMENT_LEG_CANCELLED');
    expect(NOTIFICATION_EVENTS).toContain('SHIPMENT_EXCEPTION');
    expect(NOTIFICATION_EVENTS).toContain('SHIPMENT_STATUS');
  });

  it('has no duplicate entries', () => {
    expect(new Set(NOTIFICATION_EVENTS).size).toBe(NOTIFICATION_EVENTS.length);
  });
});

/**
 * Where a notification should take you when you click it.
 *
 * Notifications already carry a structured `data` payload — `{ orderId,
 * deliveryId, vendorOrderId, … }` — but nothing consumed it: clicking marked the
 * item read and left you where you were. A driver told "New delivery offer" then
 * had to go and find the delivery themselves.
 *
 * Pure and framework-free so the same rules serve the bell, the notifications
 * page and (later) push handling, and so the mapping is unit-testable without a
 * browser.
 *
 * SECURITY: this resolves a *route*, never permission. Every target is an
 * ordinary authorized page — a recipient who cannot view the entity gets that
 * page's normal 403/404. The resolver never encodes anything secret, and a
 * notification the user should not have received cannot become access by being
 * clicked.
 */

/** The audience whose routes we are resolving. Same event, different pages. */
export type NotificationAudience = 'CUSTOMER' | 'VENDOR' | 'DRIVER';

export interface NotificationLinkInput {
  category?: string | null;
  event?: string | null;
  data?: Record<string, unknown> | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/**
 * Resolve a click target, or null when there is nothing specific to open.
 *
 * Returning null is a real answer: a broadcast announcement has no entity, and
 * sending the user to a generic dashboard would be a worse outcome than leaving
 * them where they are. Callers treat null as "mark read only".
 */
export function notificationHref(
  n: NotificationLinkInput,
  audience: NotificationAudience = 'CUSTOMER',
): string | null {
  const d = (n.data ?? {}) as Record<string, unknown>;
  const deliveryId = str(d.deliveryId);
  const vendorOrderId = str(d.vendorOrderId);
  const orderId = str(d.orderId);
  const vehicleId = str(d.vehicleId);
  const conversationId = str(d.conversationId);
  const earningId = str(d.earningId);
  // Multi-leg shipping. A shipment is tracked by its customer-facing reference,
  // not its id, so that is what the link carries; a courier leg opens the
  // driver's own job screen for that leg.
  const shipmentReference = str(d.reference);
  const driverJobId = str(d.driverJobId);
  // A DELIVERY_DRIVER role application. Keyed on roleCode, not on the presence of
  // an applicationId: job applications carry that key too, and routing a Belize
  // Connect notification to the driver documents page would be worse than not
  // routing it at all.
  const isDriverApplication = str(d.roleCode) === 'DELIVERY_DRIVER';

  // Messaging is unambiguous across audiences — the thread is the thread.
  if (conversationId) return `/dashboard/messages?conversation=${conversationId}`;

  if (audience === 'DRIVER') {
    // A driver's delivery notification is always about work they must act on,
    // so it opens the job itself rather than a list they then have to search.
    if (deliveryId) return `/dashboard/driver/jobs/${deliveryId}`;
    // A shipment courier leg is a different record on a different route, so it
    // cannot reuse the delivery link above.
    if (driverJobId) return `/dashboard/driver/shipping/${driverJobId}`;
    // A vehicle approval/rejection is about one vehicle, and the vehicle profile
    // is where its status and rejection reason live.
    if (vehicleId) return '/dashboard/driver/vehicles';
    // Money events open the earnings ledger. There is no per-earning page, so a
    // specific earningId still resolves to the list that contains it rather than
    // to a route that would 404.
    if (earningId || n.category === 'PAYMENT') return '/dashboard/driver/earnings';
    // A document problem (expired licence, missing registration) and an
    // application decision are both handled from Application & Documents.
    if (isDriverApplication || n.category === 'ROLE_APPLICATION') return '/dashboard/driver/documents';
    // Everything else about the account — profile photo moderation above all —
    // belongs on the driver profile, where the photo and its status are shown.
    if (n.category === 'ACCOUNT') return '/dashboard/driver/profile';
    return null;
  }

  if (audience === 'VENDOR') {
    if (vendorOrderId) return `/dashboard/orders/${vendorOrderId}`;
    if (deliveryId) return '/dashboard/delivery';
    return null;
  }

  // CUSTOMER. Order tracking is the page that answers "where is my thing?",
  // which is what every delivery-stage notification is really asking.
  if (orderId) return `/orders/${orderId}`;
  if (vendorOrderId) return `/orders/${vendorOrderId}`;
  if (deliveryId) return `/orders?delivery=${deliveryId}`;
  // Every shipping event — booked, collected, in transit, ready to collect —
  // opens the ONE tracker. The whole point of the unified view is that the
  // customer never needs a different page per leg.
  if (shipmentReference) return `/dashboard/shipments/${encodeURIComponent(shipmentReference)}`;
  return null;
}

/**
 * Best audience for a recipient holding these roles.
 *
 * A single account is frequently a customer AND a driver, and the same delivery
 * event means different things to each. Driver wins when the notification is
 * about delivery work, because that is the role with an action attached; a
 * customer reading the same event only needs to watch progress.
 */
export function audienceForRoles(
  roleCodes: readonly string[],
  n: NotificationLinkInput,
): NotificationAudience {
  const d = (n.data ?? {}) as Record<string, unknown>;
  const isDriverRole = roleCodes.includes('DELIVERY_DRIVER');
  const isVendorRole = roleCodes.includes('VENDOR');

  if (isDriverRole && n.category === 'DELIVERY' && str(d.deliveryId)) return 'DRIVER';
  if (isDriverRole && n.category === 'ACCOUNT' && str(d.vehicleId)) return 'DRIVER';
  // "Earning credited" is filed under DELIVERY and carries only an earningId, so
  // it fell through to CUSTOMER and opened nothing. Money a driver was paid is
  // unambiguously driver business.
  if (isDriverRole && str(d.earningId)) return 'DRIVER';
  // A decision on the DELIVERY_DRIVER role application belongs to the driver even
  // while the role itself is still PENDING — which is precisely when these arrive.
  if (str(d.roleCode) === 'DELIVERY_DRIVER') return 'DRIVER';
  if (isVendorRole && str(d.vendorOrderId)) return 'VENDOR';
  return 'CUSTOMER';
}

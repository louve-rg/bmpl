/** Notification TYPE (legacy top-level enum; kept for back-compat). Mirrors the
 *  Prisma `NotificationType` enum. New code should also set a `NotificationCategory`. */
export const NOTIFICATION_TYPES = [
  'ACCOUNT',
  'ROLE_APPLICATION',
  'ROLE_STATUS',
  'SECURITY',
  'SYSTEM',
  'MARKETPLACE',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'PUSH'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Notification CATEGORY (M16) — the module-aligned taxonomy the notification
 * center filters by. Every notification event carries exactly one category.
 */
export const NOTIFICATION_CATEGORIES = [
  'ORDER',
  'PAYMENT',
  'DELIVERY',
  'DRIVER',
  'VENDOR',
  'ACCOUNT',
  'ROLE_APPLICATION',
  'ADMIN_ALERT',
  'SECURITY',
  'MESSAGE',
  'SYSTEM',
  'JOB',
  'PROPERTY',
  'PROMOTION',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Human labels for the notification center filter chips. */
export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  ORDER: 'Orders',
  PAYMENT: 'Payments',
  DELIVERY: 'Delivery',
  DRIVER: 'Driver',
  VENDOR: 'Vendor',
  ACCOUNT: 'Account',
  ROLE_APPLICATION: 'Applications',
  ADMIN_ALERT: 'Admin alerts',
  SECURITY: 'Security',
  MESSAGE: 'Messages',
  SYSTEM: 'System',
  JOB: 'Jobs',
  PROPERTY: 'Real Estate',
  PROMOTION: 'Marketing',
};

/** Categories surfaced in the ADMIN notification center. */
export const ADMIN_NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = ['ADMIN_ALERT', 'SECURITY'];

/** Default category for a legacy `NotificationType` when a caller doesn't set one. */
export const NOTIFICATION_TYPE_TO_CATEGORY: Record<NotificationType, NotificationCategory> = {
  ACCOUNT: 'ACCOUNT',
  ROLE_APPLICATION: 'ROLE_APPLICATION',
  ROLE_STATUS: 'ROLE_APPLICATION',
  SECURITY: 'SECURITY',
  SYSTEM: 'SYSTEM',
  MARKETPLACE: 'ORDER',
};

/**
 * Canonical machine event keys (the `event` column). Stable identifiers a client
 * can switch on for deep-linking/icons, independent of the display copy.
 */
export const NOTIFICATION_EVENTS = [
  // customer / order + payment + delivery
  'ORDER_PLACED',
  'ORDER_CANCELLED',
  'PAYMENT_AUTHORIZED',
  'DELIVERY_DRIVER_ASSIGNED',
  'DELIVERY_DRIVER_ACCEPTED',
  'DELIVERY_PICKUP_CONFIRMED',
  'DELIVERY_IN_TRANSIT',
  'DELIVERY_ARRIVING',
  'DELIVERY_DELIVERED',
  'DELIVERY_CANCELLED',
  'DELIVERY_PROOF_AVAILABLE',
  // vendor
  'VENDOR_NEW_ORDER',
  'VENDOR_APPROVED',
  'VENDOR_REJECTED',
  'PRODUCT_MODERATED',
  // driver
  'DRIVER_NEW_ASSIGNMENT',
  'DRIVER_ASSIGNMENT_CANCELLED',
  'DRIVER_REASSIGNED',
  'DRIVER_DELIVERY_COMPLETED',
  'DRIVER_VEHICLE_MODERATED',
  // account / roles
  'ROLE_STATUS_CHANGED',
  'ROLE_MORE_INFO_REQUESTED',
  // admin alerts
  'ADMIN_VENDOR_APPLICATION',
  'ADMIN_ROLE_APPLICATION',
  'ADMIN_ORDER_EXCEPTION',
  'ADMIN_FAILED_DELIVERY',
  'ADMIN_SECURITY_ALERT',
  // messaging (M17)
  'MESSAGE_RECEIVED',
  'MESSAGE_ATTACHMENT',
  'SUPPORT_RESPONSE',
  'CONVERSATION_CLOSED',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

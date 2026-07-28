/** Notification categories. Mirrors Prisma `NotificationType` enum. */
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

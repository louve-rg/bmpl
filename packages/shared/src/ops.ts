/**
 * Platform Operations (Phase 4 · M23) — shared vocabulary for the ops console +
 * announcement/maintenance banner. The banner is DISPLAY-ONLY: maintenanceMode is an
 * informational notice surfaced in the UI, never an API gate.
 */

export const ANNOUNCEMENT_LEVELS = ['INFO', 'WARNING', 'CRITICAL'] as const;
export type AnnouncementLevel = (typeof ANNOUNCEMENT_LEVELS)[number];

/** The keys of the aggregated operations action-queue overview. */
export const OPS_QUEUE_KEYS = [
  'pendingVendorApplications',
  'pendingProductModeration',
  'pendingDriverVehicles',
  'pendingRoleApplications',
  'moreInfoRoleApplications',
  'openReviewReports',
  'openSupportCases',
  'failedSettlements',
  'deliveriesPendingAssignment',
  'awaitingPickupCollection',
  'pendingJobModeration',
  'openJobReports',
  'pendingPropertyModeration',
  'openPropertyReports',
  'suspendedUsers',
  'suspendedRoles',
] as const;
export type OpsQueueKey = (typeof OPS_QUEUE_KEYS)[number];

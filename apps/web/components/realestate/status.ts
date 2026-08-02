import type { PropertyStatus, PropertyEnquiryStatus, ViewingRequestStatus } from '@bmpl/shared';
import type { Tone } from '../ui';

/** Branded tone for each property-listing status. */
export const PROPERTY_STATUS_TONE: Record<PropertyStatus, Tone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'info',
  MORE_INFO_REQUIRED: 'warning',
  APPROVED: 'success',
  PUBLISHED: 'success',
  REJECTED: 'error',
  SUSPENDED: 'error',
  UNDER_OFFER: 'warning',
  SOLD: 'neutral',
  RENTED: 'neutral',
  WITHDRAWN: 'neutral',
  ARCHIVED: 'neutral',
};

/** Branded tone for each enquiry status. */
export const ENQUIRY_STATUS_TONE: Record<PropertyEnquiryStatus, Tone> = {
  OPEN: 'info',
  RESPONDED: 'success',
  CLOSED: 'neutral',
};

/** Branded tone for each viewing-request status. */
export const VIEWING_STATUS_TONE: Record<ViewingRequestStatus, Tone> = {
  REQUESTED: 'info',
  PROPOSED: 'warning',
  CONFIRMED: 'success',
  RESCHEDULED: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  DECLINED: 'error',
  NO_SHOW: 'error',
};

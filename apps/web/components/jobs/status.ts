import type { JobApplicationStatus, JobStatus, InterviewMode, InterviewStatus } from '@bmpl/shared';
import type { Tone } from '../ui';

/** Branded tone for each application-pipeline status. */
export const APPLICATION_STATUS_TONE: Record<JobApplicationStatus, Tone> = {
  SUBMITTED: 'info',
  UNDER_REVIEW: 'info',
  SHORTLISTED: 'brand',
  INTERVIEW_REQUESTED: 'warning',
  INTERVIEW_SCHEDULED: 'warning',
  OFFER_EXTENDED: 'success',
  HIRED: 'success',
  REJECTED: 'error',
  WITHDRAWN: 'neutral',
};

/** Branded tone for each job-listing status. */
export const JOB_STATUS_TONE: Record<JobStatus, Tone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'info',
  MORE_INFO_REQUIRED: 'warning',
  APPROVED: 'success',
  PUBLISHED: 'success',
  REJECTED: 'error',
  CLOSED: 'neutral',
  ARCHIVED: 'neutral',
  SUSPENDED: 'error',
};

export const INTERVIEW_MODE_LABELS: Record<InterviewMode, string> = {
  IN_PERSON: 'In person',
  PHONE: 'Phone',
  VIDEO: 'Video',
};

export const INTERVIEW_STATUS_LABELS: Record<InterviewStatus, string> = {
  SCHEDULED: 'Scheduled',
  RESCHEDULED: 'Rescheduled',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

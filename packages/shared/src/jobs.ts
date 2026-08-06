/**
 * Belize Connect — Jobs & Employment (Phase 5 · M24) shared vocabulary.
 * Single source of truth for enum values + human labels so the API, web, and admin
 * never drift. Framework-free.
 */

export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY', 'INTERNSHIP', 'SEASONAL', 'APPRENTICESHIP', 'VOLUNTEER'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  FULL_TIME: 'Full time', PART_TIME: 'Part time', CONTRACT: 'Contract', TEMPORARY: 'Temporary',
  INTERNSHIP: 'Internship', SEASONAL: 'Seasonal', APPRENTICESHIP: 'Apprenticeship', VOLUNTEER: 'Volunteer',
};

export const WORK_ARRANGEMENTS = ['ONSITE', 'HYBRID', 'REMOTE'] as const;
export type WorkArrangement = (typeof WORK_ARRANGEMENTS)[number];
export const WORK_ARRANGEMENT_LABELS: Record<WorkArrangement, string> = { ONSITE: 'On-site', HYBRID: 'Hybrid', REMOTE: 'Remote' };

export const EXPERIENCE_LEVELS = ['ENTRY', 'JUNIOR', 'MID', 'SENIOR', 'LEAD', 'EXECUTIVE'] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];
export const EXPERIENCE_LEVEL_LABELS: Record<ExperienceLevel, string> = {
  ENTRY: 'Entry level', JUNIOR: 'Junior', MID: 'Mid level', SENIOR: 'Senior', LEAD: 'Lead', EXECUTIVE: 'Executive',
};

export const EDUCATION_LEVELS = ['NONE', 'PRIMARY', 'SECONDARY', 'VOCATIONAL', 'ASSOCIATE', 'BACHELOR', 'MASTER', 'DOCTORATE'] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];
export const EDUCATION_LEVEL_LABELS: Record<EducationLevel, string> = {
  NONE: 'No requirement', PRIMARY: 'Primary', SECONDARY: 'Secondary', VOCATIONAL: 'Vocational',
  ASSOCIATE: 'Associate', BACHELOR: "Bachelor's", MASTER: "Master's", DOCTORATE: 'Doctorate',
};

export const SALARY_PERIODS = ['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];
export const SALARY_PERIOD_LABELS: Record<SalaryPeriod, string> = { HOUR: 'per hour', DAY: 'per day', WEEK: 'per week', MONTH: 'per month', YEAR: 'per year' };

export const SALARY_VISIBILITIES = ['HIDDEN', 'RANGE', 'EXACT'] as const;
export type SalaryVisibility = (typeof SALARY_VISIBILITIES)[number];

export const JOB_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'APPROVED', 'PUBLISHED', 'REJECTED', 'CLOSED', 'ARCHIVED', 'SUSPENDED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  DRAFT: 'Draft', SUBMITTED: 'Submitted', UNDER_REVIEW: 'Under review', MORE_INFO_REQUIRED: 'More info needed',
  APPROVED: 'Approved', PUBLISHED: 'Published', REJECTED: 'Rejected', CLOSED: 'Closed', ARCHIVED: 'Archived', SUSPENDED: 'Suspended',
};
/** Statuses that appear on public job surfaces. */
export const PUBLIC_JOB_STATUSES: readonly JobStatus[] = ['PUBLISHED'];

export const JOB_APPLICATION_METHODS = ['INTERNAL', 'EXTERNAL_URL', 'EMAIL'] as const;
export type JobApplicationMethod = (typeof JOB_APPLICATION_METHODS)[number];

export const JOB_APPLICATION_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW_REQUESTED', 'INTERVIEW_SCHEDULED', 'OFFER_EXTENDED', 'HIRED', 'REJECTED', 'WITHDRAWN'] as const;
export type JobApplicationStatus = (typeof JOB_APPLICATION_STATUSES)[number];
export const JOB_APPLICATION_STATUS_LABELS: Record<JobApplicationStatus, string> = {
  SUBMITTED: 'Submitted', UNDER_REVIEW: 'Under review', SHORTLISTED: 'Shortlisted', INTERVIEW_REQUESTED: 'Interview requested',
  INTERVIEW_SCHEDULED: 'Interview scheduled', OFFER_EXTENDED: 'Offer extended', HIRED: 'Hired', REJECTED: 'Not selected', WITHDRAWN: 'Withdrawn',
};

/**
 * Legal application-status transitions (employer-driven unless noted). WITHDRAWN is
 * applicant-only and reachable from any non-terminal state (handled separately). This
 * is the single source of truth for the pipeline; the service enforces it.
 */
export const JOB_APPLICATION_TRANSITIONS: Record<JobApplicationStatus, JobApplicationStatus[]> = {
  SUBMITTED: ['UNDER_REVIEW', 'SHORTLISTED', 'REJECTED'],
  UNDER_REVIEW: ['SHORTLISTED', 'REJECTED'],
  SHORTLISTED: ['INTERVIEW_REQUESTED', 'OFFER_EXTENDED', 'REJECTED'],
  INTERVIEW_REQUESTED: ['INTERVIEW_SCHEDULED', 'OFFER_EXTENDED', 'REJECTED'],
  INTERVIEW_SCHEDULED: ['OFFER_EXTENDED', 'REJECTED'],
  OFFER_EXTENDED: ['HIRED', 'REJECTED'],
  HIRED: [],
  REJECTED: [],
  WITHDRAWN: [],
};
/** Terminal application states — no further employer transitions. */
export const TERMINAL_APPLICATION_STATUSES: readonly JobApplicationStatus[] = ['HIRED', 'REJECTED', 'WITHDRAWN'];
export const isActiveApplicationStatus = (s: JobApplicationStatus): boolean => !TERMINAL_APPLICATION_STATUSES.includes(s);
/** Whether an employer may move an application from → to (validates the pipeline). */
export const canTransitionApplication = (from: JobApplicationStatus, to: JobApplicationStatus): boolean =>
  (JOB_APPLICATION_TRANSITIONS[from] ?? []).includes(to);

export const JOB_QUESTION_TYPES = ['SHORT_TEXT', 'LONG_TEXT', 'YES_NO', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'NUMBER', 'DATE'] as const;
export type JobQuestionType = (typeof JOB_QUESTION_TYPES)[number];

export const JOB_SEEKER_VISIBILITIES = ['PRIVATE', 'EMPLOYERS_ONLY', 'PUBLIC_SUMMARY'] as const;
export type JobSeekerVisibility = (typeof JOB_SEEKER_VISIBILITIES)[number];

export const SEEKER_EMPLOYMENT_STATUSES = ['OPEN_TO_WORK', 'EMPLOYED', 'UNEMPLOYED', 'STUDENT', 'NOT_LOOKING'] as const;
export type SeekerEmploymentStatus = (typeof SEEKER_EMPLOYMENT_STATUSES)[number];

export const INTERVIEW_MODES = ['IN_PERSON', 'PHONE', 'VIDEO'] as const;
export type InterviewMode = (typeof INTERVIEW_MODES)[number];
export const INTERVIEW_STATUSES = ['SCHEDULED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED'] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export const JOB_REPORT_REASONS = ['SCAM', 'MISLEADING', 'DISCRIMINATION', 'ILLEGAL', 'PRIVACY', 'DUPLICATE', 'EXPIRED', 'OTHER'] as const;
export type JobReportReason = (typeof JOB_REPORT_REASONS)[number];
export const JOB_REPORT_STATUSES = ['OPEN', 'ACTIONED', 'DISMISSED'] as const;
export type JobReportStatus = (typeof JOB_REPORT_STATUSES)[number];

/** Résumé/document upload constraints (PDF/DOCX only; private bucket). */
export const RESUME_MIME_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] as const;
export type ResumeMime = (typeof RESUME_MIME_TYPES)[number];
export const isAllowedResumeMime = (m: string): m is ResumeMime => (RESUME_MIME_TYPES as readonly string[]).includes(m);
export const MAX_RESUME_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Sniff a résumé's REAL type from its magic bytes, for server-side uploads where a
 * client-declared Content-Type must never be trusted.
 *
 * PDF is a plain signature check. DOCX is an OOXML package — a ZIP archive — so the
 * ZIP signature alone would also match .xlsx, .pptx, .jar or any renamed .zip. We
 * additionally require the archive to name a `word/` part, which is what makes an
 * OOXML package specifically a WordprocessingML document. Returns null otherwise, so
 * the caller rejects the upload.
 */
export function sniffResumeMime(bytes: Uint8Array): ResumeMime | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 // "%PDF"
  ) {
    return 'application/pdf';
  }
  // "PK\x03\x04" — a ZIP local file header, the container OOXML uses.
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
  ) {
    // Entry names are stored uncompressed in the archive's headers, so "word/"
    // appears as literal bytes in a DOCX and not in xlsx/pptx/plain zips.
    const needle = [0x77, 0x6f, 0x72, 0x64, 0x2f]; // "word/"
    const limit = Math.min(bytes.length, 64 * 1024) - needle.length;
    for (let i = 0; i <= limit; i += 1) {
      let hit = true;
      for (let j = 0; j < needle.length; j += 1) {
        if (bytes[i + j] !== needle[j]) {
          hit = false;
          break;
        }
      }
      if (hit) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
  }
  return null;
}

/** File extension for an allowed résumé MIME (for building storage keys). */
export const resumeExt = (mime: ResumeMime): string => (mime === 'application/pdf' ? 'pdf' : 'docx');
export const MAX_RESUMES_PER_SEEKER = 5;

export const JOBS_PAGE_SIZE = 20;
export const SAVED_JOBS_PAGE_SIZE = 24;
export const RECENTLY_VIEWED_JOBS_MAX = 50;

/** Sorts offered on the public job search. */
export const JOB_SORTS = ['relevance', 'newest', 'deadline', 'salary_asc', 'salary_desc'] as const;
export type JobSort = (typeof JOB_SORTS)[number];

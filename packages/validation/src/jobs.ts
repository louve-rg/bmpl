import { z } from 'zod';
import {
  DISTRICTS,
  EMPLOYMENT_TYPES,
  WORK_ARRANGEMENTS,
  EXPERIENCE_LEVELS,
  EDUCATION_LEVELS,
  SALARY_PERIODS,
  SALARY_VISIBILITIES,
  JOB_APPLICATION_METHODS,
  JOB_QUESTION_TYPES,
  JOB_SEEKER_VISIBILITIES,
  SEEKER_EMPLOYMENT_STATUSES,
  INTERVIEW_MODES,
  JOB_APPLICATION_STATUSES,
  JOB_REPORT_REASONS,
} from '@bmpl/shared';

// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]', 'g');
const clean = (s: string) => s.replace(CONTROL, '').trim();
const text = (min: number, max: number) => z.string().transform(clean).pipe(z.string().min(min).max(max));
const optText = (max: number) => z.string().transform(clean).pipe(z.string().max(max)).transform((s) => (s === '' ? null : s)).nullable().optional();
const cuid = z.string().cuid2().or(z.string().cuid());
const district = z.enum(DISTRICTS);
const moneyMinor = z.coerce.number().int().min(0).max(1_000_000_000);
const year = z.coerce.number().int().min(1900).max(2100);
const skillName = z.string().transform(clean).pipe(z.string().min(1).max(60));

// ===========================================================================
// Job Seeker profile
// ===========================================================================
export const upsertJobSeekerProfileSchema = z.object({
  preferredName: text(1, 120),
  legalName: optText(160),
  headline: optText(160),
  summary: optText(4000),
  district: district.nullable().optional(),
  contactEmail: z.string().email().max(200).nullable().optional(),
  contactPhone: optText(40),
  employmentStatus: z.enum(SEEKER_EMPLOYMENT_STATUSES).optional(),
  preferredTypes: z.array(z.enum(EMPLOYMENT_TYPES)).max(8).optional(),
  preferredDistricts: z.array(district).max(6).optional(),
  remotePreference: z.enum(WORK_ARRANGEMENTS).nullable().optional(),
  availabilityDate: z.coerce.date().nullable().optional(),
  salaryExpectMinor: moneyMinor.nullable().optional(),
  salaryCurrency: z.literal('BZD').optional(),
  salaryPeriod: z.enum(SALARY_PERIODS).nullable().optional(),
  salaryExpectPublic: z.boolean().optional(),
  visibility: z.enum(JOB_SEEKER_VISIBILITIES).optional(),
});
export type UpsertJobSeekerProfileInput = z.infer<typeof upsertJobSeekerProfileSchema>;

export const jobSeekerSkillSchema = z.object({ name: skillName });
export type JobSeekerSkillInput = z.infer<typeof jobSeekerSkillSchema>;

export const jobSeekerEducationSchema = z.object({
  institution: text(1, 160),
  level: z.enum(EDUCATION_LEVELS).nullable().optional(),
  fieldOfStudy: optText(160),
  startYear: year.nullable().optional(),
  endYear: year.nullable().optional(),
  current: z.boolean().optional(),
});
export type JobSeekerEducationInput = z.infer<typeof jobSeekerEducationSchema>;

export const jobSeekerExperienceSchema = z.object({
  title: text(1, 160),
  company: text(1, 160),
  district: district.nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  current: z.boolean().optional(),
  description: optText(2000),
});
export type JobSeekerExperienceInput = z.infer<typeof jobSeekerExperienceSchema>;

export const jobSeekerCertificationSchema = z.object({
  name: text(1, 160),
  issuer: optText(160),
  issuedYear: year.nullable().optional(),
});
export type JobSeekerCertificationInput = z.infer<typeof jobSeekerCertificationSchema>;

export const jobSeekerLanguageSchema = z.object({
  name: text(1, 60),
  proficiency: optText(40),
});
export type JobSeekerLanguageInput = z.infer<typeof jobSeekerLanguageSchema>;

export const resumeConfirmSchema = z.object({
  storageKey: z.string().trim().min(1).max(512),
  label: text(1, 120),
});
export type ResumeConfirmInput = z.infer<typeof resumeConfirmSchema>;

// ===========================================================================
// Employer / company profile
// ===========================================================================
export const upsertEmployerProfileSchema = z.object({
  companyName: text(2, 160),
  legalName: optText(200),
  description: optText(4000),
  industry: optText(120),
  companySize: optText(60),
  contactEmail: z.string().email().max(200),
  contactPhone: optText(40),
  website: z.string().trim().url().max(200).nullable().optional().or(z.literal('').transform(() => null)),
  district: district.nullable().optional(),
  addressLine1: optText(200),
  addressLine2: optText(200),
  city: optText(120),
});
export type UpsertEmployerProfileInput = z.infer<typeof upsertEmployerProfileSchema>;

// ===========================================================================
// Job listing
// ===========================================================================
const jobCore = {
  title: text(3, 160),
  jobCategoryId: cuid.nullable().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  workArrangement: z.enum(WORK_ARRANGEMENTS).optional(),
  district: district.nullable().optional(),
  city: optText(120),
  remoteEligible: z.boolean().optional(),
  description: text(20, 12000),
  responsibilities: optText(8000),
  requirements: optText(8000),
  preferredQualifications: optText(8000),
  experienceLevel: z.enum(EXPERIENCE_LEVELS).nullable().optional(),
  educationLevel: z.enum(EDUCATION_LEVELS).nullable().optional(),
  salaryMinMinor: moneyMinor.nullable().optional(),
  salaryMaxMinor: moneyMinor.nullable().optional(),
  salaryCurrency: z.literal('BZD').optional(),
  salaryPeriod: z.enum(SALARY_PERIODS).nullable().optional(),
  salaryVisibility: z.enum(SALARY_VISIBILITIES).optional(),
  openings: z.coerce.number().int().min(1).max(9999).optional(),
  applicationDeadline: z.coerce.date().nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  applicationMethod: z.enum(JOB_APPLICATION_METHODS).optional(),
  externalUrl: z.string().trim().url().max(500).nullable().optional().or(z.literal('').transform(() => null)),
  applicationEmail: z.string().email().max(200).nullable().optional(),
  skills: z.array(z.object({ name: skillName, required: z.boolean().optional() })).max(30).optional(),
  benefits: z.array(text(1, 120)).max(20).optional(),
};
const salaryRefine = (v: { salaryMinMinor?: number | null; salaryMaxMinor?: number | null }) =>
  v.salaryMinMinor == null || v.salaryMaxMinor == null || v.salaryMaxMinor >= v.salaryMinMinor;
export const createJobSchema = z.object(jobCore).refine(salaryRefine, { message: 'Maximum salary must be at least the minimum.', path: ['salaryMaxMinor'] });
export type CreateJobInput = z.infer<typeof createJobSchema>;
export const updateJobSchema = z
  .object(jobCore)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' })
  .refine(salaryRefine, { message: 'Maximum salary must be at least the minimum.', path: ['salaryMaxMinor'] });
export type UpdateJobInput = z.infer<typeof updateJobSchema>;

export const jobQuestionSchema = z.object({
  prompt: text(2, 400),
  type: z.enum(JOB_QUESTION_TYPES),
  required: z.boolean().optional(),
  options: z.array(text(1, 160)).max(20).optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
});
export type JobQuestionInput = z.infer<typeof jobQuestionSchema>;

/** Admin job moderation actions. */
export const jobModerateSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'REQUEST_INFO', 'UNPUBLISH', 'SUSPEND', 'ARCHIVE']),
  reason: optText(1000),
});
export type JobModerateInput = z.infer<typeof jobModerateSchema>;

export const jobCategorySchema = z.object({ name: text(2, 80), isVisible: z.boolean().optional(), sortOrder: z.coerce.number().int().min(0).max(9999).optional() });
export type JobCategoryInput = z.infer<typeof jobCategorySchema>;

// ===========================================================================
// Applications
// ===========================================================================
export const submitApplicationSchema = z.object({
  jobId: cuid,
  resumeId: cuid.nullable().optional(),
  coverLetter: optText(6000),
  source: optText(60),
  answers: z
    .array(
      z.object({
        questionId: cuid,
        text: z.string().transform(clean).pipe(z.string().max(4000)).nullable().optional(),
        choices: z.array(text(1, 160)).max(20).optional(),
      }),
    )
    .max(50)
    .optional(),
});
export type SubmitApplicationInput = z.infer<typeof submitApplicationSchema>;

/** Employer pipeline transition (status validated against the transition map in the service). */
export const applicationStatusSchema = z.object({
  status: z.enum(JOB_APPLICATION_STATUSES),
  note: optText(2000),
});
export type ApplicationStatusInput = z.infer<typeof applicationStatusSchema>;

export const applicationNoteSchema = z.object({ note: text(1, 4000) });
export type ApplicationNoteInput = z.infer<typeof applicationNoteSchema>;

export const interviewSchema = z.object({
  scheduledAt: z.coerce.date(),
  timezone: z.string().trim().max(64).optional(),
  mode: z.enum(INTERVIEW_MODES),
  location: optText(500),
  notes: optText(2000),
});
export type InterviewInput = z.infer<typeof interviewSchema>;

export const interviewUpdateSchema = z
  .object({
    scheduledAt: z.coerce.date().optional(),
    timezone: z.string().trim().max(64).optional(),
    mode: z.enum(INTERVIEW_MODES).optional(),
    location: optText(500),
    notes: optText(2000),
    status: z.enum(['SCHEDULED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });
export type InterviewUpdateInput = z.infer<typeof interviewUpdateSchema>;

// ===========================================================================
// Reports
// ===========================================================================
export const jobReportSchema = z.object({ reason: z.enum(JOB_REPORT_REASONS), note: optText(1000) });
export type JobReportInput = z.infer<typeof jobReportSchema>;

export const resolveJobReportSchema = z.object({ status: z.enum(['ACTIONED', 'DISMISSED']), note: optText(1000) });
export type ResolveJobReportInput = z.infer<typeof resolveJobReportSchema>;

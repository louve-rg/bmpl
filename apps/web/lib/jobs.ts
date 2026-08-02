/**
 * Belize Connect (Jobs) — single source of truth for the customer-facing job UI.
 * Types mirror the API contract, `jobsApi` wraps every endpoint, and the helpers
 * (salary formatting respecting visibility, deadline "closes in N days") are shared
 * by all job surfaces so nothing drifts. Money is always in MINOR units.
 */
import {
  DISTRICT_LABELS,
  SALARY_PERIOD_LABELS,
  type District,
  type EmploymentType,
  type WorkArrangement,
  type ExperienceLevel,
  type EducationLevel,
  type SalaryPeriod,
  type SalaryVisibility,
  type JobStatus,
  type JobApplicationStatus,
  type JobApplicationMethod,
  type JobQuestionType,
  type JobSeekerVisibility,
  type SeekerEmploymentStatus,
  type InterviewMode,
  type InterviewStatus,
  type JobReportReason,
} from '@bmpl/shared';
import { api } from './api';

/* ------------------------------------------------------------------ types */

export interface JobSalary {
  minMinor: number | null;
  maxMinor: number | null;
  period: SalaryPeriod | null;
  visibility: SalaryVisibility;
}

export interface JobCompanyRef {
  name: string;
  slug: string;
}

export interface JobCategoryRef {
  name: string;
  slug: string;
}

/** Compact job representation used by search results, related rows, saved lists. */
export interface JobCard {
  id: string;
  title: string;
  slug: string;
  employmentType: EmploymentType;
  workArrangement: WorkArrangement | null;
  district: District | null;
  city: string | null;
  salary: JobSalary | null;
  applicationDeadline: string | null;
  publishedAt: string | null;
  company: JobCompanyRef;
  category: JobCategoryRef | null;
}

export interface JobList {
  total: number;
  page: number;
  pageSize: number;
  items: JobCard[];
}

export interface JobCategory {
  id: string;
  name: string;
  slug: string;
}

export interface JobSkill {
  name: string;
  required: boolean;
}

export interface JobQuestion {
  id: string;
  prompt: string;
  type: JobQuestionType;
  required: boolean;
  options: string[] | null;
}

export interface CompanySummary {
  companyName: string;
  slug: string;
  description: string | null;
  industry: string | null;
  companySize: string | null;
  website: string | null;
  district: District | null;
  city: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  openJobs: number;
}

/** Full public job detail (GET /jobs/:slug). */
export interface JobDetail extends JobCard {
  status: JobStatus;
  category: JobCategoryRef | null;
  remoteEligible: boolean;
  description: string;
  responsibilities: string | null;
  requirements: string | null;
  preferredQualifications: string | null;
  experienceLevel: ExperienceLevel | null;
  educationLevel: EducationLevel | null;
  openings: number | null;
  startDate: string | null;
  applicationMethod: JobApplicationMethod;
  externalUrl: string | null;
  applicationEmail: string | null;
  skills: JobSkill[];
  benefits: string[];
  questions: JobQuestion[];
  companyProfile: CompanySummary | null;
  related: JobCard[];
}

/* --- job seeker --- */

export interface SeekerSkill {
  id: string;
  name: string;
}
export interface SeekerEducation {
  id: string;
  institution: string;
  level: EducationLevel | null;
  fieldOfStudy: string | null;
  startYear: number | null;
  endYear: number | null;
  current: boolean;
}
export interface SeekerExperience {
  id: string;
  title: string;
  company: string;
  district: District | null;
  startDate: string | null;
  endDate: string | null;
  current: boolean;
  description: string | null;
}
export interface SeekerCertification {
  id: string;
  name: string;
  issuer: string | null;
  issuedYear: number | null;
}
export interface SeekerLanguage {
  id: string;
  name: string;
  proficiency: string | null;
}
export interface SeekerResume {
  id: string;
  label: string;
  mimeType: string;
  fileSizeBytes: number;
  isPrimary: boolean;
  downloadUrl: string;
}

export interface SeekerProfile {
  preferredName: string;
  legalName: string | null;
  headline: string | null;
  summary: string | null;
  district: District | null;
  contactEmail: string | null;
  contactPhone: string | null;
  employmentStatus: SeekerEmploymentStatus;
  preferredTypes: EmploymentType[];
  preferredDistricts: District[];
  remotePreference: WorkArrangement | null;
  availabilityDate: string | null;
  salaryExpectMinor: number | null;
  salaryPeriod: SalaryPeriod | null;
  salaryExpectPublic: boolean;
  visibility: JobSeekerVisibility;
  skills: SeekerSkill[];
  education: SeekerEducation[];
  experience: SeekerExperience[];
  certifications: SeekerCertification[];
  languages: SeekerLanguage[];
  resumes: SeekerResume[];
}

/** Scalar body accepted by PUT /job-seeker/profile. */
export interface SeekerProfileInput {
  preferredName: string;
  legalName?: string | null;
  headline?: string | null;
  summary?: string | null;
  district?: District | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  employmentStatus: SeekerEmploymentStatus;
  preferredTypes: EmploymentType[];
  preferredDistricts: District[];
  remotePreference?: WorkArrangement | null;
  availabilityDate?: string | null;
  salaryExpectMinor?: number | null;
  salaryPeriod?: SalaryPeriod | null;
  salaryExpectPublic: boolean;
  visibility: JobSeekerVisibility;
}

export interface SavedJob extends JobCard {
  savedAt: string;
  jobId: string;
  closed: boolean;
}

export interface ApplicationAnswerInput {
  questionId: string;
  text?: string;
  choices?: string[];
}
export interface CreateApplicationInput {
  jobId: string;
  resumeId?: string;
  coverLetter?: string;
  answers: ApplicationAnswerInput[];
}

export interface ApplicationListItem {
  id: string;
  jobSlug: string;
  jobTitle: string;
  company: string;
  status: JobApplicationStatus;
  submittedAt: string;
}

export interface ApplicationAnswer {
  prompt: string;
  type: JobQuestionType;
  text: string | null;
  choices: string[] | null;
}
export interface ApplicationTimelineEntry {
  from: JobApplicationStatus | null;
  to: JobApplicationStatus;
  note: string | null;
  at: string;
}
export interface Interview {
  scheduledAt: string;
  timezone: string | null;
  mode: InterviewMode;
  location: string | null;
  notes: string | null;
  status: InterviewStatus;
}
export interface SeekerApplicationDetail {
  id: string;
  jobSlug: string;
  jobTitle: string;
  company: string;
  status: JobApplicationStatus;
  submittedAt: string;
  coverLetter: string | null;
  resume: SeekerResume | null;
  answers: ApplicationAnswer[];
  timeline: ApplicationTimelineEntry[];
  interviews: Interview[];
}

/* --- employer --- */

export interface EmployerProfile {
  companyName: string;
  legalName: string | null;
  description: string | null;
  industry: string | null;
  companySize: string | null;
  contactEmail: string;
  contactPhone: string | null;
  website: string | null;
  district: District | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  approvalStatus: string;
}

export interface EmployerProfileInput {
  companyName: string;
  legalName?: string | null;
  description?: string | null;
  industry?: string | null;
  companySize?: string | null;
  contactEmail: string;
  contactPhone?: string | null;
  website?: string | null;
  district?: District | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
}

export interface EmployerJobRow {
  id: string;
  title: string;
  slug: string;
  status: JobStatus;
  employmentType: EmploymentType;
  workArrangement: WorkArrangement | null;
  district: District | null;
  city: string | null;
  applicationDeadline: string | null;
  publishedAt: string | null;
  applications: number;
}

export interface EmployerJobDetail {
  id: string;
  title: string;
  slug: string;
  status: JobStatus;
  jobCategoryId: string | null;
  employmentType: EmploymentType;
  workArrangement: WorkArrangement | null;
  district: District | null;
  city: string | null;
  remoteEligible: boolean;
  description: string;
  responsibilities: string | null;
  requirements: string | null;
  preferredQualifications: string | null;
  experienceLevel: ExperienceLevel | null;
  educationLevel: EducationLevel | null;
  salaryMinMinor: number | null;
  salaryMaxMinor: number | null;
  salaryPeriod: SalaryPeriod | null;
  salaryVisibility: SalaryVisibility;
  openings: number | null;
  applicationDeadline: string | null;
  startDate: string | null;
  applicationMethod: JobApplicationMethod;
  externalUrl: string | null;
  applicationEmail: string | null;
  skills: JobSkill[];
  benefits: string[];
  questions: JobQuestion[];
}

export interface CreateJobInput {
  title: string;
  jobCategoryId?: string | null;
  employmentType: EmploymentType;
  workArrangement?: WorkArrangement | null;
  district?: District | null;
  city?: string | null;
  remoteEligible?: boolean;
  description: string;
  responsibilities?: string | null;
  requirements?: string | null;
  preferredQualifications?: string | null;
  experienceLevel?: ExperienceLevel | null;
  educationLevel?: EducationLevel | null;
  salaryMinMinor?: number | null;
  salaryMaxMinor?: number | null;
  salaryPeriod?: SalaryPeriod | null;
  salaryVisibility?: SalaryVisibility;
  openings?: number | null;
  applicationDeadline?: string | null;
  startDate?: string | null;
  applicationMethod?: JobApplicationMethod;
  externalUrl?: string | null;
  applicationEmail?: string | null;
  skills: JobSkill[];
  benefits: string[];
}

export interface CreateQuestionInput {
  prompt: string;
  type: JobQuestionType;
  required?: boolean;
  options?: string[];
}

export interface EmployerApplicationRow {
  id: string;
  jobId: string;
  jobTitle: string;
  applicantName: string;
  status: JobApplicationStatus;
  submittedAt: string;
}

export interface EmployerApplicationDetail {
  id: string;
  jobId: string;
  jobTitle: string;
  status: JobApplicationStatus;
  submittedAt: string;
  applicant: { name: string; email: string };
  coverLetter: string | null;
  resume: SeekerResume | null;
  answers: ApplicationAnswer[];
  employerNotes: Array<{ note: string; at: string }>;
  timeline: ApplicationTimelineEntry[];
  interviews: Interview[];
}

export interface EmployerAnalytics {
  activeJobs: number;
  totalJobs: number;
  applications: number;
  shortlisted: number;
  interviewed: number;
  hired: number;
  applicationConversion: number;
}

export interface CreateInterviewInput {
  scheduledAt: string;
  timezone?: string;
  mode: InterviewMode;
  location?: string;
  notes?: string;
}

export interface Conversation {
  id: string;
}

/* --------------------------------------------------------------- helpers */

export const money = (c: number): string => `$${(c / 100).toFixed(2)}`;

export const districtLabel = (d: District | null | undefined): string =>
  d ? DISTRICT_LABELS[d] : '';

/** Location string, e.g. "Belize City, Belize" or "Belize" or "Remote". */
export function locationLabel(job: {
  city: string | null;
  district: District | null;
  workArrangement?: WorkArrangement | null;
}): string {
  if (job.workArrangement === 'REMOTE') return 'Remote';
  const parts = [job.city, job.district ? DISTRICT_LABELS[job.district] : null].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Belize';
}

/**
 * Salary shown to the public respecting visibility. HIDDEN → null (render
 * nothing). RANGE → "$min – $max per month". EXACT → a single figure.
 */
export function formatSalary(salary: JobSalary | null | undefined): string | null {
  if (!salary || salary.visibility === 'HIDDEN') return null;
  const period = salary.period ? ` ${SALARY_PERIOD_LABELS[salary.period]}` : '';
  const { minMinor, maxMinor } = salary;
  if (salary.visibility === 'EXACT') {
    const v = minMinor ?? maxMinor;
    if (v == null) return null;
    return `${money(v)}${period}`;
  }
  // RANGE
  if (minMinor != null && maxMinor != null && minMinor !== maxMinor) {
    return `${money(minMinor)} – ${money(maxMinor)}${period}`;
  }
  const v = minMinor ?? maxMinor;
  if (v == null) return null;
  return `${money(v)}${period}`;
}

export interface DeadlineInfo {
  label: string;
  closed: boolean;
  soon: boolean;
}

/** "Closes in 5 days" / "Closes today" / "Closed" for a deadline chip. */
export function deadlineInfo(deadline: string | null | undefined): DeadlineInfo | null {
  if (!deadline) return null;
  const end = new Date(deadline);
  if (Number.isNaN(end.getTime())) return null;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const days = Math.round((endDay.getTime() - startOfToday.getTime()) / 86_400_000);
  if (days < 0) return { label: 'Closed', closed: true, soon: false };
  if (days === 0) return { label: 'Closes today', closed: false, soon: true };
  if (days === 1) return { label: 'Closes tomorrow', closed: false, soon: true };
  return { label: `Closes in ${days} days`, closed: false, soon: days <= 7 };
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/* Résumé presign → PUT → confirm. Returns the created résumé record. */
export async function uploadResume(file: File, label: string): Promise<SeekerResume> {
  const presign = await api.post<{ uploadUrl: string; key: string }>(
    '/job-seeker/resumes/presign',
    { fileName: file.name, contentType: file.type, sizeBytes: file.size },
  );
  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!put.ok) throw { status: put.status, message: 'Upload to storage failed.' };
  return api.post<SeekerResume>('/job-seeker/resumes', {
    storageKey: presign.key,
    label: label.trim() || file.name,
  });
}

/* Employer logo / banner presign → PUT → confirm. Returns the updated profile. */
export async function uploadEmployerImage(
  kind: 'logo' | 'banner',
  file: File,
): Promise<EmployerProfile> {
  const presign = await api.post<{ uploadUrl: string; key: string }>(
    `/employer/profile/${kind}/presign`,
    { fileName: file.name, contentType: file.type, sizeBytes: file.size },
  );
  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!put.ok) throw { status: put.status, message: 'Upload to storage failed.' };
  return api.post<EmployerProfile>(`/employer/profile/${kind}/confirm`, { storageKey: presign.key });
}

/* ------------------------------------------------------------------- api */

export type SeekerChildKind = 'skills' | 'education' | 'experience' | 'certifications' | 'languages';

function toQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const jobsApi = {
  /* ---- public ---- */
  list: (query: string) => api.get<JobList>(`/jobs${query}`),
  categories: () => api.get<JobCategory[]>('/jobs/categories'),
  company: (slug: string) => api.get<CompanySummary>(`/jobs/companies/${encodeURIComponent(slug)}`),
  detail: (slug: string) => api.get<JobDetail>(`/jobs/${encodeURIComponent(slug)}`),

  /* ---- job seeker ---- */
  getProfile: () => api.get<SeekerProfile>('/job-seeker/profile'),
  updateProfile: (body: SeekerProfileInput) => api.put<SeekerProfile>('/job-seeker/profile', body),
  addChild: (kind: SeekerChildKind, body: unknown) => api.post(`/job-seeker/${kind}`, body),
  removeChild: (kind: SeekerChildKind, id: string) => api.del(`/job-seeker/${kind}/${id}`),

  createResume: uploadResume,
  setPrimaryResume: (id: string) => api.post(`/job-seeker/resumes/${id}/primary`),
  deleteResume: (id: string) => api.del(`/job-seeker/resumes/${id}`),
  resumeUrl: (id: string) => api.get<{ url: string }>(`/job-seeker/resumes/${id}/url`),

  savedJobs: () => api.get<{ items: SavedJob[] }>('/job-seeker/saved'),
  savedIds: () => api.get<{ jobIds: string[] }>('/job-seeker/saved/ids'),
  saveJob: (jobId: string) => api.post(`/job-seeker/saved/${jobId}`),
  unsaveJob: (jobId: string) => api.del(`/job-seeker/saved/${jobId}`),

  recordView: (jobId: string) => api.post(`/job-seeker/recently-viewed/${jobId}`),
  recentlyViewed: () => api.get<{ items: JobCard[] }>('/job-seeker/recently-viewed'),

  apply: (body: CreateApplicationInput) =>
    api.post<{ id: string }>('/job-seeker/applications', body),
  applications: () => api.get<ApplicationListItem[]>('/job-seeker/applications'),
  application: (id: string) => api.get<SeekerApplicationDetail>(`/job-seeker/applications/${id}`),
  withdraw: (id: string) => api.post(`/job-seeker/applications/${id}/withdraw`),
  openApplicationConversation: (id: string) =>
    api.post<Conversation>(`/job-seeker/applications/${id}/conversation`),

  report: (jobId: string, body: { reason: JobReportReason; note?: string }) =>
    api.post(`/job-seeker/report/${jobId}`, body),

  /* ---- employer ---- */
  employer: {
    getProfile: () => api.get<EmployerProfile>('/employer/profile'),
    updateProfile: (body: EmployerProfileInput) => api.put<EmployerProfile>('/employer/profile', body),
    uploadImage: uploadEmployerImage,

    jobs: (status?: JobStatus) => api.get<EmployerJobRow[]>(`/employer/jobs${toQuery({ status })}`),
    createJob: (body: CreateJobInput) => api.post<{ id: string }>('/employer/jobs', body),
    job: (id: string) => api.get<EmployerJobDetail>(`/employer/jobs/${id}`),
    updateJob: (id: string, body: Partial<CreateJobInput>) =>
      api.patch<EmployerJobDetail>(`/employer/jobs/${id}`, body),
    submitJob: (id: string) => api.post(`/employer/jobs/${id}/submit`),
    closeJob: (id: string) => api.post(`/employer/jobs/${id}/close`),
    archiveJob: (id: string) => api.post(`/employer/jobs/${id}/archive`),
    duplicateJob: (id: string) => api.post<{ id: string }>(`/employer/jobs/${id}/duplicate`),
    addQuestion: (jobId: string, body: CreateQuestionInput) =>
      api.post<JobQuestion>(`/employer/jobs/${jobId}/questions`, body),
    deleteQuestion: (jobId: string, questionId: string) =>
      api.del(`/employer/jobs/${jobId}/questions/${questionId}`),

    applications: (params: { jobId?: string; status?: JobApplicationStatus }) =>
      api.get<EmployerApplicationRow[]>(`/employer/applications${toQuery(params)}`),
    application: (id: string) => api.get<EmployerApplicationDetail>(`/employer/applications/${id}`),
    resumeUrl: (id: string) => api.get<{ url: string }>(`/employer/applications/${id}/resume-url`),
    setStatus: (id: string, body: { status: JobApplicationStatus; note?: string }) =>
      api.post(`/employer/applications/${id}/status`, body),
    addNote: (id: string, note: string) =>
      api.post(`/employer/applications/${id}/notes`, { note }),
    scheduleInterview: (id: string, body: CreateInterviewInput) =>
      api.post(`/employer/applications/${id}/interviews`, body),
    updateInterview: (interviewId: string, body: Partial<CreateInterviewInput> & { status?: InterviewStatus }) =>
      api.patch(`/employer/interviews/${interviewId}`, body),
    openConversation: (id: string) =>
      api.post<Conversation>(`/employer/applications/${id}/conversation`),
    analytics: () => api.get<EmployerAnalytics>('/employer/analytics'),
  },
};

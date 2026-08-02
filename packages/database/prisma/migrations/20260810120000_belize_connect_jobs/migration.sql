-- Belize Connect — Jobs & Employment (Phase 5 · M24)
-- Additive only: new enums + tables. The M7 raw-SQL search indexes
-- (products_search_idx, products_title_trgm_idx) are intentionally NOT dropped
-- (migrate diff lists them only because they are managed outside the schema).

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY', 'INTERNSHIP', 'SEASONAL', 'APPRENTICESHIP', 'VOLUNTEER');

-- CreateEnum
CREATE TYPE "WorkArrangement" AS ENUM ('ONSITE', 'HYBRID', 'REMOTE');

-- CreateEnum
CREATE TYPE "ExperienceLevel" AS ENUM ('ENTRY', 'JUNIOR', 'MID', 'SENIOR', 'LEAD', 'EXECUTIVE');

-- CreateEnum
CREATE TYPE "EducationLevel" AS ENUM ('NONE', 'PRIMARY', 'SECONDARY', 'VOCATIONAL', 'ASSOCIATE', 'BACHELOR', 'MASTER', 'DOCTORATE');

-- CreateEnum
CREATE TYPE "SalaryPeriod" AS ENUM ('HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "SalaryVisibility" AS ENUM ('HIDDEN', 'RANGE', 'EXACT');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'APPROVED', 'PUBLISHED', 'REJECTED', 'CLOSED', 'ARCHIVED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "JobApplicationMethod" AS ENUM ('INTERNAL', 'EXTERNAL_URL', 'EMAIL');

-- CreateEnum
CREATE TYPE "JobApplicationStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW_REQUESTED', 'INTERVIEW_SCHEDULED', 'OFFER_EXTENDED', 'HIRED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "JobQuestionType" AS ENUM ('SHORT_TEXT', 'LONG_TEXT', 'YES_NO', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'NUMBER', 'DATE');

-- CreateEnum
CREATE TYPE "JobSeekerVisibility" AS ENUM ('PRIVATE', 'EMPLOYERS_ONLY', 'PUBLIC_SUMMARY');

-- CreateEnum
CREATE TYPE "SeekerEmploymentStatus" AS ENUM ('OPEN_TO_WORK', 'EMPLOYED', 'UNEMPLOYED', 'STUDENT', 'NOT_LOOKING');

-- CreateEnum
CREATE TYPE "InterviewMode" AS ENUM ('IN_PERSON', 'PHONE', 'VIDEO');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('SCHEDULED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobReportReason" AS ENUM ('SCAM', 'MISLEADING', 'DISCRIMINATION', 'ILLEGAL', 'PRIVACY', 'DUPLICATE', 'EXPIRED', 'OTHER');

-- CreateEnum
CREATE TYPE "JobReportStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');



-- CreateTable
CREATE TABLE "job_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_seeker_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "preferredName" TEXT NOT NULL,
    "legalName" TEXT,
    "headline" TEXT,
    "summary" TEXT,
    "district" "District",
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "employmentStatus" "SeekerEmploymentStatus" NOT NULL DEFAULT 'OPEN_TO_WORK',
    "preferredTypes" "EmploymentType"[],
    "preferredDistricts" "District"[],
    "remotePreference" "WorkArrangement",
    "availabilityDate" TIMESTAMP(3),
    "salaryExpectMinor" BIGINT,
    "salaryCurrency" "Currency" NOT NULL DEFAULT 'BZD',
    "salaryPeriod" "SalaryPeriod",
    "salaryExpectPublic" BOOLEAN NOT NULL DEFAULT false,
    "visibility" "JobSeekerVisibility" NOT NULL DEFAULT 'PRIVATE',
    "photoKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_seeker_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_seeker_skills" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_seeker_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_seeker_education" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "level" "EducationLevel",
    "fieldOfStudy" TEXT,
    "startYear" INTEGER,
    "endYear" INTEGER,
    "current" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_seeker_education_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_seeker_experience" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "district" "District",
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "current" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_seeker_experience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_seeker_certifications" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT,
    "issuedYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_seeker_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_seeker_languages" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "proficiency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_seeker_languages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_seeker_resumes" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "scanStatus" "AttachmentScanStatus" NOT NULL DEFAULT 'PENDING',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_seeker_resumes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employer_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "legalName" TEXT,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "industry" TEXT,
    "companySize" TEXT,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "website" TEXT,
    "district" "District",
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "logoKey" TEXT,
    "bannerKey" TEXT,
    "approvalStatus" "VendorApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_listings" (
    "id" TEXT NOT NULL,
    "employerProfileId" TEXT NOT NULL,
    "jobCategoryId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "employmentType" "EmploymentType" NOT NULL,
    "workArrangement" "WorkArrangement" NOT NULL DEFAULT 'ONSITE',
    "district" "District",
    "city" TEXT,
    "remoteEligible" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL,
    "responsibilities" TEXT,
    "requirements" TEXT,
    "preferredQualifications" TEXT,
    "experienceLevel" "ExperienceLevel",
    "educationLevel" "EducationLevel",
    "salaryMinMinor" BIGINT,
    "salaryMaxMinor" BIGINT,
    "salaryCurrency" "Currency" NOT NULL DEFAULT 'BZD',
    "salaryPeriod" "SalaryPeriod",
    "salaryVisibility" "SalaryVisibility" NOT NULL DEFAULT 'HIDDEN',
    "openings" INTEGER NOT NULL DEFAULT 1,
    "applicationDeadline" TIMESTAMP(3),
    "startDate" TIMESTAMP(3),
    "applicationMethod" "JobApplicationMethod" NOT NULL DEFAULT 'INTERNAL',
    "externalUrl" TEXT,
    "applicationEmail" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'DRAFT',
    "moderationReason" TEXT,
    "moderatedById" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_skills" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_benefits" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_benefits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_application_questions" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "type" "JobQuestionType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_application_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_applications" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "resumeId" TEXT,
    "coverLetter" TEXT,
    "status" "JobApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "employerNotes" TEXT,
    "source" TEXT,
    "jobTitleSnapshot" TEXT NOT NULL,
    "companySnapshot" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_application_answers" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "questionId" TEXT,
    "promptSnapshot" TEXT NOT NULL,
    "typeSnapshot" "JobQuestionType" NOT NULL,
    "answerText" TEXT,
    "answerChoices" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_application_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_application_events" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "fromStatus" "JobApplicationStatus",
    "toStatus" "JobApplicationStatus" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_application_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_interviews" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Belize',
    "mode" "InterviewMode" NOT NULL,
    "location" TEXT,
    "notes" TEXT,
    "status" "InterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recently_viewed_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recently_viewed_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_reports" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" "JobReportReason" NOT NULL,
    "note" TEXT,
    "status" "JobReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_categories_slug_key" ON "job_categories"("slug");

-- CreateIndex
CREATE INDEX "job_categories_isVisible_idx" ON "job_categories"("isVisible");

-- CreateIndex
CREATE UNIQUE INDEX "job_seeker_profiles_userId_key" ON "job_seeker_profiles"("userId");

-- CreateIndex
CREATE INDEX "job_seeker_profiles_visibility_idx" ON "job_seeker_profiles"("visibility");

-- CreateIndex
CREATE INDEX "job_seeker_profiles_district_idx" ON "job_seeker_profiles"("district");

-- CreateIndex
CREATE INDEX "job_seeker_skills_profileId_idx" ON "job_seeker_skills"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "job_seeker_skills_profileId_name_key" ON "job_seeker_skills"("profileId", "name");

-- CreateIndex
CREATE INDEX "job_seeker_education_profileId_idx" ON "job_seeker_education"("profileId");

-- CreateIndex
CREATE INDEX "job_seeker_experience_profileId_idx" ON "job_seeker_experience"("profileId");

-- CreateIndex
CREATE INDEX "job_seeker_certifications_profileId_idx" ON "job_seeker_certifications"("profileId");

-- CreateIndex
CREATE INDEX "job_seeker_languages_profileId_idx" ON "job_seeker_languages"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "job_seeker_languages_profileId_name_key" ON "job_seeker_languages"("profileId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "job_seeker_resumes_storageKey_key" ON "job_seeker_resumes"("storageKey");

-- CreateIndex
CREATE INDEX "job_seeker_resumes_profileId_idx" ON "job_seeker_resumes"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "employer_profiles_userId_key" ON "employer_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "employer_profiles_slug_key" ON "employer_profiles"("slug");

-- CreateIndex
CREATE INDEX "employer_profiles_approvalStatus_idx" ON "employer_profiles"("approvalStatus");

-- CreateIndex
CREATE UNIQUE INDEX "job_listings_slug_key" ON "job_listings"("slug");

-- CreateIndex
CREATE INDEX "job_listings_status_publishedAt_idx" ON "job_listings"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "job_listings_employerProfileId_status_idx" ON "job_listings"("employerProfileId", "status");

-- CreateIndex
CREATE INDEX "job_listings_jobCategoryId_idx" ON "job_listings"("jobCategoryId");

-- CreateIndex
CREATE INDEX "job_listings_district_idx" ON "job_listings"("district");

-- CreateIndex
CREATE INDEX "job_skills_jobId_idx" ON "job_skills"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "job_skills_jobId_name_key" ON "job_skills"("jobId", "name");

-- CreateIndex
CREATE INDEX "job_benefits_jobId_idx" ON "job_benefits"("jobId");

-- CreateIndex
CREATE INDEX "job_application_questions_jobId_idx" ON "job_application_questions"("jobId");

-- CreateIndex
CREATE INDEX "job_applications_jobId_status_idx" ON "job_applications"("jobId", "status");

-- CreateIndex
CREATE INDEX "job_applications_applicantId_submittedAt_idx" ON "job_applications"("applicantId", "submittedAt");

-- CreateIndex
CREATE INDEX "job_application_answers_applicationId_idx" ON "job_application_answers"("applicationId");

-- CreateIndex
CREATE INDEX "job_application_events_applicationId_createdAt_idx" ON "job_application_events"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "job_interviews_applicationId_idx" ON "job_interviews"("applicationId");

-- CreateIndex
CREATE INDEX "saved_jobs_userId_createdAt_idx" ON "saved_jobs"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "saved_jobs_userId_jobId_key" ON "saved_jobs"("userId", "jobId");

-- CreateIndex
CREATE INDEX "recently_viewed_jobs_userId_viewedAt_idx" ON "recently_viewed_jobs"("userId", "viewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "recently_viewed_jobs_userId_jobId_key" ON "recently_viewed_jobs"("userId", "jobId");

-- CreateIndex
CREATE INDEX "job_reports_status_idx" ON "job_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "job_reports_jobId_reporterId_key" ON "job_reports"("jobId", "reporterId");

-- AddForeignKey
ALTER TABLE "job_seeker_profiles" ADD CONSTRAINT "job_seeker_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_seeker_skills" ADD CONSTRAINT "job_seeker_skills_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "job_seeker_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_seeker_education" ADD CONSTRAINT "job_seeker_education_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "job_seeker_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_seeker_experience" ADD CONSTRAINT "job_seeker_experience_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "job_seeker_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_seeker_certifications" ADD CONSTRAINT "job_seeker_certifications_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "job_seeker_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_seeker_languages" ADD CONSTRAINT "job_seeker_languages_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "job_seeker_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_seeker_resumes" ADD CONSTRAINT "job_seeker_resumes_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "job_seeker_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employer_profiles" ADD CONSTRAINT "employer_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_listings" ADD CONSTRAINT "job_listings_employerProfileId_fkey" FOREIGN KEY ("employerProfileId") REFERENCES "employer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_listings" ADD CONSTRAINT "job_listings_jobCategoryId_fkey" FOREIGN KEY ("jobCategoryId") REFERENCES "job_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_skills" ADD CONSTRAINT "job_skills_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_benefits" ADD CONSTRAINT "job_benefits_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_application_questions" ADD CONSTRAINT "job_application_questions_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "job_seeker_resumes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_application_answers" ADD CONSTRAINT "job_application_answers_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_application_answers" ADD CONSTRAINT "job_application_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "job_application_questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_application_events" ADD CONSTRAINT "job_application_events_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_interviews" ADD CONSTRAINT "job_interviews_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_jobs" ADD CONSTRAINT "saved_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_jobs" ADD CONSTRAINT "saved_jobs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recently_viewed_jobs" ADD CONSTRAINT "recently_viewed_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recently_viewed_jobs" ADD CONSTRAINT "recently_viewed_jobs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_reports" ADD CONSTRAINT "job_reports_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


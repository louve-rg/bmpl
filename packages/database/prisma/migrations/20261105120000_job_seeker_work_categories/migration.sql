-- Job seekers record the KINDS OF WORK they are willing to do (Belize Connect,
-- Edward's "basic skills and work they're willing to do").
--
-- WHAT WAS WRONG: a seeker could describe skills (free text) and an employment
-- TYPE (full-time, part-time), but could not say which kind of work they would
-- take. JobCategory is the taxonomy that already exists for jobs, but it had no
-- link to a seeker.
--
-- WHY THIS IS THE FIX: a join table to the existing JobCategory reuses the one
-- taxonomy the product already maintains. A second free-text list would drift
-- from it, and "two ways to say the same thing" is a defect in this codebase.
--
-- WHY NOT THE ALTERNATIVES:
--   * A free-text work-type column on the profile: a parallel list that cannot
--     be matched against job categories.
--   * An array column on the profile: no referential integrity to job_categories,
--     so a deleted or hidden category would linger silently.
--
-- WHAT DOES NOT CHANGE: no existing table is altered. job_categories,
-- job_seeker_profiles and every seeker child table are untouched. No backfill:
-- the new table starts EMPTY, and no existing seeker is given any category.
-- Nothing here is verified by BMPL; a link means "the person says they will do
-- this", not that BMPL checked it.
--
-- SAFETY: additive only. CREATE TABLE plus indexes and foreign keys on a new,
-- empty table. No DROP, no ALTER on existing data, no UPDATE, no DELETE. Lock
-- impact is limited to the new table. Rollback is dropping the empty table,
-- which loses no data because nothing references it outside this feature.

-- CreateTable
CREATE TABLE "job_seeker_work_categories" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "jobCategoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_seeker_work_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_seeker_work_categories_profileId_jobCategoryId_key" ON "job_seeker_work_categories"("profileId", "jobCategoryId");

-- CreateIndex
CREATE INDEX "job_seeker_work_categories_jobCategoryId_idx" ON "job_seeker_work_categories"("jobCategoryId");

-- AddForeignKey
ALTER TABLE "job_seeker_work_categories" ADD CONSTRAINT "job_seeker_work_categories_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "job_seeker_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_seeker_work_categories" ADD CONSTRAINT "job_seeker_work_categories_jobCategoryId_fkey" FOREIGN KEY ("jobCategoryId") REFERENCES "job_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

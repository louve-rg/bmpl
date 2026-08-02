# Phase 5 · M24 — Belize Connect: Jobs & Employment Foundation

Belize Connect is a **fully integrated** jobs & employment module inside BMPL — not a
separate app. It reuses the existing account, roles, role-application approval,
notifications (M16), messaging (M17), private R2 storage, Postgres search, moderation
& operations (M23), analytics (M22), audit, validation, and design system. No separate
login, admin portal, notification engine, storage layer, or messaging service was
created.

**Out of scope (deferred, not started):** passenger transport, real estate, marketing/
advertising, mobile apps, external payouts/withdrawals, broad refund automation, GPS/
route optimization, **AI job matching**, paid job promotion, recruitment-agency billing,
multi-user company teams, and unrestricted candidate search.

## 1. Architecture & reuse
- **One account, many roles.** `JOB_SEEKER` and `EMPLOYER` already existed in the role
  catalog (`service: 'employment'`). `CUSTOMER` stays available alongside them.
- **Approval reuses the role-application workflow.** `JOB_SEEKER` requires no approval
  (auto-granted on first profile save). `EMPLOYER` requires admin approval + a
  "Business registration" document, handled entirely by the existing
  `/dashboard/applications` review flow (Draft→Submitted→Under review→More info→
  Approved→Rejected→Suspended→Restored→Revoked). An unapproved employer can neither
  publish jobs nor access applicant data (every employer route is `@Roles('EMPLOYER')`,
  which requires an APPROVED role).
- **Messaging** adds a `JOB_APPLICATION` conversation context + `EMPLOYER_APPLICANT`
  pairing to M17 (new participant roles `EMPLOYER`/`APPLICANT`); the applicant and the
  employer-of-the-job are the only participants (support can moderate). **Notifications**
  add a `JOB` category. **Storage** adds private `jobs/resumes/<userId>` + public
  `employers/<id>/logo|banner` namespaces. **Ops** (M23) gains
  `pendingJobModeration` + `openJobReports` queues.

## 2. Roles & permissions
New permissions (least privilege): `employers.read`, `employers.moderate`, `jobs.read`,
`jobs.moderate`, `job_categories.manage`. `ADMIN`+`SUPER_ADMIN` get all; `SUPPORT_AGENT`
gets `employers.read`+`jobs.read` **only** (read-only, **no résumé access**). Applicant/
employer data access is enforced by ownership, not permissions.

## 3. Job-seeker profile & privacy
Normalized `JobSeekerProfile` + children `JobSeekerSkill`/`Education`/`Experience`/
`Certification`/`Language`/`Resume` (no JSON blobs). Visibility `PRIVATE` (default) /
`EMPLOYERS_ONLY` / `PUBLIC_SUMMARY`. Résumés live in **private** R2; contact info, exact
address, résumé files, and application answers are never public. **No unrestricted
candidate search ships in M24** — an employer sees an applicant's full details only when
the applicant applied to one of that employer's jobs.

## 4. Employer / company profile
Normalized `EmployerProfile` (mirrors `VendorProfile`): company/legal name, slug,
description, industry, size, contacts, website, district/address, logo/banner,
`approvalStatus`. One account manages one company (multi-user teams deferred). Verified
via the EMPLOYER role application (business-registration doc in private R2). Admin can
suspend/restore the company independently — suspension also takes its live listings
offline.

## 5. Job lifecycle & moderation
`JobListing` (normalized; children `JobSkill`/`JobBenefit`/`JobApplicationQuestion`).
Strict status machine: `DRAFT → SUBMITTED → (admin) PUBLISHED | REJECTED |
MORE_INFO_REQUIRED`, plus employer `CLOSED`/`ARCHIVED` and admin `UNPUBLISH`/`SUSPEND`/
`ARCHIVE`. Only approved employers submit; **the employer cannot bypass moderation** —
publishing is admin-only. Only `PUBLISHED` jobs of `APPROVED` employers are public and
accept applications. Editing is limited to DRAFT/REJECTED/MORE_INFO_REQUIRED (close +
duplicate a published job to revise). Every moderation transition writes audit +
notifies the employer.

## 6. Public search & discovery
`GET /jobs` searches PUBLISHED jobs of APPROVED employers over title/description/company/
skills (Postgres `ILIKE`, pg_trgm-backed), with filters (category, district, employment
type, arrangement, remote, salary min, experience, education, date posted, closing soon)
and sorts (relevance/newest/deadline/salary asc/desc). **Excludes** draft/rejected/
closed/archived/suspended/**expired** listings and unapproved employers. Recommendations
are deterministic (same category / same district) — **no AI**. Saved jobs + recently-
viewed reuse the M20 pattern.

## 7. Application model & workflow
`JobApplication` + `JobApplicationAnswer` (with **question wording/type snapshots** so
later edits never alter historical applications) + **append-only** `JobApplicationEvent`
+ `JobInterview`. Statuses: SUBMITTED→UNDER_REVIEW/SHORTLISTED→INTERVIEW_REQUESTED→
INTERVIEW_SCHEDULED→OFFER_EXTENDED→HIRED, plus REJECTED and applicant-only WITHDRAWN.
The employer pipeline is a **validated transition map** (`@bmpl/shared`
`canTransitionApplication`) — arbitrary jumps 400. Submit rules: logged-in, job
PUBLISHED + accepting + deadline not passed, résumé owned by the applicant, required
questions answered server-side, and **one active application per (job, applicant)** —
duplicates 400. Documented policy: a **withdrawn** application **may be re-applied** (a
withdrawal is the applicant's own retraction). Every transition writes an event + audit
+ notification + a system message on the employer↔applicant thread. **Employer notes are
private** and never exposed to the applicant.

## 8. Résumé & document security
Private R2, PDF/DOCX only, MIME + size + namespace + HEAD validation, `scanStatus`
placeholder (PENDING). Signed URLs only to: the owner (`/job-seeker/resumes/:id/url`),
the employer of a job the owner applied to (`/employer/applications/:id/resume-url`),
and permitted admins. No public résumé URLs; no executables.

## 9. Messaging, notifications, interviews
Employer↔applicant conversations are context-scoped to the `JobApplication` (M17). System
messages mark submitted/shortlisted/interview/offer/hired/rejected/withdrawn. Applicants
are notified on every status change; employers on new/withdrawn applications; admins on
job-submitted + reported jobs. Interviews store date/time/timezone/mode(in-person/phone/
video)/location/notes/status — **no external calendar/video integration**; the applicant
is notified and sees the schedule; the employer may reschedule/cancel with history.

## 10. Reporting, safety & analytics
Users report a listing (SCAM/MISLEADING/DISCRIMINATION/ILLEGAL/PRIVACY/DUPLICATE/EXPIRED/
OTHER) — one per (job, reporter); a single report never auto-removes a job (admin triage,
M23 pattern). Admin analytics (M22 approach, read-only, no fake data): active jobs, by
category/district, applications, hires, conversion, approved employers, moderation
backlog, open reports. Employer analytics: jobs, applications, shortlisted, interviewed,
hired, conversion. Job-seeker metrics stay private (none exposed cross-user).

## 11. Security invariants (all tested)
Guest cannot apply/save/message (401); applicant sees only own applications; employer
sees only applications to own jobs; unapproved employer cannot publish; suspended
employer's live jobs go offline; closed/expired jobs reject applications; required
questions enforced server-side; duplicate applications blocked; private employer notes
never leak; résumé URLs are private + short-lived; direct-id manipulation → 404/403;
suspended users cannot apply/post/message; plain-text rendering (no HTML injection);
moderation cannot be bypassed; messaging stays context-scoped; no marketplace/order/
payment/wallet/delivery state is touched.

## 12. API inventory
Public `/jobs` (search, `:slug`, `categories`, `companies/:slug`); job seeker
`/job-seeker/*` (profile + children, résumés, saved/recently-viewed, applications,
report); employer `/employer/*` (company + logo/banner, jobs + lifecycle + questions,
applications pipeline + interviews + analytics); admin `/admin/jobs/*` (moderation,
reports, categories, employers, analytics). Full list in
[OpenAPI](../openapi/marketplace.yaml) (tags Jobs / Belize Connect).

## 13. Data model & migrations
20 new models + 16 new enums (see [DATABASE-SCHEMA](../phase-2/DATABASE-SCHEMA.md)).
Migrations: `20260810120000_belize_connect_jobs` (tables + enums),
`20260810121000_jobs_enum_additions` (AuditAction + NotificationCategory JOB +
ConversationContext JOB_APPLICATION), `20260810122000_conversation_role_additions`
(EMPLOYER/APPLICANT participant roles). Applied to dev + test; the M7 search indexes are
preserved (never dropped by hand-authored SQL).

## 14. Testing
`apps/api/test/jobs.integration.spec.ts` (real Postgres + MinIO): employer + job
lifecycle + public exposure + unapproved-employer denial + cross-employer isolation +
moderation-bypass rejection; application submit rules (guest 401, required questions,
résumé ownership, duplicate prevention, snapshots); the full pipeline (validated
transitions, private notes never leaked, résumé access + isolation, interviews, applicant
notifications, context-scoped messaging); closed/expired rejection + withdraw + re-apply;
résumé privacy + saved jobs; admin moderation/report gating. Full suite: **339 API
integration tests green**.

## 15. Mobile handoff
All models/enums/permissions/endpoints are transport-agnostic and reused across web; a
future Expo client consumes the same `/jobs`, `/job-seeker`, `/employer` API with the
existing secure-token auth. No web-only assumptions in the API.

## 16. Deferred scope (recommended next / M25 candidates)
Employer team members (org roles), opt-in candidate discovery with a fully-tested
privacy/authorization model, saved job searches + alerts, richer full-text ranking
(tsvector like M7), résumé parsing, and job analytics dashboards over time-series views.
No AI/paid promotion without explicit approval.

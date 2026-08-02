import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  EMPLOYMENT_TYPE_LABELS,
  WORK_ARRANGEMENT_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  EDUCATION_LEVEL_LABELS,
} from '@bmpl/shared';
import { Header } from '../../../components/landing/Header';
import { Footer } from '../../../components/landing/Footer';
import { serverGetSafe } from '../../../lib/server-api';
import { Badge, Breadcrumbs, Card } from '../../../components/ui';
import { JobBadges, JobList } from '../../../components/jobs/JobCard';
import { SaveJobButton } from '../../../components/jobs/SaveJobButton';
import { JobApplyPanel } from '../../../components/jobs/JobApplyPanel';
import { ReportJobDialog } from '../../../components/jobs/ReportJobDialog';
import { RecentlyViewedTracker } from '../../../components/jobs/RecentlyViewedTracker';
import {
  type JobDetail,
  formatSalary,
  locationLabel,
  deadlineInfo,
  fmtDate,
} from '../../../lib/jobs';

export const dynamic = 'force-dynamic';

export default async function JobDetailPage({ params }: { params: { slug: string } }) {
  const res = await serverGetSafe<JobDetail>(`/jobs/${encodeURIComponent(params.slug)}`);
  if (!res.ok) {
    if (res.notFound) notFound();
    return (
      <>
        <Header />
        <main className="bg-slate-50 py-16">
          <div className="container-bmpl">
            <Card className="p-8 text-center text-slate-500">
              This job is temporarily unavailable. Please try again in a moment.
            </Card>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  const job = res.data;
  const salary = formatSalary(job.salary);
  const deadline = deadlineInfo(job.applicationDeadline);

  return (
    <>
      <Header />
      <RecentlyViewedTracker jobId={job.id} />
      <main className="bg-slate-50 pb-16">
        <div className="container-bmpl py-8">
          <Breadcrumbs
            items={[
              { label: 'Belize Connect', href: '/jobs' },
              ...(job.category ? [{ label: job.category.name, href: `/jobs?category=${job.category.slug}` }] : []),
              { label: job.title },
            ]}
            className="mb-3"
          />
          <Link href="/jobs" className="text-sm font-medium text-belize-blue hover:underline">
            ← All jobs
          </Link>

          <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_340px]">
            {/* main */}
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-belize-navy sm:text-3xl">{job.title}</h1>
                <p className="mt-1 text-slate-600">
                  <Link href={`/companies/${job.company.slug}`} className="font-medium text-belize-blue hover:underline">
                    {job.company.name}
                  </Link>{' '}
                  · {locationLabel(job)}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <JobBadges employmentType={job.employmentType} workArrangement={job.workArrangement} />
                  {job.category && <Badge tone="neutral">{job.category.name}</Badge>}
                  {job.experienceLevel && (
                    <Badge tone="neutral">{EXPERIENCE_LEVEL_LABELS[job.experienceLevel]}</Badge>
                  )}
                  {deadline && (
                    <Badge tone={deadline.closed ? 'neutral' : deadline.soon ? 'warning' : 'info'}>
                      {deadline.label}
                    </Badge>
                  )}
                </div>
              </div>

              <ProseSection title="About this role" body={job.description} />
              <ProseSection title="Responsibilities" body={job.responsibilities} />
              <ProseSection title="Requirements" body={job.requirements} />
              <ProseSection title="Preferred qualifications" body={job.preferredQualifications} />

              {job.skills.length > 0 && (
                <Card className="p-5">
                  <h2 className="text-lg font-bold text-belize-navy">Skills</h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {job.skills.map((s) => (
                      <Badge key={s.name} tone={s.required ? 'brand' : 'neutral'}>
                        {s.name}
                        {s.required ? ' *' : ''}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-400">* required</p>
                </Card>
              )}

              {job.benefits.length > 0 && (
                <Card className="p-5">
                  <h2 className="text-lg font-bold text-belize-navy">Benefits</h2>
                  <ul className="mt-3 grid list-disc gap-1.5 pl-5 text-sm text-slate-600 sm:grid-cols-2">
                    {job.benefits.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </Card>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <DetailRow label="Education" value={job.educationLevel ? EDUCATION_LEVEL_LABELS[job.educationLevel] : null} />
                <DetailRow label="Openings" value={job.openings != null ? String(job.openings) : null} />
                <DetailRow label="Start date" value={job.startDate ? fmtDate(job.startDate) : null} />
                <DetailRow label="Posted" value={job.publishedAt ? fmtDate(job.publishedAt) : null} />
              </div>
            </div>

            {/* sidebar */}
            <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
              <Card className="space-y-4 p-5">
                {salary ? (
                  <div>
                    <p className="bmpl-eyebrow">Salary</p>
                    <p className="mt-0.5 text-lg font-bold text-belize-navy">{salary}</p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">Salary not disclosed</p>
                )}
                <JobApplyPanel job={job} />
                <SaveJobButton jobId={job.id} slug={job.slug} withLabel className="w-full justify-center" />
                <div className="border-t border-slate-100 pt-3">
                  <ReportJobDialog jobId={job.id} slug={job.slug} />
                </div>
              </Card>

              {job.companyProfile && (
                <Card className="space-y-2 p-5">
                  <p className="bmpl-eyebrow">About the company</p>
                  <div className="flex items-center gap-3">
                    {job.companyProfile.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={job.companyProfile.logoUrl}
                        alt={`${job.companyProfile.companyName} logo`}
                        className="h-12 w-12 shrink-0 rounded-bmpl-md object-cover"
                      />
                    ) : (
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-bmpl-md bg-belize-blue text-sm font-bold text-white">
                        {job.companyProfile.companyName.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <div>
                      <Link
                        href={`/companies/${job.companyProfile.slug}`}
                        className="font-semibold text-belize-navy hover:text-belize-blue"
                      >
                        {job.companyProfile.companyName}
                      </Link>
                      {job.companyProfile.industry && (
                        <p className="text-xs text-slate-500">{job.companyProfile.industry}</p>
                      )}
                    </div>
                  </div>
                  {job.companyProfile.description && (
                    <p className="line-clamp-4 text-sm text-slate-600">{job.companyProfile.description}</p>
                  )}
                  <Link
                    href={`/companies/${job.companyProfile.slug}`}
                    className="inline-block text-sm font-medium text-belize-blue hover:underline"
                  >
                    View company & all jobs →
                  </Link>
                </Card>
              )}
            </aside>
          </div>

          {job.related.length > 0 && (
            <section className="mt-12">
              <h2 className="mb-4 text-lg font-bold text-belize-navy">Related jobs</h2>
              <JobList jobs={job.related} />
            </section>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}

function ProseSection({ title, body }: { title: string; body: string | null }) {
  if (!body) return null;
  return (
    <Card className="p-5">
      <h2 className="text-lg font-bold text-belize-navy">{title}</h2>
      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">{body}</p>
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="rounded-bmpl-md border border-slate-200 bg-white p-3">
      <p className="bmpl-eyebrow">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-belize-navy">{value}</p>
    </div>
  );
}

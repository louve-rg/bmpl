import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '../../../components/landing/Header';
import { Footer } from '../../../components/landing/Footer';
import { serverGetSafe } from '../../../lib/server-api';
import { Badge, Card } from '../../../components/ui';
import { JobList } from '../../../components/jobs/JobCard';
import { districtLabel, type CompanySummary, type JobList as JobListType } from '../../../lib/jobs';

export const dynamic = 'force-dynamic';

export default async function CompanyPage({ params }: { params: { slug: string } }) {
  const companyRes = await serverGetSafe<CompanySummary>(
    `/jobs/companies/${encodeURIComponent(params.slug)}`,
  );
  if (!companyRes.ok) {
    if (companyRes.notFound) notFound();
    return (
      <>
        <Header />
        <main className="bg-slate-50 py-16">
          <div className="container-bmpl">
            <Card className="p-8 text-center text-slate-500">
              This company page is temporarily unavailable.
            </Card>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  const company = companyRes.data;

  // The public search has no company filter, so match by company name then keep
  // only listings that belong to this exact company slug.
  const jobsRes = await serverGetSafe<JobListType>(
    `/jobs?q=${encodeURIComponent(company.companyName)}&page=1`,
  );
  const jobs = jobsRes.ok ? jobsRes.data.items.filter((j) => j.company.slug === company.slug) : [];

  return (
    <>
      <Header />
      <main className="bg-slate-50">
        <div className="h-32 w-full bg-gradient-to-r from-belize-navy to-belize-blue sm:h-44">
          {company.bannerUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.bannerUrl} alt={`${company.companyName} banner`} className="h-full w-full object-cover" />
          )}
        </div>

        <div className="container-bmpl -mt-10 pb-14">
          <div className="flex items-end gap-4">
            {company.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={company.logoUrl}
                alt={`${company.companyName} logo`}
                className="h-20 w-20 shrink-0 rounded-bmpl-lg border-4 border-white object-cover shadow-bmpl-md"
              />
            ) : (
              <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-bmpl-lg border-4 border-white bg-belize-blue text-xl font-bold text-white shadow-bmpl-md">
                {company.companyName.slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="pb-1">
              <h1 className="text-2xl font-bold tracking-tight text-belize-navy">{company.companyName}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                {company.industry && <span>{company.industry}</span>}
                {(company.city || company.district) && (
                  <span>{[company.city, districtLabel(company.district)].filter(Boolean).join(', ')}</span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone="brand">{company.openJobs} open job{company.openJobs === 1 ? '' : 's'}</Badge>
            {company.companySize && <Badge tone="neutral">{company.companySize}</Badge>}
          </div>

          {company.description && (
            <p className="mt-5 max-w-2xl whitespace-pre-line text-slate-600">{company.description}</p>
          )}
          {company.website && (
            <a
              href={company.website}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-sm font-medium text-belize-blue hover:underline"
            >
              {company.website} ↗
            </a>
          )}

          <section className="mt-10">
            <h2 className="mb-4 text-lg font-bold text-belize-navy">Open positions</h2>
            <JobList
              jobs={jobs}
              emptyTitle="No open positions right now"
              emptyDescription="Check back soon, or browse other jobs on Belize Connect."
            />
            <div className="mt-6">
              <Link href="/jobs" className="text-sm font-medium text-belize-blue hover:underline">
                ← Browse all jobs
              </Link>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}

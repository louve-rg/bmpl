import Link from 'next/link';
import { Header } from '../../components/landing/Header';
import { Footer } from '../../components/landing/Footer';
import { serverGetSafe } from '../../lib/server-api';
import { Alert } from '../../components/ui';
import { JobList } from '../../components/jobs/JobCard';
import { SearchFilters, type JobFilterValues } from '../../components/jobs/SearchFilters';
import type { JobCategory, JobList as JobListType } from '../../lib/jobs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Belize Connect · Jobs · Belize Marketplace & Logistics' };

const FILTER_KEYS = [
  'q',
  'category',
  'district',
  'employmentType',
  'workArrangement',
  'remote',
  'salaryMin',
  'experienceLevel',
  'sort',
] as const;

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const apiParams = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const val = searchParams[key];
    if (val) apiParams.set(key, val);
  }
  apiParams.set('page', searchParams.page ?? '1');

  const [listRes, catsRes] = await Promise.all([
    serverGetSafe<JobListType>(`/jobs?${apiParams.toString()}`),
    serverGetSafe<JobCategory[]>('/jobs/categories'),
  ]);

  const unavailable = !listRes.ok;
  const data = listRes.ok ? listRes.data : { total: 0, page: 1, pageSize: 20, items: [] };
  const cats = catsRes.ok ? catsRes.data : [];
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  const initial: JobFilterValues = {};
  for (const key of FILTER_KEYS) {
    if (searchParams[key]) initial[key] = searchParams[key];
  }

  const pageHref = (page: number) => {
    const p = new URLSearchParams();
    for (const key of FILTER_KEYS) if (searchParams[key]) p.set(key, searchParams[key]!);
    p.set('page', String(page));
    return `/jobs?${p.toString()}`;
  };

  return (
    <>
      <Header />
      <main className="bg-slate-50">
        <section className="bg-gradient-to-r from-belize-navy to-belize-blue">
          <div className="container-bmpl py-12 sm:py-16">
            <p className="text-sm font-semibold uppercase tracking-wide text-belize-accent">Belize Connect</p>
            <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">Find your next job in Belize</h1>
            <p className="mt-3 max-w-2xl text-blue-100">
              Browse open positions from employers across all six districts. Save jobs, build your profile,
              and apply in minutes.
            </p>
          </div>
        </section>

        <div className="container-bmpl -mt-8 pb-14">
          <SearchFilters categories={cats} initial={initial} />

          <div className="mt-6 flex items-center justify-between">
            <p className="text-sm text-slate-500">
              {unavailable ? 'Jobs are temporarily unavailable.' : `${data.total} job${data.total === 1 ? '' : 's'} found`}
            </p>
          </div>

          <div className="mt-4">
            {unavailable ? (
              <Alert tone="warning">Belize Connect is temporarily unavailable. Please try again in a moment.</Alert>
            ) : (
              <JobList
                jobs={data.items}
                emptyTitle="No jobs match your search"
                emptyDescription="Try widening your filters or clearing them to see all open positions."
              />
            )}
          </div>

          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-2 text-sm">
              {data.page > 1 && (
                <Link
                  href={pageHref(data.page - 1)}
                  className="rounded-bmpl-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-600 transition hover:border-belize-light/60 hover:text-belize-navy"
                >
                  ← Prev
                </Link>
              )}
              <span className="px-3 py-1.5 text-slate-500">
                Page {data.page} of {totalPages}
              </span>
              {data.page < totalPages && (
                <Link
                  href={pageHref(data.page + 1)}
                  className="rounded-bmpl-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-600 transition hover:border-belize-light/60 hover:text-belize-navy"
                >
                  Next →
                </Link>
              )}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}

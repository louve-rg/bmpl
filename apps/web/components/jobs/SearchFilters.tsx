'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DISTRICTS,
  DISTRICT_LABELS,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
  WORK_ARRANGEMENTS,
  WORK_ARRANGEMENT_LABELS,
  EXPERIENCE_LEVELS,
  EXPERIENCE_LEVEL_LABELS,
  JOB_SORTS,
} from '@bmpl/shared';
import { Button, Input, Label, Select } from '../ui';
import type { JobCategory } from '../../lib/jobs';

const SORT_LABELS: Record<(typeof JOB_SORTS)[number], string> = {
  relevance: 'Relevance',
  newest: 'Newest',
  deadline: 'Closing soon',
  salary_asc: 'Salary: low to high',
  salary_desc: 'Salary: high to low',
};

export interface JobFilterValues {
  q?: string;
  category?: string;
  district?: string;
  employmentType?: string;
  workArrangement?: string;
  remote?: string;
  salaryMin?: string;
  experienceLevel?: string;
  sort?: string;
}

/**
 * Belize Connect search + filters. Controlled client form that pushes the
 * selected filters to the URL (guests fully supported — results are rendered by
 * the server page from the query string).
 */
export function SearchFilters({
  categories,
  initial,
}: {
  categories: JobCategory[];
  initial: JobFilterValues;
}) {
  const router = useRouter();
  const [v, setV] = useState<JobFilterValues>(initial);

  function set<K extends keyof JobFilterValues>(k: K, val: string) {
    setV((prev) => ({ ...prev, [k]: val || undefined }));
  }

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const p = new URLSearchParams();
    for (const [k, val] of Object.entries(v)) {
      if (val) p.set(k, val);
    }
    p.set('page', '1');
    router.push(`/jobs?${p.toString()}`);
  }

  function reset() {
    setV({});
    router.push('/jobs');
  }

  return (
    <form onSubmit={apply} className="bmpl-card space-y-4 p-4 sm:p-5">
      <div>
        <Label htmlFor="job-q">Search jobs</Label>
        <Input
          id="job-q"
          value={v.q ?? ''}
          onChange={(e) => set('q', e.target.value)}
          placeholder="Job title, skill or company"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Label htmlFor="job-category">Category</Label>
          <Select id="job-category" value={v.category ?? ''} onChange={(e) => set('category', e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="job-district">District</Label>
          <Select id="job-district" value={v.district ?? ''} onChange={(e) => set('district', e.target.value)}>
            <option value="">All districts</option>
            {DISTRICTS.map((d) => (
              <option key={d} value={d}>
                {DISTRICT_LABELS[d]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="job-type">Employment type</Label>
          <Select id="job-type" value={v.employmentType ?? ''} onChange={(e) => set('employmentType', e.target.value)}>
            <option value="">Any type</option>
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EMPLOYMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="job-arrangement">Work arrangement</Label>
          <Select id="job-arrangement" value={v.workArrangement ?? ''} onChange={(e) => set('workArrangement', e.target.value)}>
            <option value="">Any arrangement</option>
            {WORK_ARRANGEMENTS.map((w) => (
              <option key={w} value={w}>
                {WORK_ARRANGEMENT_LABELS[w]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="job-experience">Experience level</Label>
          <Select id="job-experience" value={v.experienceLevel ?? ''} onChange={(e) => set('experienceLevel', e.target.value)}>
            <option value="">Any level</option>
            {EXPERIENCE_LEVELS.map((x) => (
              <option key={x} value={x}>
                {EXPERIENCE_LEVEL_LABELS[x]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="job-salary">Min. salary ($)</Label>
          <Input
            id="job-salary"
            inputMode="decimal"
            value={v.salaryMin ?? ''}
            onChange={(e) => set('salaryMin', e.target.value)}
            placeholder="e.g. 1500"
          />
        </div>
        <div>
          <Label htmlFor="job-sort">Sort by</Label>
          <Select id="job-sort" value={v.sort ?? ''} onChange={(e) => set('sort', e.target.value)}>
            <option value="">Relevance</option>
            {JOB_SORTS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 pt-6 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={v.remote === 'true'}
            onChange={(e) => set('remote', e.target.checked ? 'true' : '')}
            className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-accent"
          />
          Remote only
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit">Search jobs</Button>
        <Button type="button" variant="ghost" onClick={reset}>
          Clear filters
        </Button>
      </div>
    </form>
  );
}

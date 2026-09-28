// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import JobsPage from './page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-281: the jobs console (BMPL-270 part B) gates THREE independent
 * permissions across three tabs — jobs.moderate (moderation queue + reports),
 * employers.moderate (employer suspend/restore) and job_categories.manage
 * (categories create/rename/hide-show, a third write surface found while
 * reading this file during part B, not named in the original scoping). A
 * reader holding jobs.moderate but not employers.moderate must see one and
 * not the other — each permission is asserted independently, not collapsed
 * to "reader with nothing sees nothing".
 *
 * Fixtures: the job is SUBMITTED (moderation actions status-eligible), the
 * employer is APPROVED (Suspend is status-eligible, not Restore), and one
 * category exists (Rename/Hide are always shown when canManage; Add category
 * is the create affordance).
 */

const JOB_LIST_ITEM = {
  id: 'job_1',
  title: 'Warehouse Associate',
  slug: 'warehouse-associate',
  status: 'SUBMITTED' as const,
  company: 'Belize Distributors',
  employmentType: 'FULL_TIME',
  workArrangement: 'ON_SITE',
  district: 'BELIZE',
  city: 'Belize City',
  salary: null,
  applicationCount: 3,
  reportCount: 0,
  moderationReason: null,
  publishedAt: null,
  createdAt: new Date().toISOString(),
};

const JOB_DETAIL = {
  id: 'job_1',
  title: 'Warehouse Associate',
  slug: 'warehouse-associate',
  status: 'SUBMITTED' as const,
  company: { name: 'Belize Distributors', slug: 'belize-distributors' },
  category: null,
  employmentType: 'FULL_TIME',
  workArrangement: 'ON_SITE',
  district: 'BELIZE',
  city: 'Belize City',
  remoteEligible: false,
  salary: null,
  description: 'Loading and unloading trucks at the Belize City warehouse.',
  responsibilities: null,
  requirements: null,
  preferredQualifications: null,
  experienceLevel: null,
  educationLevel: null,
  openings: 2,
  startDate: null,
  applicationDeadline: null,
  applicationMethod: null,
  externalUrl: null,
  applicationEmail: null,
  skills: [],
  benefits: [],
  questions: [],
  moderationReason: null,
  publishedAt: null,
  createdAt: new Date().toISOString(),
};

const EMPLOYER_LIST_ITEM = {
  id: 'emp_1',
  companyName: 'Belize Distributors',
  slug: 'belize-distributors',
  industry: 'Logistics',
  district: 'BELIZE',
  approvalStatus: 'APPROVED',
  jobCount: 4,
  createdAt: new Date().toISOString(),
};

const EMPLOYER_DETAIL = {
  ...EMPLOYER_LIST_ITEM,
  description: null,
  website: null,
  contactEmail: 'hr@belizedist.com',
  jobsByStatus: [{ status: 'PUBLISHED', count: 4 }],
};

const CATEGORY = {
  id: 'cat_1',
  name: 'Logistics',
  slug: 'logistics',
  isVisible: true,
  sortOrder: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(adminPermissions: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions });
      if (url.includes('/api/admin/jobs/reports')) return jsonResponse(200, []);
      if (url.includes('/api/admin/jobs/employers/emp_1')) return jsonResponse(200, EMPLOYER_DETAIL);
      if (url.includes('/api/admin/jobs/employers')) return jsonResponse(200, [EMPLOYER_LIST_ITEM]);
      if (url.includes('/api/admin/jobs/categories')) return jsonResponse(200, [CATEGORY]);
      if (url.includes('/api/admin/jobs/analytics')) return jsonResponse(200, {});
      if (url.includes('/api/admin/jobs/job_1')) return jsonResponse(200, JOB_DETAIL);
      if (url.includes('/api/admin/jobs')) return jsonResponse(200, [JOB_LIST_ITEM]);
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<JobsPage />);
  });
  await settle();
}

async function clickTab(label: string) {
  const tabs = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button[role="tab"]'));
  const tab = tabs.find((t) => t.textContent?.trim() === label);
  if (!tab) throw new Error(`${label} tab not found`);
  await act(async () => {
    tab.click();
  });
  await settle();
}

function buttonTexts(): string[] {
  return Array.from(document.body.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('JobsPage — three independent permissions (BMPL-281)', () => {
  it('a reader with none of the three permissions sees no write affordance on any tab, and the facts still render', async () => {
    stubFetch(['jobs.read']);
    await mount();

    let texts = buttonTexts();
    expect(texts.some((t) => t === 'Approve & publish')).toBe(false);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);
    expect(document.body.textContent).toMatch(/Warehouse Associate/);

    await clickTab('Employers');
    texts = buttonTexts();
    expect(texts.some((t) => t === 'Suspend')).toBe(false);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);
    expect(document.body.textContent).toMatch(/Belize Distributors/);

    await clickTab('Categories');
    texts = buttonTexts();
    expect(texts.some((t) => t === 'Add category')).toBe(false);
    expect(texts.some((t) => t === 'Rename')).toBe(false);
    expect(texts.some((t) => t === 'Hide')).toBe(false);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);
    expect(document.body.textContent).toMatch(/Logistics/);
  });

  it('jobs.moderate alone shows moderation actions but not employer or category write affordances', async () => {
    stubFetch(['jobs.moderate']);
    await mount();

    expect(buttonTexts()).toContain('Approve & publish');

    await clickTab('Employers');
    expect(buttonTexts().some((t) => t === 'Suspend')).toBe(false);

    await clickTab('Categories');
    expect(buttonTexts().some((t) => t === 'Add category')).toBe(false);
  });

  it('employers.moderate alone shows employer Suspend but not moderation actions or category write affordances', async () => {
    stubFetch(['employers.moderate']);
    await mount();

    expect(buttonTexts().some((t) => t === 'Approve & publish')).toBe(false);

    await clickTab('Employers');
    expect(buttonTexts()).toContain('Suspend');

    await clickTab('Categories');
    expect(buttonTexts().some((t) => t === 'Add category')).toBe(false);
  });

  it('job_categories.manage alone shows the category write affordances but not moderation or employer actions', async () => {
    stubFetch(['job_categories.manage']);
    await mount();

    expect(buttonTexts().some((t) => t === 'Approve & publish')).toBe(false);

    await clickTab('Employers');
    expect(buttonTexts().some((t) => t === 'Suspend')).toBe(false);

    await clickTab('Categories');
    const texts = buttonTexts();
    expect(texts).toContain('Add category');
    expect(texts).toContain('Rename');
    expect(texts).toContain('Hide');
  });

  it('holding all three shows every write affordance on its own tab', async () => {
    stubFetch(['jobs.moderate', 'employers.moderate', 'job_categories.manage']);
    await mount();

    expect(buttonTexts()).toContain('Approve & publish');

    await clickTab('Employers');
    expect(buttonTexts()).toContain('Suspend');

    await clickTab('Categories');
    const texts = buttonTexts();
    expect(texts).toContain('Add category');
    expect(texts).toContain('Rename');
  });
});

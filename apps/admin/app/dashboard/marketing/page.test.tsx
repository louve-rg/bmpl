// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MarketingPage from './page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-274/276 shape: marketing's ad-placement tab (BMPL-269) hides the
 * assign-campaign form and every row control from a promotions.read-only
 * reader, and shows them to a promotions.manage operator. The page defaults
 * to the moderation tab, so the test clicks into "Ad Placements" first —
 * exactly what an operator would do — before asserting.
 */

const PLACEMENT_ROW = {
  id: 'pl_1',
  promotionId: 'promo_1',
  placement: 'HOMEPAGE_HERO' as const,
  position: 1,
  categoryId: null,
  isActive: true,
  device: 'BOTH' as const,
  startAt: null,
  endAt: null,
  assignedById: null,
  createdAt: new Date().toISOString(),
  promotion: { id: 'promo_1', title: 'Founders Week Sale', type: 'BANNER', status: 'APPROVED', priority: 10, isActive: true },
  category: null,
};

/**
 * BMPL-281: the promotion-detail panel (BMPL-270 part B) is the one piece of
 * the whole fourteen-screen gating sweep never observed rendering live —
 * this dev environment has zero promotions (bmpl-web, part B's PR). A
 * stubbed fetch returning one promotion is a test fixture standing in for
 * that gap, not invented business data: the shape mirrors the documented
 * GET /admin/marketing/promotions response, and no price, rate or geography
 * is fabricated. The promotion is SUBMITTED so the moderation actions
 * (Approve & publish / Request info / Reject) are status-eligible.
 *
 * TWO independent permissions gate this one panel: promotions.moderate
 * (moderation actions) and promotions.manage (the separate priority/feature
 * control). promotions.manage is the SAME permission PlacementsTab's
 * canManage already checks above (BMPL-269/274), but a deliberately separate
 * component tree with its own /me fetch (the page's own comment) — so this
 * test exercises it independently rather than assuming the two must agree,
 * and its overlap with the placements assertions above is that comment's
 * documented relationship, not this test's framing being redundant.
 */
const PROMOTION_LIST_ITEM = {
  id: 'promo_1',
  type: 'BANNER',
  title: 'Founders Week Sale',
  subtitle: 'Storewide discount',
  priority: 5,
  startAt: null,
  endAt: null,
  assets: [],
  placements: [],
  target: null,
  targets: [],
  publishedAt: null,
  status: 'SUBMITTED',
  isActive: false,
  campaignId: null,
  updatedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  moderationReason: null,
  ownerEmail: null,
  reportCount: 0,
};

const PROMOTION_DETAIL = {
  id: 'promo_1',
  type: 'BANNER',
  title: 'Founders Week Sale',
  subtitle: 'Storewide discount',
  description: 'A storewide promotional banner.',
  status: 'SUBMITTED',
  priority: 5,
  isActive: false,
  startAt: null,
  endAt: null,
  timezone: 'America/Belize',
  campaign: null,
  assets: [],
  placements: [],
  targets: [],
  publishedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  moderationReason: null,
  moderatedById: null,
  submittedAt: new Date().toISOString(),
  approvedAt: null,
  expiredAt: null,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface CategoryFixture {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  iconName: string | null;
  imageKey: string | null;
  featured: boolean;
  isVisible: boolean;
  sortOrder: number;
  parentId: string | null;
  childCount: number;
}

function category(overrides: Partial<CategoryFixture> & { id: string; name: string }): CategoryFixture {
  return {
    slug: overrides.id,
    description: null,
    iconName: null,
    imageKey: null,
    featured: false,
    isVisible: true,
    sortOrder: 0,
    parentId: null,
    childCount: 0,
    ...overrides,
  };
}

const APPROVED_CAMPAIGN = { ...PROMOTION_LIST_ITEM, id: 'promo_approved', title: 'Approved Banner', status: 'APPROVED' as const };

function stubFetch(
  adminPermissions: string[],
  opts: {
    withPromotion?: boolean;
    categories?: CategoryFixture[] | 'forbidden' | 'error';
    withApprovedCampaign?: boolean;
    assignResult?: { status: number; body: unknown };
  } = {},
) {
  const assignCalls: Array<{ body: Record<string, unknown> }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions });
      if (url.includes('/api/admin/categories')) {
        if (opts.categories === 'forbidden') return jsonResponse(403, { message: 'Forbidden' });
        if (opts.categories === 'error') return jsonResponse(500, { message: 'Internal error' });
        return jsonResponse(200, opts.categories ?? []);
      }
      if (url.includes('/api/admin/marketing/placements')) return jsonResponse(200, [PLACEMENT_ROW]);
      if (/\/api\/admin\/marketing\/promotions\/[^/]+\/placements$/.test(url) && init?.method === 'POST') {
        const body = init.body ? JSON.parse(String(init.body)) : {};
        assignCalls.push({ body });
        if (opts.assignResult) return jsonResponse(opts.assignResult.status, opts.assignResult.body);
        return jsonResponse(201, { id: 'pl_new', ...body, isActive: true, createdAt: new Date().toISOString(), promotion: APPROVED_CAMPAIGN, category: null });
      }
      if (url.includes('/api/admin/marketing/promotions/promo_1')) {
        return opts.withPromotion ? jsonResponse(200, PROMOTION_DETAIL) : jsonResponse(404, { message: 'not found' });
      }
      if (url.includes('/api/admin/marketing/promotions')) {
        if (url.includes('status=APPROVED')) return jsonResponse(200, opts.withApprovedCampaign ? [APPROVED_CAMPAIGN] : []);
        // Moderation tab (mounted by default) hits this with no status filter.
        return jsonResponse(200, opts.withPromotion ? [PROMOTION_LIST_ITEM] : []);
      }
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
  return assignCalls;
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<MarketingPage />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

  // Switch to the "Ad Placements" tab, same as an operator clicking it.
  const tabs = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button[role="tab"]'));
  const placementsTab = tabs.find((t) => t.textContent?.trim() === 'Ad Placements');
  if (!placementsTab) throw new Error('Ad Placements tab not found');
  await act(async () => {
    placementsTab.click();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/**
 * Stays on the default "Moderation queue" tab — where PromotionDetailPanel
 * mounts once the (stubbed) list resolves and auto-selects its one item.
 * Two settle ticks: list fetch resolves and selects an id, THEN the detail
 * panel mounts and fires its own fetch.
 */
async function mountModerationTab() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<MarketingPage />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function buttonTexts(): string[] {
  return Array.from(document.body.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
}

function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function clickButton(text: string) {
  const btn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`no button with text "${text}"`);
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('MarketingPage — ad-placement write affordances gated on promotions.manage (BMPL-274)', () => {
  it('a promotions.read-only reader sees no write affordance in the placements tab', async () => {
    stubFetch(['promotions.read']);
    await mount();

    const texts = buttonTexts();
    expect(texts).not.toContain('Assign a campaign');
    expect(texts.some((t) => t === 'Pause' || t === 'Resume')).toBe(false);
    expect(texts.some((t) => t === 'Edit')).toBe(false);
    expect(texts.some((t) => t === 'Remove')).toBe(false);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);

    // Read-only report half: the assignment itself is still information.
    expect(document.body.textContent).toMatch(/Founders Week Sale/);
    expect(document.body.textContent).toMatch(/Position 1/);
  });

  it('a promotions.manage operator sees every write affordance', async () => {
    stubFetch(['promotions.manage']);
    await mount();

    const texts = buttonTexts();
    expect(texts).toContain('Assign a campaign');
    expect(texts).toContain('Pause');
    expect(texts).toContain('Edit');
    expect(texts).toContain('Remove');
  });
});

describe('MarketingPage — promotion-detail panel, two independent permissions (BMPL-281)', () => {
  it('a reader with neither permission sees no moderation action and no priority control, and the promotion facts still render', async () => {
    stubFetch(['promotions.read'], { withPromotion: true });
    await mountModerationTab();

    const texts = buttonTexts();
    expect(texts.some((t) => t === 'Approve & publish')).toBe(false);
    expect(texts.some((t) => t === 'Reject')).toBe(false);
    expect(texts.some((t) => t === 'Save priority')).toBe(false);
    expect(texts.some((t) => t === 'Feature (serve)')).toBe(false);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);

    expect(document.body.textContent).toMatch(/Founders Week Sale/);
    expect(document.body.textContent).toMatch(/Storewide discount/);
  });

  it('promotions.moderate alone shows moderation actions but not the priority control', async () => {
    stubFetch(['promotions.moderate'], { withPromotion: true });
    await mountModerationTab();

    const texts = buttonTexts();
    expect(texts).toContain('Approve & publish');
    expect(texts).toContain('Reject');
    expect(texts.some((t) => t === 'Save priority')).toBe(false);
  });

  it('promotions.manage alone shows the priority control but not the moderation actions', async () => {
    stubFetch(['promotions.manage'], { withPromotion: true });
    await mountModerationTab();

    const texts = buttonTexts();
    expect(texts).toContain('Save priority');
    expect(texts.some((t) => t === 'Approve & publish')).toBe(false);
    expect(texts.some((t) => t === 'Reject')).toBe(false);
  });

  it('holding both shows every write affordance on the panel', async () => {
    stubFetch(['promotions.moderate', 'promotions.manage'], { withPromotion: true });
    await mountModerationTab();

    const texts = buttonTexts();
    expect(texts).toContain('Approve & publish');
    expect(texts).toContain('Reject');
    expect(texts).toContain('Save priority');
  });
});

/**
 * BMPL-COURIER-COMPLETION: "Category ID" used to be a free-typed input with
 * no lookup at all -- a typo or a stale id created a placement that would
 * silently never render anywhere. It is now a real selection from the same
 * category list the Categories page shows, filtered to visible categories,
 * and the form will not submit a category placement until one is chosen.
 */
describe('AssignPlacementForm — real category selection, not a typed id (BMPL-COURIER-COMPLETION)', () => {
  async function openForm() {
    await mount();
    clickButton('Assign a campaign');
    await flush();
  }

  it('the category field is disabled for a non-category placement, and offers no free-text id', async () => {
    stubFetch(['promotions.manage'], { withApprovedCampaign: true, categories: [category({ id: 'cat1', name: 'Electronics' })] });
    await openForm();

    const catField = document.getElementById('pf-cat') as HTMLSelectElement;
    expect(catField.tagName).toBe('SELECT');
    expect(catField.disabled).toBe(true);
    expect(document.body.textContent).toMatch(/Only used by the category page slot\./);
  });

  it('switching to Category page offers only the visible categories by name, and blocks submission until one is picked', async () => {
    const assignCalls = stubFetch(['promotions.manage'], {
      withApprovedCampaign: true,
      categories: [category({ id: 'cat1', name: 'Electronics' }), category({ id: 'cat2', name: 'Hidden Category', isVisible: false })],
    });
    await openForm();

    setValue(document.getElementById('pf-slot') as HTMLSelectElement, 'CATEGORY_PAGE');
    await flush();

    const catField = document.getElementById('pf-cat') as HTMLSelectElement;
    expect(catField.disabled).toBe(false);
    const optionLabels = Array.from(catField.options).map((o) => o.textContent?.trim());
    expect(optionLabels.some((l) => l?.includes('Electronics'))).toBe(true);
    expect(optionLabels.some((l) => l?.includes('Hidden Category'))).toBe(false);

    setValue(document.getElementById('pf-promo') as HTMLSelectElement, 'promo_approved');
    await flush();
    expect((Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Assign placement') as HTMLButtonElement).disabled).toBe(
      true,
    );

    setValue(catField, 'cat1');
    await flush();
    const assignBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Assign placement') as HTMLButtonElement;
    expect(assignBtn.disabled).toBe(false);

    clickButton('Assign placement');
    await flush();

    expect(assignCalls).toHaveLength(1);
    expect(assignCalls[0]?.body).toMatchObject({ placement: 'CATEGORY_PAGE', categoryId: 'cat1' });
  });

  it('no categories available disables the picker and keeps the assign button off even with a campaign chosen', async () => {
    stubFetch(['promotions.manage'], { withApprovedCampaign: true, categories: [] });
    await openForm();

    setValue(document.getElementById('pf-slot') as HTMLSelectElement, 'CATEGORY_PAGE');
    await flush();
    setValue(document.getElementById('pf-promo') as HTMLSelectElement, 'promo_approved');
    await flush();

    expect(document.body.textContent).toMatch(/No categories are available to choose/);
    const assignBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Assign placement') as HTMLButtonElement;
    expect(assignBtn.disabled).toBe(true);
  });

  it('a forbidden categories read disables the picker with an explanatory hint, without breaking the rest of the form', async () => {
    stubFetch(['promotions.manage'], { withApprovedCampaign: true, categories: 'forbidden' });
    await openForm();

    setValue(document.getElementById('pf-slot') as HTMLSelectElement, 'CATEGORY_PAGE');
    await flush();

    expect(document.body.textContent).toMatch(/don't have the categories\.manage permission/);
    expect((document.getElementById('pf-cat') as HTMLSelectElement).disabled).toBe(true);
    // The rest of the form is unaffected by the categories read failing.
    expect((document.getElementById('pf-promo') as HTMLSelectElement).disabled).toBe(false);
  });

  it('choosing a placement away from Category page drops a previously chosen category rather than silently keeping it', async () => {
    stubFetch(['promotions.manage'], { withApprovedCampaign: true, categories: [category({ id: 'cat1', name: 'Electronics' })] });
    await openForm();

    const slot = document.getElementById('pf-slot') as HTMLSelectElement;
    setValue(slot, 'CATEGORY_PAGE');
    await flush();
    setValue(document.getElementById('pf-cat') as HTMLSelectElement, 'cat1');
    await flush();
    expect((document.getElementById('pf-cat') as HTMLSelectElement).value).toBe('cat1');

    setValue(slot, 'MARKETPLACE');
    await flush();

    expect((document.getElementById('pf-cat') as HTMLSelectElement).value).toBe('');
  });
});

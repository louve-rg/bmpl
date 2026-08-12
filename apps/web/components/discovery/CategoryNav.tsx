import Link from 'next/link';
import { findCategory, type CatNode } from '../../lib/marketplace-categories';

export type { CatNode };

/**
 * Marketplace category navigation.
 *
 * DESKTOP is unchanged — the sticky sidebar list works, so it stays exactly as
 * it was. On a PHONE the same list stacked above the products and pushed the
 * grid off the first screen entirely, which is what the client reported: every
 * top-level category plus every subcategory, flat, before a single product.
 *
 * The mobile control is a `<details>` disclosure. That choice is deliberate:
 * it is a native, keyboard-operable, screen-reader-announced expander that works
 * with JavaScript disabled — this page is a server component, and a custom
 * dropdown would have forced a client bundle onto the shop's most-visited route
 * to reproduce behaviour the platform already provides.
 *
 * The taxonomy is untouched: the same `cats` tree, the same ids, the same
 * two-level hierarchy, the same `?categoryId=` links, so selecting a category on
 * a phone filters exactly as it does on a desktop.
 */
export function CategoryNav({
  cats,
  activeId,
  hrefFor,
}: {
  cats: CatNode[];
  activeId?: string;
  /** Builds the filter URL for a category id (undefined = "All"). */
  hrefFor: (categoryId: string | undefined) => string;
}) {
  const active = findCategory(cats, activeId);

  return (
    <>
      {/* ---- phone/tablet: one collapsed row ---- */}
      <details className="group bmpl-card overflow-hidden md:hidden">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Category</span>
            <span className="block truncate text-sm font-semibold text-belize-navy">{active?.name ?? 'All categories'}</span>
          </span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180"
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </summary>
        {/* Capped and scrollable: a long taxonomy must not turn the disclosure
            into a second full-page list, which is the problem being fixed. */}
        <nav aria-label="Product categories" className="max-h-[60vh] overflow-y-auto overscroll-contain border-t border-slate-100 p-2">
          <CategoryLinks cats={cats} activeId={activeId} hrefFor={hrefFor} />
        </nav>
      </details>

      {/* ---- desktop: the existing sticky sidebar, unchanged ---- */}
      <aside className="hidden md:sticky md:top-24 md:block md:self-start">
        <h2 className="bmpl-eyebrow mb-3">Categories</h2>
        <nav aria-label="Product categories" className="flex flex-col gap-0.5">
          <CategoryLinks cats={cats} activeId={activeId} hrefFor={hrefFor} />
        </nav>
      </aside>
    </>
  );
}

/** The link list itself — identical markup on both surfaces, so they cannot drift. */
function CategoryLinks({
  cats,
  activeId,
  hrefFor,
}: {
  cats: CatNode[];
  activeId?: string;
  hrefFor: (categoryId: string | undefined) => string;
}) {
  const cls = (isActive: boolean, child = false) =>
    `flex min-h-[40px] items-center rounded-bmpl-sm px-3 py-1.5 text-sm transition ${child ? 'pl-6' : ''} ${
      isActive ? 'bg-belize-blue/10 font-semibold text-belize-blue' : `${child ? 'text-slate-500' : 'text-slate-600'} hover:bg-slate-100`
    }`;

  return (
    <>
      <Link href={hrefFor(undefined)} aria-current={!activeId ? 'page' : undefined} className={cls(!activeId)}>
        All
      </Link>
      {cats.map((c) => (
        <div key={c.id}>
          <Link href={hrefFor(c.id)} aria-current={activeId === c.id ? 'page' : undefined} className={cls(activeId === c.id)}>
            {c.name}
          </Link>
          {(c.children ?? []).map((ch) => (
            <Link
              key={ch.id}
              href={hrefFor(ch.id)}
              aria-current={activeId === ch.id ? 'page' : undefined}
              className={cls(activeId === ch.id, true)}
            >
              {ch.name}
            </Link>
          ))}
        </div>
      ))}
    </>
  );
}

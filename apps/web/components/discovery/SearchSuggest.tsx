'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import { Spinner } from '../ui';

interface SuggestResponse {
  products: Array<{ title: string; slug: string }>;
  categories: Array<{ name: string; slug: string }>;
  vendors: Array<{ businessName: string; slug: string }>;
}

/** A flattened, navigable suggestion (across all groups) with its target href. */
interface FlatItem {
  key: string;
  label: string;
  href: string;
}

const EMPTY: SuggestResponse = { products: [], categories: [], vendors: [] };

/**
 * Debounced search typeahead. Queries the public suggest endpoint (>= 2 chars),
 * shows grouped results in a dropdown, and is fully keyboard accessible
 * (arrow/enter/escape) with outside-click dismissal. Submitting the raw query
 * navigates to the catalog search.
 */
export function SearchSuggest({
  defaultValue = '',
  placeholder = 'Search products, stores…',
  className = '',
  autoFocus = false,
}: {
  defaultValue?: string;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState(defaultValue);
  const [results, setResults] = useState<SuggestResponse>(EMPTY);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);

  const trimmed = query.trim();

  // Debounced fetch (~250ms). Hidden entirely below 2 chars.
  useEffect(() => {
    if (trimmed.length < 2) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .get<SuggestResponse>(`/marketplace/search/suggest?q=${encodeURIComponent(trimmed)}`)
        .then((d) => {
          if (cancelled) return;
          setResults(d ?? EMPTY);
          setLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setResults(EMPTY);
          setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [trimmed]);

  // Close on outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Flatten every group into a single navigable list (order = visual order).
  const flat: FlatItem[] = [
    ...results.products.map((p) => ({ key: `p:${p.slug}`, label: p.title, href: `/products/${p.slug}` })),
    ...results.categories.map((c) => ({
      key: `c:${c.slug}`,
      label: c.name,
      href: `/products?q=${encodeURIComponent(c.name)}`,
    })),
    ...results.vendors.map((v) => ({ key: `v:${v.slug}`, label: v.businessName, href: `/store/${v.slug}` })),
  ];

  const showDropdown = open && trimmed.length >= 2;
  const hasResults = flat.length > 0;

  function go(href: string) {
    setOpen(false);
    setActive(-1);
    router.push(href);
  }

  function submitRaw() {
    if (!trimmed) return;
    go(`/products?q=${encodeURIComponent(trimmed)}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (flat.length === 0 ? -1 : (i + 1) % flat.length));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (flat.length === 0 ? -1 : (i - 1 + flat.length) % flat.length));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const picked = active >= 0 ? flat[active] : undefined;
      if (picked) go(picked.href);
      else submitRaw();
    }
  }

  // Renders one group; `base` is the flat-index offset of the group's first row.
  function Group({
    heading,
    rows,
    base,
  }: {
    heading: string;
    rows: Array<{ key: string; label: string; sub?: string; href: string }>;
    base: number;
  }) {
    if (rows.length === 0) return null;
    return (
      <li role="presentation">
        <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{heading}</p>
        <ul role="presentation">
          {rows.map((r, i) => {
            const idx = base + i;
            const isActive = idx === active;
            return (
              <li key={r.key} id={`${listId}-opt-${idx}`} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => go(r.href)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition ${
                    isActive ? 'bg-belize-blue/10 text-belize-blue' : 'text-belize-navy hover:bg-slate-50'
                  }`}
                >
                  <span className="truncate">{r.label}</span>
                  {r.sub && <span className="shrink-0 text-xs text-slate-400">{r.sub}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </li>
    );
  }

  const catBase = results.products.length;
  const vendorBase = catBase + results.categories.length;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden>
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
            <path d="m14 14 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
        <input
          type="search"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
          aria-label="Search products, stores and categories"
          autoFocus={autoFocus}
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="bmpl-input w-full pl-9"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            <Spinner className="h-4 w-4" />
          </span>
        )}
      </div>

      {showDropdown && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search suggestions"
          className="absolute left-0 right-0 top-full z-40 mt-1.5 max-h-96 overflow-y-auto rounded-bmpl-lg border border-slate-200 bg-white py-1 shadow-bmpl-md"
        >
          {!hasResults && !loading ? (
            <li role="option" aria-selected={false} className="px-3 py-3 text-sm text-slate-500">
              No matches. Press Enter to search “{trimmed}”.
            </li>
          ) : (
            <>
              <Group
                heading="Products"
                base={0}
                rows={results.products.map((p) => ({ key: `p:${p.slug}`, label: p.title, href: `/products/${p.slug}` }))}
              />
              <Group
                heading="Categories"
                base={catBase}
                rows={results.categories.map((c) => ({
                  key: `c:${c.slug}`,
                  label: c.name,
                  href: `/products?q=${encodeURIComponent(c.name)}`,
                }))}
              />
              <Group
                heading="Stores"
                base={vendorBase}
                rows={results.vendors.map((v) => ({
                  key: `v:${v.slug}`,
                  label: v.businessName,
                  href: `/store/${v.slug}`,
                }))}
              />
            </>
          )}
        </ul>
      )}
    </div>
  );
}

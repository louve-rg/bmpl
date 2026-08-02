'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DISTRICTS,
  DISTRICT_LABELS,
  LISTING_PURPOSES,
  LISTING_PURPOSE_LABELS,
  PROPERTY_TYPES,
  PROPERTY_TYPE_LABELS,
  FURNISHINGS,
  FURNISHING_LABELS,
  PROPERTY_SORTS,
} from '@bmpl/shared';
import { Button, Input, Label, Select } from '../ui';
import { PROPERTY_SORT_LABELS } from '../../lib/realestate';

export interface PropertyFilterValues {
  q?: string;
  purpose?: string;
  propertyType?: string;
  district?: string;
  priceMin?: string;
  priceMax?: string;
  bedrooms?: string;
  bathrooms?: string;
  furnishing?: string;
  sort?: string;
}

/**
 * Property search + filters. Controlled client form that pushes the selected filters
 * to the URL (guests fully supported — results are rendered by the server page from
 * the query string).
 */
export function SearchFilters({ initial }: { initial: PropertyFilterValues }) {
  const router = useRouter();
  const [v, setV] = useState<PropertyFilterValues>(initial);

  function set<K extends keyof PropertyFilterValues>(k: K, val: string) {
    setV((prev) => ({ ...prev, [k]: val || undefined }));
  }

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const p = new URLSearchParams();
    for (const [k, val] of Object.entries(v)) {
      if (val) p.set(k, val);
    }
    p.set('page', '1');
    router.push(`/properties?${p.toString()}`);
  }

  function reset() {
    setV({});
    router.push('/properties');
  }

  return (
    <form onSubmit={apply} className="bmpl-card space-y-4 p-4 sm:p-5">
      <div>
        <Label htmlFor="re-q">Search properties</Label>
        <Input
          id="re-q"
          value={v.q ?? ''}
          onChange={(e) => set('q', e.target.value)}
          placeholder="Title, locality, agent or agency"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Label htmlFor="re-purpose">Purpose</Label>
          <Select id="re-purpose" value={v.purpose ?? ''} onChange={(e) => set('purpose', e.target.value)}>
            <option value="">Buy or rent</option>
            {LISTING_PURPOSES.map((p) => (
              <option key={p} value={p}>
                {LISTING_PURPOSE_LABELS[p]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="re-type">Property type</Label>
          <Select id="re-type" value={v.propertyType ?? ''} onChange={(e) => set('propertyType', e.target.value)}>
            <option value="">Any type</option>
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROPERTY_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="re-district">District</Label>
          <Select id="re-district" value={v.district ?? ''} onChange={(e) => set('district', e.target.value)}>
            <option value="">All districts</option>
            {DISTRICTS.map((d) => (
              <option key={d} value={d}>
                {DISTRICT_LABELS[d]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="re-price-min">Min. price (BZ$)</Label>
          <Input
            id="re-price-min"
            inputMode="decimal"
            value={v.priceMin ?? ''}
            onChange={(e) => set('priceMin', e.target.value)}
            placeholder="e.g. 50000"
          />
        </div>
        <div>
          <Label htmlFor="re-price-max">Max. price (BZ$)</Label>
          <Input
            id="re-price-max"
            inputMode="decimal"
            value={v.priceMax ?? ''}
            onChange={(e) => set('priceMax', e.target.value)}
            placeholder="e.g. 500000"
          />
        </div>
        <div>
          <Label htmlFor="re-beds">Min. bedrooms</Label>
          <Input
            id="re-beds"
            inputMode="numeric"
            value={v.bedrooms ?? ''}
            onChange={(e) => set('bedrooms', e.target.value)}
            placeholder="Any"
          />
        </div>
        <div>
          <Label htmlFor="re-baths">Min. bathrooms</Label>
          <Input
            id="re-baths"
            inputMode="numeric"
            value={v.bathrooms ?? ''}
            onChange={(e) => set('bathrooms', e.target.value)}
            placeholder="Any"
          />
        </div>
        <div>
          <Label htmlFor="re-furnishing">Furnishing</Label>
          <Select id="re-furnishing" value={v.furnishing ?? ''} onChange={(e) => set('furnishing', e.target.value)}>
            <option value="">Any</option>
            {FURNISHINGS.map((f) => (
              <option key={f} value={f}>
                {FURNISHING_LABELS[f]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="re-sort">Sort by</Label>
          <Select id="re-sort" value={v.sort ?? ''} onChange={(e) => set('sort', e.target.value)}>
            <option value="">Relevance</option>
            {PROPERTY_SORTS.map((s) => (
              <option key={s} value={s}>
                {PROPERTY_SORT_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit">Search properties</Button>
        <Button type="button" variant="ghost" onClick={reset}>
          Clear filters
        </Button>
      </div>
    </form>
  );
}

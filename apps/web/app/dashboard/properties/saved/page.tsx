'use client';

import { useEffect, useState } from 'react';
import { type ApiError } from '../../../../lib/api';
import { realEstateApi, type SavedProperty } from '../../../../lib/realestate';
import { PropertyCard } from '../../../../components/realestate/PropertyCard';
import { Alert, Badge, EmptyState, PageHeader, Spinner, ButtonLink } from '../../../../components/ui';

export default function SavedPropertiesPage() {
  const [items, setItems] = useState<SavedProperty[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    realEstateApi.seeker
      .saved()
      .then((r) => active && setItems(r.items))
      .catch((e) => active && setError((e as ApiError).message ?? 'Failed to load saved properties.'));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow="Real Estate"
        title="Saved properties"
        description="Listings you've bookmarked to review, enquire, or view later."
      />

      {error && <Alert tone="error">{error}</Alert>}

      {items === null && !error ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : items && items.length === 0 ? (
        <EmptyState
          title="No saved properties yet"
          description="Tap the heart on any listing to save it here."
          action={<ButtonLink href="/properties">Browse properties</ButtonLink>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items?.map((p) => (
            <div key={p.id} className="relative">
              {p.closed && (
                <div className="absolute right-3 top-14 z-10">
                  <Badge tone="neutral">No longer available</Badge>
                </div>
              )}
              <PropertyCard property={p} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

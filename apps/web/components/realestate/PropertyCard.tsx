import Link from 'next/link';
import { LISTING_PURPOSE_LABELS, PROPERTY_TYPE_LABELS } from '@bmpl/shared';
import { Badge, EmptyState } from '../ui';
import { SaveButton } from './SaveButton';
import {
  type PropertyCard as PropertyCardType,
  formatPrice,
  locationLabel,
  furnishingLabel,
} from '../../lib/realestate';

/** Purpose + type badge pair, shared by cards and detail. */
export function PropertyBadges({
  purpose,
  propertyType,
}: {
  purpose: PropertyCardType['purpose'];
  propertyType: PropertyCardType['propertyType'];
}) {
  return (
    <>
      <Badge tone={purpose === 'FOR_SALE' ? 'brand' : 'info'}>{LISTING_PURPOSE_LABELS[purpose]}</Badge>
      <Badge tone="neutral">{PROPERTY_TYPE_LABELS[propertyType]}</Badge>
    </>
  );
}

function Feature({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
        <path d={icon} />
      </svg>
      {children}
    </span>
  );
}

/** Reusable property card. Optionally shows a Save heart in the corner. */
export function PropertyCard({ property, showSave = true }: { property: PropertyCardType; showSave?: boolean }) {
  const price = formatPrice(property.priceMinor, {
    purpose: property.purpose,
    rentalPeriod: property.rentalPeriod,
  });
  const area = property.propertySize ?? property.landSize;
  return (
    <div className="group relative overflow-hidden rounded-bmpl-lg border border-slate-200 bg-white shadow-bmpl-sm transition hover:-translate-y-0.5 hover:border-belize-light/60 hover:shadow-bmpl-md">
      <Link href={`/properties/${property.slug}`} className="block">
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100">
          {property.primaryImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={property.primaryImageUrl}
              alt={property.title}
              className="h-full w-full object-cover transition group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-300">
              <svg viewBox="0 0 24 24" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
                <path d="M3 10.5 12 4l9 6.5M5 9.5V20h14V9.5M9 20v-6h6v6" />
              </svg>
            </div>
          )}
          <div className="absolute left-3 top-3">
            <Badge tone={property.purpose === 'FOR_SALE' ? 'brand' : 'info'}>
              {LISTING_PURPOSE_LABELS[property.purpose]}
            </Badge>
          </div>
        </div>
      </Link>
      {showSave && (
        <div className="absolute right-3 top-3">
          <SaveButton listingId={property.id} slug={property.slug} size="sm" />
        </div>
      )}
      <div className="p-4">
        <Link href={`/properties/${property.slug}`} className="block">
          <p className="text-lg font-bold text-belize-navy">{price}</p>
          <h3 className="mt-0.5 line-clamp-1 font-semibold text-belize-navy group-hover:text-belize-blue">
            {property.title}
          </h3>
        </Link>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <Feature icon="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11Z M12 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z">
            {locationLabel(property.location)}
          </Feature>
          <span>{PROPERTY_TYPE_LABELS[property.propertyType]}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
          {property.bedrooms != null && <Feature icon="M3 12V6h18v6M3 12v6M21 12v6M3 16h18M6 9h5M13 9h5">{property.bedrooms} bd</Feature>}
          {property.bathrooms != null && <Feature icon="M4 12h16v3a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-3ZM6 12V6a2 2 0 0 1 4 0">{property.bathrooms} ba</Feature>}
          {area != null && (
            <Feature icon="M4 4h16v16H4V4Zm0 6h16M10 4v16">
              {area.toLocaleString()} {property.areaUnit ? `${property.areaUnit.replace('SQ_', '').toLowerCase()}` : ''}
            </Feature>
          )}
          {property.furnishing && property.furnishing !== 'NOT_APPLICABLE' && (
            <span>{furnishingLabel(property.furnishing)}</span>
          )}
        </div>
        {(property.agency || property.agent) && (
          <p className="mt-3 truncate border-t border-slate-100 pt-2 text-xs text-slate-400">
            {property.agency?.name ?? property.agent?.displayName}
          </p>
        )}
      </div>
    </div>
  );
}

/** Grid of property cards with a built-in empty state. */
export function PropertyGrid({
  properties,
  showSave = true,
  emptyTitle = 'No properties found',
  emptyDescription,
}: {
  properties: PropertyCardType[];
  showSave?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (properties.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {properties.map((p) => (
        <PropertyCard key={p.id} property={p} showSave={showSave} />
      ))}
    </div>
  );
}

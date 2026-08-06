'use client';

import { useState } from 'react';
import { avatarFallbackColor, userInitials } from '@bmpl/shared';

const SIZES = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-16 w-16 text-lg',
  xl: 'h-24 w-24 text-2xl',
} as const;

export type AvatarSize = keyof typeof SIZES;

/**
 * A person's profile picture, with a coloured-initials fallback.
 *
 * The fallback is not a placeholder to be replaced later — it is the permanent
 * answer for every user who has no approved picture, which is most of them. It
 * renders from `name` alone, so a row of users always looks deliberate instead of
 * a mix of photos and grey silhouettes.
 *
 * `src` accepts either form the API returns: an API-relative path
 * (`/users/:id/avatar`), which is routed through the same-origin `/api` proxy, or
 * an absolute signed storage URL (used for a picture still awaiting review). That
 * public route 404s for anything not approved, so a stale or revoked picture
 * simply fails to load and this falls back — no extra state to keep in sync.
 */
export function Avatar({
  name,
  src,
  initials,
  size = 'md',
  className = '',
}: {
  /** Full or display name — used for the initials and the accessible label. */
  name: string;
  src?: string | null;
  /** Server-computed initials; falls back to deriving them from `name`. */
  initials?: string | null;
  size?: AvatarSize;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const label = initials || initialsFromName(name);
  const shared = `${SIZES[size]} shrink-0 rounded-full object-cover ${className}`;
  const resolved = src ? avatarSrc(src) : null;

  if (resolved && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={resolved}
        alt={name}
        loading="lazy"
        onError={() => setFailed(true)}
        className={`${shared} bg-slate-100 ring-1 ring-slate-200`}
      />
    );
  }

  return (
    <span
      // The name is already rendered next to this in every current usage, so the
      // initials are decorative — announcing "MC" again would just be noise.
      aria-hidden
      className={`${shared} inline-flex items-center justify-center font-semibold uppercase leading-none text-white`}
      style={{ backgroundColor: avatarFallbackColor(name || label) }}
    >
      {label}
    </span>
  );
}

/** Split a rendered name ("Maya C.", "Maya Chen") back into two parts. */
function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return userInitials(parts[0], parts.length > 1 ? parts[parts.length - 1] : '');
}

/**
 * Route an API-relative avatar path through the same-origin `/api` proxy.
 *
 * The API returns `/users/:id/avatar` rather than an absolute URL so the image
 * request stays same-origin — no CORS, no Cross-Origin-Resource-Policy, and no
 * dependency on the API's own idea of its public hostname. Absolute URLs (signed
 * storage links for a picture still under review) pass through untouched.
 */
export function avatarSrc(src: string): string {
  if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:')) return src;
  return src.startsWith('/api/') ? src : `/api${src.startsWith('/') ? '' : '/'}${src}`;
}

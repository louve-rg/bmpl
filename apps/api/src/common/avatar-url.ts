import type { AvatarStatus } from '@bmpl/shared';

/**
 * Build the reference to a user's profile picture.
 *
 * Deliberately API-RELATIVE (`/users/:id/avatar`), not absolute. The web and
 * admin apps already proxy `/api/*` to this API, so a relative path becomes a
 * SAME-ORIGIN image request in the browser — no CORS preflight, no
 * Cross-Origin-Resource-Policy interaction with helmet, and no dependency on
 * API_URL being set correctly in the deployment. Mobile prefixes its own API
 * base. An absolute URL built from API_URL would silently render every avatar as
 * `http://localhost:4000/...` the moment that variable is unset.
 *
 * Every service that serializes a user alongside their picture — messaging,
 * reviews, agent and driver profiles — goes through here rather than importing
 * UsersService, which would drag the whole user module (and its Prisma/storage
 * dependencies) into modules that only need to print a path.
 *
 * Returns null for anything other than an APPROVED picture, so a pending or
 * rejected image can never leak into a public payload by accident: the caller
 * gets null and the UI falls back to initials.
 */
export function publicAvatarUrl(user: {
  id: string;
  avatarStatus: AvatarStatus;
  avatarModerated: boolean;
}): string | null {
  // BOTH conditions matter, and for different reasons. `APPROVED` means the
  // picture is live rather than pending or rejected. `avatarModerated` means it
  // is an identity claim that passed review — a customer's cosmetic avatar is
  // approved but never public, because it is shown only inside their own account.
  return user.avatarStatus === 'APPROVED' && user.avatarModerated
    ? `/users/${user.id}/avatar`
    : null;
}

/** Prisma `select` for the fields {@link publicAvatarUrl} needs. */
export const AVATAR_SELECT = { id: true, avatarStatus: true, avatarModerated: true } as const;

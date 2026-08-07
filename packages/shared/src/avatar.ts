/**
 * Profile pictures: moderation states, the policy every upload is judged
 * against, and the initials fallback shown whenever there is no approved photo.
 *
 * NOTE: the API compiles this package into its deployed bundle, so editing this
 * file changes production API behaviour. `packages/**` is one of the Railway
 * watch patterns in `railway.json` — see docs/DEPLOYMENT.md §2a.
 */

/** Moderation state of a user's profile picture. Mirrors Prisma `AvatarStatus`. */
export const AVATAR_STATUSES = ['NONE', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type AvatarStatus = (typeof AVATAR_STATUSES)[number];

/**
 * Roles whose profile picture is a VERIFIED IDENTITY CLAIM, not decoration.
 *
 * These people show up at a customer's door, drive them somewhere, or meet them
 * at a viewing. The customer uses the photo to check that the person in front of
 * them is who was dispatched, so it goes through review before anyone sees it.
 *
 * Everyone else — plain customers above all — gets an instant, unmoderated
 * picture. A customer avatar is cosmetic: it never asserts identity, so putting
 * it behind a review queue buys no safety and costs every new user a wait.
 *
 * NOTE ON VENDOR: deliberately NOT in this list. A vendor is met at a counter
 * under their business name and brand, and the storefront logo (already
 * moderated) is what a customer matches against — not the owner's face.
 */
export const AVATAR_MODERATED_ROLES = [
  'DELIVERY_DRIVER',
  'PASSENGER_DRIVER',
  'SHIPPING_PROVIDER',
  'PASSENGER_PROVIDER',
  'REAL_ESTATE_AGENT',
  'EMPLOYER',
] as const;
export type AvatarModeratedRole = (typeof AVATAR_MODERATED_ROLES)[number];

export const roleModeratesAvatar = (code: string): code is AvatarModeratedRole =>
  (AVATAR_MODERATED_ROLES as readonly string[]).includes(code);

/**
 * Whether this user's picture is an identity claim that must be reviewed before
 * it is shown. Driven by the roles they ACTUALLY hold (approved ones only) — a
 * customer who is also an approved driver is held to the driver standard.
 */
export const avatarNeedsApproval = (approvedRoleCodes: readonly string[]): boolean =>
  approvedRoleCodes.some(roleModeratesAvatar);

/**
 * Roles that must HAVE an approved picture, not merely have theirs reviewed.
 * Identical to the moderated set today: if a photo is worth verifying because a
 * customer meets that person, it is worth requiring.
 */
export const AVATAR_REQUIRED_ROLES = AVATAR_MODERATED_ROLES;
export type AvatarRequiredRole = AvatarModeratedRole;

export const roleRequiresAvatar = (code: string): code is AvatarRequiredRole =>
  roleModeratesAvatar(code);

/**
 * The face-check policy. A picture is auto-approved only when EVERY rule holds;
 * a rule that fails hard is rejected outright, and anything merely uncertain is
 * sent to the admin queue (see AvatarVisionService in the API).
 */
export const AVATAR_POLICY = {
  /** Minimum detection confidence (0–100) to treat a region as a human face. */
  minFaceConfidence: 90,
  /**
   * Below this the provider "sort of" saw a face. Not confident enough to publish
   * and not clearly wrong either, so it goes to a human instead of being rejected.
   */
  reviewFaceConfidence: 60,
  /**
   * The face must fill at least this fraction of the image. A person standing in
   * a landscape shot is technically a face but makes a useless 40px avatar.
   */
  minFaceCoverage: 0.05,
  /** More than one face means it is not a portrait of the account holder. */
  maxFaces: 1,
  /** Moderation-label confidence (0–100) at which unsafe content is rejected. */
  maxUnsafeConfidence: 70,
} as const;

/** Why an avatar was rejected. Stored on the user so the UI can explain it. */
export const AVATAR_REJECTION_REASONS = {
  NO_FACE: 'NO_FACE',
  MULTIPLE_FACES: 'MULTIPLE_FACES',
  FACE_TOO_SMALL: 'FACE_TOO_SMALL',
  UNSAFE_CONTENT: 'UNSAFE_CONTENT',
  ADMIN_REJECTED: 'ADMIN_REJECTED',
} as const;
export type AvatarRejectionReason =
  (typeof AVATAR_REJECTION_REASONS)[keyof typeof AVATAR_REJECTION_REASONS];

/** Tuple form, for building a Zod enum over the reason codes. */
export const AVATAR_REJECTION_REASON_CODES = [
  'NO_FACE',
  'MULTIPLE_FACES',
  'FACE_TOO_SMALL',
  'UNSAFE_CONTENT',
  'ADMIN_REJECTED',
] as const satisfies readonly AvatarRejectionReason[];

/**
 * User-facing explanation for a rejection. Written to tell someone what to do
 * next, not to describe the classifier — "no face detected" helps nobody.
 */
export const AVATAR_REJECTION_MESSAGES: Record<AvatarRejectionReason, string> = {
  NO_FACE:
    'We couldn’t find a face in that image. Your profile picture must be a clear photo of you — not a logo, product, pet, or landscape.',
  MULTIPLE_FACES:
    'That photo has more than one person in it. Please upload a picture of just yourself.',
  FACE_TOO_SMALL:
    'You’re too far away in that photo. Please upload a closer head-and-shoulders shot so your face is clearly visible.',
  UNSAFE_CONTENT:
    'That image doesn’t meet our community guidelines. Please upload an ordinary photo of your face.',
  ADMIN_REJECTED:
    'Our team reviewed your photo and it isn’t suitable as a profile picture. Please upload a clear photo of your face.',
};

export const avatarRejectionMessage = (reason: string | null | undefined): string =>
  (reason && AVATAR_REJECTION_MESSAGES[reason as AvatarRejectionReason]) ??
  AVATAR_REJECTION_MESSAGES.ADMIN_REJECTED;

/**
 * Initials fallback (e.g. "Maya Chen" → "MC"). Used everywhere a user is shown
 * without an approved photo, so an account is never a faceless grey blob.
 */
export function userInitials(firstName?: string | null, lastName?: string | null): string {
  const first = (firstName ?? '').trim();
  const last = (lastName ?? '').trim();
  // Two names → one letter from each. Only one name → its first two letters, so a
  // single-name account still gets a two-character mark like everyone else.
  if (first && last) return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
  return ((first || last).slice(0, 2) || '?').toUpperCase();
}

/**
 * How a user is named to STRANGERS — public reviews, agent cards, a driver at the
 * door. Surname is reduced to an initial ("Maya C."): enough for a real person to
 * be accountable for what they wrote or did, without publishing a full legal name
 * next to a face. Places where the two parties already know each other (an order
 * conversation, the admin console) keep using the full name.
 */
export function publicDisplayName(firstName?: string | null, lastName?: string | null): string {
  const first = (firstName ?? '').trim();
  const initial = (lastName ?? '').trim().charAt(0);
  if (!first) return initial ? `${initial}.` : 'Someone';
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}

/**
 * Deterministic background for an initials avatar, drawn from the brand palette
 * so the same user is always the same colour on every screen and every device.
 */
export const AVATAR_FALLBACK_COLORS = [
  '#1e40af',
  '#0ea5e9',
  '#0f766e',
  '#7c3aed',
  '#b45309',
  '#be123c',
] as const;

export function avatarFallbackColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_FALLBACK_COLORS[hash % AVATAR_FALLBACK_COLORS.length]!;
}

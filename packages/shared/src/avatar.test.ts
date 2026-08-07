import { describe, expect, it } from 'vitest';
import {
  AVATAR_FALLBACK_COLORS,
  AVATAR_REJECTION_MESSAGES,
  AVATAR_REJECTION_REASON_CODES,
  avatarFallbackColor,
  avatarNeedsApproval,
  avatarRejectionMessage,
  publicDisplayName,
  roleRequiresAvatar,
  userInitials,
} from './avatar';

describe('userInitials', () => {
  it('takes the first letter of each name', () => {
    expect(userInitials('Maya', 'Chen')).toBe('MC');
    expect(userInitials('joão', 'silva')).toBe('JS');
  });

  it('falls back to the first two letters when only one name is known', () => {
    expect(userInitials('Maya', '')).toBe('MA');
    expect(userInitials('', 'Chen')).toBe('CH');
    expect(userInitials(null, undefined)).toBe('?');
  });
});

describe('publicDisplayName', () => {
  it('reduces the surname to an initial', () => {
    expect(publicDisplayName('Maya', 'Chen')).toBe('Maya C.');
  });

  it('degrades gracefully when a name is missing', () => {
    expect(publicDisplayName('Maya', '')).toBe('Maya');
    expect(publicDisplayName('', 'Chen')).toBe('C.');
    expect(publicDisplayName(null, null)).toBe('Someone');
  });
});

describe('avatarFallbackColor', () => {
  it('is stable for the same seed', () => {
    expect(avatarFallbackColor('Maya Chen')).toBe(avatarFallbackColor('Maya Chen'));
  });

  it('only ever returns a palette colour', () => {
    for (const seed of ['a', 'Maya Chen', '', 'ẞ', 'x'.repeat(500)]) {
      expect(AVATAR_FALLBACK_COLORS).toContain(avatarFallbackColor(seed));
    }
  });
});

describe('roleRequiresAvatar', () => {
  it('covers the roles a customer meets in person', () => {
    expect(roleRequiresAvatar('DELIVERY_DRIVER')).toBe(true);
    expect(roleRequiresAvatar('PASSENGER_DRIVER')).toBe(true);
    expect(roleRequiresAvatar('REAL_ESTATE_AGENT')).toBe(true);
    expect(roleRequiresAvatar('EMPLOYER')).toBe(true);
  });

  it('leaves everyone else optional', () => {
    expect(roleRequiresAvatar('CUSTOMER')).toBe(false);
    expect(roleRequiresAvatar('JOB_SEEKER')).toBe(false);
    expect(roleRequiresAvatar('NOT_A_ROLE')).toBe(false);
  });

  it('excludes VENDOR — a storefront is matched by its brand, not the owner’s face', () => {
    // Deliberate, and the reason it is asserted: a customer at a vendor counter
    // identifies the business by its (already moderated) logo and name. Requiring
    // the owner's face adds a verification step that protects nobody.
    expect(roleRequiresAvatar('VENDOR')).toBe(false);
  });
});

describe('avatarNeedsApproval', () => {
  it('moderates a user who holds ANY provider role', () => {
    expect(avatarNeedsApproval(['CUSTOMER', 'DELIVERY_DRIVER'])).toBe(true);
  });

  it('publishes instantly for a plain customer', () => {
    expect(avatarNeedsApproval(['CUSTOMER'])).toBe(false);
    expect(avatarNeedsApproval([])).toBe(false);
  });

  it('holds a customer-who-is-also-a-driver to the driver standard', () => {
    // The stricter rule has to win, or a provider could dodge review simply by
    // also being a shopper — which every provider is.
    expect(avatarNeedsApproval(['CUSTOMER', 'JOB_SEEKER', 'REAL_ESTATE_AGENT'])).toBe(true);
  });
});

describe('avatarRejectionMessage', () => {
  it('has a message for every reason code', () => {
    for (const code of AVATAR_REJECTION_REASON_CODES) {
      expect(AVATAR_REJECTION_MESSAGES[code]).toBeTruthy();
      expect(avatarRejectionMessage(code)).toBe(AVATAR_REJECTION_MESSAGES[code]);
    }
  });

  it('falls back to the generic message for unknown or missing reasons', () => {
    expect(avatarRejectionMessage(null)).toBe(AVATAR_REJECTION_MESSAGES.ADMIN_REJECTED);
    expect(avatarRejectionMessage('SOMETHING_ELSE')).toBe(AVATAR_REJECTION_MESSAGES.ADMIN_REJECTED);
  });
});

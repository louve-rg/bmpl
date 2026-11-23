import { describe, expect, it } from 'vitest';
import { PUBLIC_CONTACT_EMAIL, contactMailto } from './contact';

describe('contactMailto', () => {
  it('builds a bare mailto with no subject', () => {
    expect(contactMailto()).toBe(`mailto:${PUBLIC_CONTACT_EMAIL}`);
  });

  it('encodes a subject the same way the hand-written hrefs it replaces did', () => {
    expect(contactMailto('Delivery help')).toBe(`mailto:${PUBLIC_CONTACT_EMAIL}?subject=Delivery%20help`);
    expect(contactMailto('Collection code locked')).toBe(`mailto:${PUBLIC_CONTACT_EMAIL}?subject=Collection%20code%20locked`);
  });
});

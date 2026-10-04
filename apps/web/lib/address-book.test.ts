import { describe, expect, it } from 'vitest';
import type { SavedAddress } from './address';
import {
  EMPTY_ADDRESS_BOOK_FORM,
  addressBookProblem,
  buildAddressBookPayload,
  formFromRow,
} from './address-book';

const row: SavedAddress = {
  id: 'a1',
  label: 'Home',
  fullName: 'Rae Test',
  phone: '+501 600 0000',
  email: null,
  company: null,
  addressLine1: '12 Front St',
  addressLine2: null,
  city: 'Belize City',
  district: 'BELIZE',
  instructions: null,
  latitude: 17.5,
  longitude: -88.2,
  isDefault: true,
};

describe('address book form', () => {
  it('pre-fills from a saved row, mapping null optionals to empty text', () => {
    const form = formFromRow(row);
    expect(form.label).toBe('Home');
    expect(form.email).toBe('');
    expect(form.company).toBe('');
    expect(form.addressLine2).toBe('');
    expect(form.instructions).toBe('');
  });

  it('keeps the saved pin on an edit, because the form has no pin field', () => {
    const payload = buildAddressBookPayload({ ...formFromRow(row), city: 'Orange Walk' }, row);
    expect(payload.latitude).toBe(17.5);
    expect(payload.longitude).toBe(-88.2);
    expect(payload.city).toBe('Orange Walk');
  });

  it('sends no pin on a new address, and blank optionals as null', () => {
    const payload = buildAddressBookPayload({ ...EMPTY_ADDRESS_BOOK_FORM, label: ' Work ', fullName: 'Rae', phone: '+501 600 0000', addressLine1: '1 Bay Rd', city: 'Belmopan', district: 'CAYO' });
    expect(payload.latitude).toBeNull();
    expect(payload.longitude).toBeNull();
    expect(payload.label).toBe('Work');
    expect(payload.email).toBeNull();
    expect(payload.company).toBeNull();
    expect(payload.instructions).toBeNull();
  });
});

describe('addressBookProblem (the shared schema, in words)', () => {
  const valid = buildAddressBookPayload({
    ...EMPTY_ADDRESS_BOOK_FORM,
    label: 'Home',
    fullName: 'Rae Test',
    phone: '+501 600 0000',
    addressLine1: '12 Front St',
    city: 'Belize City',
    district: 'BELIZE',
  });

  it('accepts a complete address', () => {
    expect(addressBookProblem(valid)).toBeNull();
  });

  it('refuses a missing town, with a message the customer can act on', () => {
    // Guard: the valid payload passes, so the refusal below is the city rule alone.
    expect(addressBookProblem(valid)).toBeNull();
    expect(addressBookProblem({ ...valid, city: '' })).toBe('Add the city, town or village.');
  });

  it('refuses a blank name for the address', () => {
    expect(addressBookProblem({ ...valid, label: '' })).toBe('Give this address a name, such as Home or Work.');
  });
});

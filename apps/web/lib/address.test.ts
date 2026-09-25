import { describe, expect, it } from 'vitest';
import { UNLOCATABLE_ADDRESS_MESSAGE } from '@bmpl/shared';
import { addressGap, emptyAddress, switchMethod, toSavedAddressPayload, type AddressValue } from './address';

/**
 * The reported defect, as a test.
 *
 * Marketplace checkout let a customer use their current location, dropped the
 * pin correctly — and then refused to submit because Address Line 1 was blank.
 * The pin IS the address. These tests pin down that a pinned address is a
 * complete one, and that everything the form still genuinely needs is still
 * asked for.
 */
const pinned = (over: Partial<AddressValue> = {}): AddressValue => ({
  ...emptyAddress('PIN'),
  fullName: 'Edward Flowers',
  phone: '501-600-1234',
  city: 'Belize City',
  district: 'BELIZE',
  latitude: 17.4995,
  longitude: -88.1976,
  ...over,
});

const typed = (over: Partial<AddressValue> = {}): AddressValue => ({
  ...emptyAddress('TYPED'),
  fullName: 'Edward Flowers',
  phone: '501-600-1234',
  addressLine1: '12 Queen Street',
  city: 'Belize City',
  district: 'BELIZE',
  ...over,
});

describe('addressGap — a pinned address is a complete address', () => {
  it('lets a dropped pin through with no street address', () => {
    expect(addressGap(pinned(), { contact: 'ESSENTIAL' })).toBeNull();
  });

  it('lets a typed address through with no pin', () => {
    expect(addressGap(typed(), { contact: 'ESSENTIAL' })).toBeNull();
  });

  it('names the pin when the customer chose to drop one and has not', () => {
    const gap = addressGap(pinned({ latitude: null, longitude: null }), { contact: 'ESSENTIAL' });
    // Never "Address required" at someone whose chosen method is the map.
    expect(gap).toBe('Place your pin on the map so your driver knows where to go.');
  });

  it('offers both ways out when the customer is typing and has given neither', () => {
    expect(addressGap(typed({ addressLine1: '' }), { contact: 'ESSENTIAL' })).toBe(UNLOCATABLE_ADDRESS_MESSAGE);
  });

  it('still asks for the town and the district, pin or no pin', () => {
    expect(addressGap(pinned({ city: '' }), { contact: 'ESSENTIAL' })).toBe('Add the city, town or village.');
    expect(addressGap(pinned({ district: '' }), { contact: 'ESSENTIAL' })).toBe('Choose the district.');
  });

  it('still asks who is receiving it', () => {
    expect(addressGap(pinned({ fullName: '' }), { contact: 'ESSENTIAL' })).toContain('name');
    expect(addressGap(pinned({ phone: '' }), { contact: 'ESSENTIAL' })).toContain('phone');
  });

  it('asks for no contact details at all when the form has already collected them', () => {
    expect(addressGap(pinned({ fullName: '', phone: '' }), { contact: 'NONE' })).toBeNull();
  });

  it('half a pin is not a pin', () => {
    // Matches the server, which refuses a lone latitude outright.
    expect(addressGap(pinned({ longitude: null }), { contact: 'ESSENTIAL' })).not.toBeNull();
  });
});

describe('switchMethod — changing your mind leaves no stale answer behind', () => {
  it('drops a typed street when switching to the map', () => {
    // Otherwise the customer submits a street they can no longer see, and an
    // address nobody checked reaches a driver.
    const after = switchMethod(typed({ addressLine2: 'Apt 2' }), 'PIN');
    expect(after.addressLine1).toBe('');
    expect(after.addressLine2).toBe('');
  });

  it('keeps a pin through every switch', () => {
    // The pin is equally true in all three modes. Making someone re-drop one
    // they already placed is pure loss.
    const after = switchMethod(pinned(), 'TYPED');
    expect([after.latitude, after.longitude]).toEqual([17.4995, -88.1976]);
  });

  it('stops claiming a saved address once you have switched away from it', () => {
    const saved = { ...typed(), method: 'SAVED' as const, savedAddressId: 'addr_1' };
    expect(switchMethod(saved, 'PIN').savedAddressId).toBeNull();
    expect(switchMethod(saved, 'TYPED').savedAddressId).toBeNull();
  });

  it('is a no-op when the method has not actually changed', () => {
    const v = typed();
    expect(switchMethod(v, 'TYPED')).toBe(v);
  });

  it('leaves no stale validation state behind: pin → type asks for the street, not the pin', () => {
    const afterSwitch = switchMethod(pinned({ latitude: null, longitude: null }), 'TYPED');
    expect(addressGap(afterSwitch, { contact: 'ESSENTIAL' })).toBe(UNLOCATABLE_ADDRESS_MESSAGE);
  });
});

describe('toSavedAddressPayload — what the star affordance sends the address book', () => {
  it('trims text fields and the given label', () => {
    const payload = toSavedAddressPayload(typed({ addressLine2: '  Apt 2  ', instructions: '  Blue gate  ' }), '  Home  ');
    expect(payload.label).toBe('Home');
    expect(payload.addressLine2).toBe('Apt 2');
    expect(payload.instructions).toBe('Blue gate');
  });

  it('turns a blank optional field into null rather than an empty string', () => {
    const payload = toSavedAddressPayload(typed({ email: '', company: '', addressLine2: '', instructions: '' }), 'Home');
    expect(payload.email).toBeNull();
    expect(payload.company).toBeNull();
    expect(payload.addressLine2).toBeNull();
    expect(payload.instructions).toBeNull();
  });

  it('carries the pin through untouched', () => {
    const payload = toSavedAddressPayload(pinned(), 'Home');
    expect(payload.latitude).toBe(17.4995);
    expect(payload.longitude).toBe(-88.1976);
  });
});

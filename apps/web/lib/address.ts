import { UNLOCATABLE_ADDRESS_MESSAGE } from '@bmpl/shared';
import { isLocatable } from '@bmpl/validation';

/**
 * The address a customer gives us, and the rules about when it is complete.
 *
 * Framework-free and separate from the form that renders it, for two reasons.
 * The rules are the interesting part and they should be testable without a
 * browser; and marketplace checkout and shipment booking both apply them, so
 * they must not live inside either one's component.
 */

/** How the customer chose to tell us where the place is. */
export type AddressMethod = 'PIN' | 'TYPED' | 'SAVED';

/**
 * How much of the contact block a form needs.
 *
 * FULL is a shipment: a sender and a recipient are people we may have to ring
 * about a parcel, and a company name is often how a driver finds the door.
 * ESSENTIAL is a marketplace order, which stores a name and a phone and nothing
 * else — showing an email box that is silently discarded on submit is worse
 * than not showing one. NONE is for a form that has already asked.
 */
export type ContactLevel = 'FULL' | 'ESSENTIAL' | 'NONE';

export interface AddressValue {
  method: AddressMethod;
  /** Set when the customer picked one of their saved addresses. */
  savedAddressId: string | null;
  fullName: string;
  phone: string;
  email: string;
  company: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  district: string;
  instructions: string;
  latitude: number | null;
  longitude: number | null;
}

export interface SavedAddress {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  email: string | null;
  company: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  district: string;
  instructions: string | null;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
}

export const emptyAddress = (method: AddressMethod = 'TYPED'): AddressValue => ({
  method,
  savedAddressId: null,
  fullName: '',
  phone: '',
  email: '',
  company: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  district: '',
  instructions: '',
  latitude: null,
  longitude: null,
});

/**
 * What is still missing before this address can be submitted — in the
 * customer's words, naming the thing they actually have to do.
 *
 * Exists because checkout used to say "Please complete the delivery address."
 * at a customer who had dropped a pin on their own doorstep. That message was
 * both wrong and unactionable: nothing was incomplete, and it never said what
 * to fix. A form that refuses has to be able to finish the sentence.
 *
 * The rule mirrors `isLocatable` on the server exactly — written OR pinned,
 * town and district always — because a client check that is stricter or laxer
 * than the server's is worse than none: it either blocks valid submissions or
 * promises ones the API is about to reject.
 */
export function addressGap(v: AddressValue, opts: { contact?: ContactLevel } = {}): string | null {
  const contact = opts.contact ?? 'FULL';
  if (contact !== 'NONE' && !v.fullName.trim()) return 'Add the name of whoever is receiving this.';
  if (contact !== 'NONE' && !v.phone.trim()) return 'Add a phone number for whoever is receiving this.';
  if (!v.district) return 'Choose the district.';
  if (!v.city.trim()) return 'Add the city, town or village.';
  if (!isLocatable({ street: v.addressLine1, latitude: v.latitude, longitude: v.longitude })) {
    return v.method === 'PIN'
      ? 'Place your pin on the map so your driver knows where to go.'
      : UNLOCATABLE_ADDRESS_MESSAGE;
  }
  return null;
}

/**
 * Switching how you give the address must not leave the last method's answer
 * behind as a hidden requirement or a stale claim.
 *
 * Two things go wrong without this. A customer who types a street, switches to
 * "drop a pin" and never places one would submit the typed street they can no
 * longer see — an address the form is not showing them is an address nobody
 * checked. And a saved address that has been switched away from must stop
 * claiming to be selected, or moving the pin would look like it was editing the
 * address book entry.
 *
 * The PIN survives every switch, deliberately. It is the one field that is
 * equally true in all three modes, and re-dropping a pin you already placed is
 * pure loss.
 */
export function switchMethod(v: AddressValue, method: AddressMethod): AddressValue {
  if (method === v.method) return v;
  const base = { ...v, method, savedAddressId: null };
  if (method !== 'PIN') return base;
  // Leaving typed fields populated but off-screen is how an unchecked street
  // address reaches a driver.
  return { ...base, addressLine1: '', addressLine2: '' };
}

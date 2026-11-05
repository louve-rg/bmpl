import { savedAddressSchema } from '@bmpl/validation';
import { emptyAddress, toSavedAddressPayload, type SavedAddress, type SavedAddressPayload } from './address';

/**
 * The customer's own address book page (Favorites > Addresses, P-address).
 *
 * This is a manage screen over the EXISTING /addresses API, which already has
 * list, create, update and delete. It is not a second address store, and it does
 * not invent a second mapping or a second set of rules:
 * - the save payload is built by `toSavedAddressPayload`, the same mapping the
 *   checkout uses, so the two cannot drift;
 * - the rules are the shared `savedAddressSchema` from packages/validation,
 *   the same schema the API parses with.
 *
 * Editing or deleting a saved address changes only the saved row. Orders and
 * shipments keep their own copies of the address they were placed with; no
 * order or shipment row references a saved address.
 */

/** The editable fields, including the pin (MDF-485 M1/M2 -- see LocationPicker on the page itself). */
export interface AddressBookForm {
  label: string;
  fullName: string;
  phone: string;
  email: string;
  company: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  district: string;
  /** MDF-539: a named place, distinct from the street and from instructions -- see lib/address.ts. */
  landmark: string;
  instructions: string;
  latitude: number | null;
  longitude: number | null;
}

export const EMPTY_ADDRESS_BOOK_FORM: AddressBookForm = {
  label: '',
  fullName: '',
  phone: '',
  email: '',
  company: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  district: 'BELIZE',
  landmark: '',
  instructions: '',
  latitude: null,
  longitude: null,
};

/** Pre-fill the form from a saved row. */
export function formFromRow(row: SavedAddress): AddressBookForm {
  return {
    label: row.label,
    fullName: row.fullName,
    phone: row.phone,
    email: row.email ?? '',
    company: row.company ?? '',
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2 ?? '',
    city: row.city,
    district: row.district,
    landmark: row.landmark ?? '',
    instructions: row.instructions ?? '',
    latitude: row.latitude,
    longitude: row.longitude,
  };
}

/**
 * Build the payload for create (no row) or update (the row being edited).
 *
 * The pin is the form's own field now, same as every other field here -- a
 * save sends whatever the form currently holds, whether that is the pin the
 * row was loaded with, one dragged to a new spot, or none yet on a brand-new
 * address.
 */
export function buildAddressBookPayload(form: AddressBookForm): SavedAddressPayload {
  return toSavedAddressPayload(
    {
      ...emptyAddress('SAVED'),
      fullName: form.fullName,
      phone: form.phone,
      email: form.email,
      company: form.company,
      addressLine1: form.addressLine1,
      addressLine2: form.addressLine2,
      city: form.city,
      district: form.district,
      landmark: form.landmark,
      instructions: form.instructions,
      latitude: form.latitude,
      longitude: form.longitude,
    },
    form.label,
  );
}

/**
 * The first rule the shared schema breaks, in words the customer can act on, or
 * null when the form is valid. Uses the same schema the API parses with.
 */
export function addressBookProblem(payload: SavedAddressPayload): string | null {
  const result = savedAddressSchema.safeParse(payload);
  if (result.success) return null;
  const issue = result.error.issues[0];
  if (!issue) return 'Check the address and try again.';
  const field = String(issue.path[0] ?? '');
  const names: Record<string, string> = {
    label: 'Give this address a name, such as Home or Work.',
    fullName: 'Add the name of whoever receives parcels here.',
    phone: 'Add a phone number, at least 5 digits.',
    email: 'Check the email address.',
    addressLine1: 'Add the street or landmark.',
    city: 'Add the city, town or village.',
    district: 'Choose the district.',
  };
  return names[field] ?? 'Check this address and try again.';
}

/**
 * Which field the same rule above blocked on, naming it rather than
 * describing it -- so the page can move focus there. MDF-559 (Jim,
 * reproduced live): with a blank Full Name, the only feedback was the
 * sentence above sitting in the form, indistinguishable from nothing
 * happening once the customer had scrolled past that field. Kept separate
 * from `addressBookProblem` so every existing caller that only needs the
 * sentence is untouched.
 */
export function addressBookProblemField(payload: SavedAddressPayload): string | null {
  const result = savedAddressSchema.safeParse(payload);
  if (result.success) return null;
  const issue = result.error.issues[0];
  return issue ? String(issue.path[0] ?? '') : null;
}

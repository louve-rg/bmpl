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

/** The editable fields. The map pin is not edited here (see `pinNote`). */
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
  instructions: string;
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
  instructions: '',
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
    instructions: row.instructions ?? '',
  };
}

/**
 * Build the payload for create (no row) or update (the row being edited).
 *
 * The pin on an existing row is carried through untouched. The form has no pin
 * field, so a save must never drop or move it: that would silently change where
 * the driver goes.
 */
export function buildAddressBookPayload(form: AddressBookForm, row?: SavedAddress): SavedAddressPayload {
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
      instructions: form.instructions,
      latitude: row?.latitude ?? null,
      longitude: row?.longitude ?? null,
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

export const PIN_NOTE =
  'The map pin on this address is kept as it is. To move the pin, use the map at checkout.';

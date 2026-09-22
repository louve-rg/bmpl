/**
 * Editing rules for a terminal (logistics hub) — BMPL-139.
 *
 * The API's PATCH /admin/logistics/hubs/:id accepts a partial update of every
 * hub field, keyed by the stable id, so routes, history and handoffs survive
 * an edit. The console deliberately edits LESS than the API accepts (god's
 * BMPL-139 ruling): code, type, district, town and the pin place a terminal
 * in the network — the planner attaches doors by town and prices by hub — so
 * changing them is a routing decision, not a correction, and they are
 * display-only here. Editable: display name, contact name and phone, address
 * lines, counter instructions, modes.
 *
 * What belongs in this module is the browser-side arithmetic of "what did the
 * operator actually change": the PATCH carries only changed fields, so the
 * audit trail records real changes, every unsent field (including isTest and
 * courierFeeMinor) stays untouched, and an untouched form is refused
 * client-side instead of round-tripping to the schema's "Nothing to update."
 *
 * One server reality encoded rather than hidden: a contact phone cannot be
 * cleared (phoneSchema refuses the empty string) — an emptied phone is
 * "leave unchanged".
 */

export interface EditableHub {
  id: string;
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  modes: string[];
  instructions: string | null;
  contactName: string | null;
  contactPhone: string | null;
}

export interface HubEditForm {
  name: string;
  addressLine1: string;
  addressLine2: string;
  modes: string[];
  instructions: string;
  contactName: string;
  contactPhone: string;
}

export function hubToForm(h: EditableHub): HubEditForm {
  return {
    name: h.name,
    addressLine1: h.addressLine1 ?? '',
    addressLine2: h.addressLine2 ?? '',
    modes: [...h.modes],
    instructions: h.instructions ?? '',
    contactName: h.contactName ?? '',
    contactPhone: h.contactPhone ?? '',
  };
}

/** Mirrors the server's own floor: a name of at least 2 characters and at
 *  least one mode. The server re-checks — this only keeps Save honest. */
export function hubEditFormValid(form: HubEditForm): boolean {
  return form.name.trim().length >= 2 && form.modes.length > 0;
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

/**
 * Only what changed. An empty object means "nothing changed" and must not be
 * sent.
 */
export function hubEditPatch(hub: EditableHub, form: HubEditForm): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  const name = form.name.trim();
  if (name.length >= 2 && name !== hub.name) patch.name = name;

  // Optional text: the empty string is a real value to the API ("cleared").
  for (const key of ['addressLine1', 'addressLine2', 'instructions', 'contactName'] as const) {
    const next = form[key].trim();
    if (next !== (hub[key] ?? '')) patch[key] = next;
  }

  // The phone schema refuses '', so an emptied phone stays as it was.
  const phone = form.contactPhone.trim();
  if (phone !== '' && phone !== (hub.contactPhone ?? '')) patch.contactPhone = phone;

  if (!sameSet(form.modes, hub.modes)) patch.modes = form.modes;

  return patch;
}

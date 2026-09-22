/**
 * Editing rules for a terminal (logistics hub) — BMPL-139.
 *
 * The API's PATCH /admin/logistics/hubs/:id accepts a partial update of every
 * hub field, keyed by the stable id, so routes, history and handoffs survive
 * an edit. The console deliberately edits LESS than the API accepts (god's
 * BMPL-139 ruling): code, district and town drive planning and identity —
 * the planner attaches doors by town — so changing them is a routing
 * decision, not a correction, and they are display-only here. Editable:
 * display name, type, contact name and phone, address lines, the pin,
 * counter instructions, modes.
 *
 * What belongs in this module is the browser-side arithmetic of "what did the
 * operator actually change": the PATCH carries only changed fields, so the
 * audit trail records real changes, every unsent field (including isTest and
 * courierFeeMinor) stays untouched, and an untouched form is refused
 * client-side instead of round-tripping to the schema's "Nothing to update."
 *
 * Two server realities encoded rather than hidden: a saved pin can be moved
 * but not removed (coordinates are optional, never null, in updateHubSchema)
 * — an emptied pair is "leave unchanged" — and a contact phone cannot be
 * cleared (phoneSchema refuses the empty string) — an emptied phone is
 * "leave unchanged".
 */

export interface EditableHub {
  id: string;
  name: string;
  type: string;
  addressLine1: string | null;
  addressLine2: string | null;
  latitude: number | null;
  longitude: number | null;
  modes: string[];
  instructions: string | null;
  contactName: string | null;
  contactPhone: string | null;
}

/** Everything is a string in the form; numbers are parsed only when saving. */
export interface HubEditForm {
  name: string;
  type: string;
  addressLine1: string;
  addressLine2: string;
  latitude: string;
  longitude: string;
  modes: string[];
  instructions: string;
  contactName: string;
  contactPhone: string;
}

export function hubToForm(h: EditableHub): HubEditForm {
  return {
    name: h.name,
    type: h.type,
    addressLine1: h.addressLine1 ?? '',
    addressLine2: h.addressLine2 ?? '',
    latitude: h.latitude == null ? '' : String(h.latitude),
    longitude: h.longitude == null ? '' : String(h.longitude),
    modes: [...h.modes],
    instructions: h.instructions ?? '',
    contactName: h.contactName ?? '',
    contactPhone: h.contactPhone ?? '',
  };
}

/** Mirrors the server's own floor: a name of at least 2 characters, at least
 *  one mode, and a pin that is both coordinates or neither. The server
 *  re-checks — this only keeps Save honest. */
export function hubEditFormValid(form: HubEditForm): boolean {
  if (form.name.trim().length < 2) return false;
  if (form.modes.length === 0) return false;
  const hasLat = form.latitude.trim() !== '';
  const hasLng = form.longitude.trim() !== '';
  if (hasLat !== hasLng) return false;
  if (hasLat && (!Number.isFinite(Number(form.latitude)) || !Number.isFinite(Number(form.longitude)))) return false;
  return true;
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

  if (form.type !== hub.type) patch.type = form.type;

  // Optional text: the empty string is a real value to the API ("cleared").
  for (const key of ['addressLine1', 'addressLine2', 'instructions', 'contactName'] as const) {
    const next = form[key].trim();
    if (next !== (hub[key] ?? '')) patch[key] = next;
  }

  // The phone schema refuses '', so an emptied phone stays as it was.
  const phone = form.contactPhone.trim();
  if (phone !== '' && phone !== (hub.contactPhone ?? '')) patch.contactPhone = phone;

  // A pin moves as a pair or not at all; emptied means unchanged.
  const latRaw = form.latitude.trim();
  const lngRaw = form.longitude.trim();
  if (latRaw !== '' && lngRaw !== '') {
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== hub.latitude || lng !== hub.longitude)) {
      patch.latitude = lat;
      patch.longitude = lng;
    }
  }

  if (!sameSet(form.modes, hub.modes)) patch.modes = form.modes;

  return patch;
}

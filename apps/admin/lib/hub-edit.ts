/**
 * Editing rules for a terminal (logistics hub) — BMPL-139.
 *
 * The API's PATCH /admin/logistics/hubs/:id already accepts a partial update of
 * every hub field, keyed by the stable id, so routes, history and handoffs
 * survive an edit. What belongs here is the browser-side arithmetic of "what
 * did the operator actually change": the patch sent to the server carries only
 * changed fields, so the audit trail records real changes and an untouched
 * form is refused client-side instead of round-tripping to the schema's
 * "Nothing to update."
 *
 * Two server realities this module encodes rather than hides:
 * - A saved pin can be moved but not removed (coordinates are optional, never
 *   null, in updateHubSchema). An emptied pair is "leave unchanged".
 * - A contact phone cannot be cleared (phoneSchema refuses the empty string).
 *   An emptied phone is "leave unchanged".
 */

export interface EditableHub {
  id: string;
  code: string;
  name: string;
  type: string;
  district: string;
  city: string;
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
  code: string;
  name: string;
  type: string;
  district: string;
  city: string;
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
    code: h.code,
    name: h.name,
    type: h.type,
    district: h.district,
    city: h.city,
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

/** Mirrors the create form's own gate: code, name, town, at least one mode,
 *  and a pin that is both coordinates or neither. The server re-checks all of
 *  it — this only keeps the Save button honest. */
export function hubEditFormValid(form: HubEditForm): boolean {
  if (form.code.trim().length < 2) return false;
  if (form.name.trim().length < 2) return false;
  if (form.city.trim().length < 2) return false;
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
 * sent. courierFeeMinor, isActive and isTest are deliberately never produced
 * here — the first two have their own controls on the card, and moving a hub
 * between the real and simulation networks is not an edit, it is a decision
 * (simulation isolation, CLAUDE.md §6).
 */
export function hubEditPatch(hub: EditableHub, form: HubEditForm): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  const code = form.code.trim().toUpperCase();
  if (code.length >= 2 && code !== hub.code) patch.code = code;

  const name = form.name.trim();
  if (name.length >= 2 && name !== hub.name) patch.name = name;

  if (form.type !== hub.type) patch.type = form.type;
  if (form.district !== hub.district) patch.district = form.district;

  const city = form.city.trim();
  if (city.length >= 2 && city !== hub.city) patch.city = city;

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

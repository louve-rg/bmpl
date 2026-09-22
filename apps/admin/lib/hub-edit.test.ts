import { describe, expect, it } from 'vitest';
import { hubEditFormValid, hubEditPatch, hubToForm, type EditableHub } from './hub-edit';

const hub: EditableHub = {
  id: 'hub_1',
  name: 'San Pedro Airstrip',
  type: 'AIRSTRIP',
  addressLine1: 'Airstrip Rd',
  addressLine2: null,
  latitude: 17.9139,
  longitude: -87.9711,
  modes: ['AIR', 'LAND'],
  instructions: 'Counter 2, 8am-5pm',
  contactName: null,
  contactPhone: '226-2012',
};

describe('hubToForm', () => {
  it('maps nulls to empty strings and numbers to strings', () => {
    const f = hubToForm(hub);
    expect(f.addressLine2).toBe('');
    expect(f.contactName).toBe('');
    expect(f.latitude).toBe('17.9139');
    expect(f.modes).toEqual(['AIR', 'LAND']);
  });

  it('copies modes so editing the form never mutates the hub row', () => {
    const f = hubToForm(hub);
    f.modes.push('SEA');
    expect(hub.modes).toEqual(['AIR', 'LAND']);
  });
});

describe('hubEditPatch', () => {
  it('is empty when nothing changed', () => {
    expect(hubEditPatch(hub, hubToForm(hub))).toEqual({});
  });

  it('carries only the changed fields', () => {
    const f = { ...hubToForm(hub), name: 'San Pedro Airstrip (North)', contactName: 'Maria' };
    expect(hubEditPatch(hub, f)).toEqual({ name: 'San Pedro Airstrip (North)', contactName: 'Maria' });
  });

  it('trims the name and ignores a too-short one', () => {
    expect(hubEditPatch(hub, { ...hubToForm(hub), name: '  San Pedro Airstrip  ' })).toEqual({});
    expect(hubEditPatch(hub, { ...hubToForm(hub), name: 'S' })).toEqual({});
  });

  it('clears optional text with an empty string', () => {
    expect(hubEditPatch(hub, { ...hubToForm(hub), instructions: '' })).toEqual({ instructions: '' });
  });

  it('never tries to clear the phone — the API refuses an empty one', () => {
    expect(hubEditPatch(hub, { ...hubToForm(hub), contactPhone: '' })).toEqual({});
    expect(hubEditPatch(hub, { ...hubToForm(hub), contactPhone: '226-3000' })).toEqual({ contactPhone: '226-3000' });
  });

  it('compares modes as a set', () => {
    expect(hubEditPatch(hub, { ...hubToForm(hub), modes: ['LAND', 'AIR'] })).toEqual({});
    expect(hubEditPatch(hub, { ...hubToForm(hub), modes: ['AIR'] })).toEqual({ modes: ['AIR'] });
  });

  it('moves the pin only as a complete pair, and treats emptied as unchanged', () => {
    expect(hubEditPatch(hub, { ...hubToForm(hub), latitude: '', longitude: '' })).toEqual({});
    expect(hubEditPatch(hub, { ...hubToForm(hub), latitude: '18.0', longitude: '' })).toEqual({});
    expect(hubEditPatch(hub, { ...hubToForm(hub), latitude: '18.0' })).toEqual({ latitude: 18, longitude: -87.9711 });
  });

  it('carries a changed type', () => {
    expect(hubEditPatch(hub, { ...hubToForm(hub), type: 'AIRPORT' })).toEqual({ type: 'AIRPORT' });
  });

  it('never produces the network-placing or ruled-out fields', () => {
    // God's BMPL-139 hold: code, district and town are display-only (they
    // drive planning and identity); fee, active and simulation flags have
    // their own controls or are decisions. A regression that starts sending
    // any of them is a scope violation, not a feature.
    const everything = {
      ...hubToForm(hub),
      name: 'Renamed',
      addressLine1: 'New road',
      contactPhone: '226-4000',
      modes: ['AIR'],
    };
    const patch = hubEditPatch(hub, everything);
    for (const banned of ['code', 'district', 'city', 'courierFeeMinor', 'isActive', 'isTest']) {
      expect(banned in patch, banned).toBe(false);
    }
    expect(Object.keys(patch).sort()).toEqual(['addressLine1', 'contactPhone', 'modes', 'name']);
  });
});

describe('hubEditFormValid', () => {
  it('accepts the unchanged form', () => {
    expect(hubEditFormValid(hubToForm(hub))).toBe(true);
  });

  it('requires a name and at least one mode', () => {
    expect(hubEditFormValid({ ...hubToForm(hub), name: ' ' })).toBe(false);
    expect(hubEditFormValid({ ...hubToForm(hub), modes: [] })).toBe(false);
  });

  it('requires the pin to be both coordinates or neither, and numeric', () => {
    expect(hubEditFormValid({ ...hubToForm(hub), latitude: '', longitude: '' })).toBe(true);
    expect(hubEditFormValid({ ...hubToForm(hub), longitude: '' })).toBe(false);
    expect(hubEditFormValid({ ...hubToForm(hub), latitude: 'north-ish' })).toBe(false);
  });
});

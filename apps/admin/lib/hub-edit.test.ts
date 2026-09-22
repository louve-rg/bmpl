import { describe, expect, it } from 'vitest';
import { hubEditFormValid, hubEditPatch, hubToForm, type EditableHub } from './hub-edit';

const hub: EditableHub = {
  id: 'hub_1',
  code: 'SPA',
  name: 'San Pedro Airstrip',
  type: 'AIRSTRIP',
  district: 'BELIZE',
  city: 'San Pedro',
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

  it('uppercases and trims the code, and ignores a too-short one', () => {
    expect(hubEditPatch(hub, { ...hubToForm(hub), code: ' spw ' })).toEqual({ code: 'SPW' });
    expect(hubEditPatch(hub, { ...hubToForm(hub), code: 'S' })).toEqual({});
  });

  it('clears optional text with an empty string', () => {
    const f = { ...hubToForm(hub), instructions: '' };
    expect(hubEditPatch(hub, f)).toEqual({ instructions: '' });
  });

  it('never tries to clear the phone — the API refuses an empty one', () => {
    expect(hubEditPatch(hub, { ...hubToForm(hub), contactPhone: '' })).toEqual({});
    expect(hubEditPatch(hub, { ...hubToForm(hub), contactPhone: '226-3000' })).toEqual({ contactPhone: '226-3000' });
  });

  it('moves the pin only as a complete pair, and treats emptied as unchanged', () => {
    expect(hubEditPatch(hub, { ...hubToForm(hub), latitude: '', longitude: '' })).toEqual({});
    expect(hubEditPatch(hub, { ...hubToForm(hub), latitude: '18.0', longitude: '' })).toEqual({});
    expect(hubEditPatch(hub, { ...hubToForm(hub), latitude: '18.0' })).toEqual({ latitude: 18, longitude: -87.9711 });
  });

  it('compares modes as a set', () => {
    expect(hubEditPatch(hub, { ...hubToForm(hub), modes: ['LAND', 'AIR'] })).toEqual({});
    expect(hubEditPatch(hub, { ...hubToForm(hub), modes: ['AIR'] })).toEqual({ modes: ['AIR'] });
  });

  it('never produces fee, active or simulation flags', () => {
    const f = { ...hubToForm(hub), name: 'Renamed' };
    const patch = hubEditPatch(hub, f);
    expect('courierFeeMinor' in patch).toBe(false);
    expect('isActive' in patch).toBe(false);
    expect('isTest' in patch).toBe(false);
  });
});

describe('hubEditFormValid', () => {
  it('accepts the unchanged form', () => {
    expect(hubEditFormValid(hubToForm(hub))).toBe(true);
  });

  it('requires code, name, town and at least one mode', () => {
    expect(hubEditFormValid({ ...hubToForm(hub), code: 'S' })).toBe(false);
    expect(hubEditFormValid({ ...hubToForm(hub), name: ' ' })).toBe(false);
    expect(hubEditFormValid({ ...hubToForm(hub), city: '' })).toBe(false);
    expect(hubEditFormValid({ ...hubToForm(hub), modes: [] })).toBe(false);
  });

  it('requires the pin to be both coordinates or neither, and numeric', () => {
    expect(hubEditFormValid({ ...hubToForm(hub), latitude: '', longitude: '' })).toBe(true);
    expect(hubEditFormValid({ ...hubToForm(hub), longitude: '' })).toBe(false);
    expect(hubEditFormValid({ ...hubToForm(hub), latitude: 'north-ish' })).toBe(false);
  });
});

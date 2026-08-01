import { describe, expect, it } from 'vitest';
import {
  availableValuesForOption,
  resolveSelectedVariant,
  variantsForSelection,
  type OptionLike,
  type Selection,
  type VariantLike,
} from './variant-availability';

// Options: Fragrance {hb, pip, ging} × Size {small, medium, large}
const options: OptionLike[] = [
  { id: 'frag', name: 'Fragrance', values: [
    { id: 'hb', value: 'Hello Beautiful' },
    { id: 'pip', value: 'Perfect in Pink' },
    { id: 'ging', value: 'Gingham' },
  ] },
  { id: 'size', name: 'Size', values: [
    { id: 'small', value: 'Small' },
    { id: 'medium', value: 'Medium' },
    { id: 'large', value: 'Large' },
  ] },
];

function variant(id: string, optionValueIds: string[], inStock = true): VariantLike {
  return {
    id,
    title: id,
    priceMinor: 1000,
    salePriceMinor: null,
    optionValueIds,
    availability: { inStock, outOfStock: !inStock, available: inStock ? 5 : 0, unlimited: false, allowBackorders: false },
  };
}

// Hello Beautiful / Small, Hello Beautiful / Large, Perfect in Pink / Medium, Gingham / Small
const variants: VariantLike[] = [
  variant('hb-small', ['hb', 'small']),
  variant('hb-large', ['hb', 'large']),
  variant('pip-medium', ['pip', 'medium']),
  variant('ging-small', ['ging', 'small']),
];
const ids = (vs: VariantLike[]) => vs.map((v) => v.id).sort();

describe('variantsForSelection (intersection filtering)', () => {
  it('selecting a fragrance hides all other fragrances', () => {
    const sel: Selection = { frag: 'ging' };
    expect(ids(variantsForSelection(variants, sel))).toEqual(['ging-small']);
    // never Hello Beautiful or Perfect in Pink
    const shown = variantsForSelection(variants, sel);
    expect(shown.some((v) => v.optionValueIds.includes('hb'))).toBe(false);
    expect(shown.some((v) => v.optionValueIds.includes('pip'))).toBe(false);
  });

  it('Fragrance: Hello Beautiful + Size: All shows only Hello Beautiful variants (all its sizes)', () => {
    expect(ids(variantsForSelection(variants, { frag: 'hb', size: '' }))).toEqual(['hb-large', 'hb-small']);
  });

  it('Fragrance: Gingham + Size: All shows only the Gingham variant', () => {
    expect(ids(variantsForSelection(variants, { frag: 'ging', size: '' }))).toEqual(['ging-small']);
  });

  it('All Fragrances + Size: Small shows only Small variants across fragrances', () => {
    expect(ids(variantsForSelection(variants, { frag: '', size: 'small' }))).toEqual(['ging-small', 'hb-small']);
  });

  it('no selection shows every available variant', () => {
    expect(ids(variantsForSelection(variants, {}))).toEqual(['ging-small', 'hb-large', 'hb-small', 'pip-medium']);
  });

  it('hides out-of-stock variants even when they match the selection', () => {
    const withOos = [variant('hb-small', ['hb', 'small']), variant('hb-large', ['hb', 'large'], false)];
    expect(ids(variantsForSelection(withOos, { frag: 'hb' }))).toEqual(['hb-small']);
  });
});

describe('availableValuesForOption (combination-aware dropdowns)', () => {
  it('offers only the sizes valid for the selected fragrance', () => {
    expect([...availableValuesForOption(variants, options, { frag: 'hb' }, 'size')].sort()).toEqual(['large', 'small']);
    expect([...availableValuesForOption(variants, options, { frag: 'ging' }, 'size')]).toEqual(['small']);
    // Medium is never offered for Hello Beautiful (no such variant)
    expect(availableValuesForOption(variants, options, { frag: 'hb' }, 'size').has('medium')).toBe(false);
  });
});

describe('resolveSelectedVariant', () => {
  it('resolves the exact variant only when every option is chosen', () => {
    expect(resolveSelectedVariant(variants, { frag: 'hb', size: 'small' })?.id).toBe('hb-small');
    expect(resolveSelectedVariant(variants, { frag: 'hb' })).toBeNull(); // partial → none
  });
});

import { describe, expect, it } from 'vitest';
import { variantDisplay, secondaryLine } from './variant-display';

describe('variantDisplay — shared presentation model', () => {
  // Client fixture: base product "Bath & Body"; Fragrance = display name; + Size.
  it('Twisted Peppermint / Small → three separate lines, no slash, no repeat', () => {
    const d = variantDisplay({
      displayName: 'Twisted Peppermint',
      optionValues: ['Twisted Peppermint', 'Small'],
      title: 'Twisted Peppermint / Small',
      productTitle: 'Bath & Body',
    });
    expect(d.primary).toBe('Twisted Peppermint');
    expect(d.secondary).toEqual(['Small']); // the fragrance value equal to the name is dropped
    expect(d.family).toBe('Bath & Body');
  });

  it('Gingham / Small', () => {
    const d = variantDisplay({ displayName: 'Gingham', optionValues: ['Gingham', 'Small'], productTitle: 'Bath & Body' });
    expect([d.primary, ...d.secondary, d.family]).toEqual(['Gingham', 'Small', 'Bath & Body']);
  });

  it('Hello Beautiful / Large', () => {
    const d = variantDisplay({ displayName: 'Hello Beautiful', optionValues: ['Hello Beautiful', 'Large'], productTitle: 'Bath & Body' });
    expect([d.primary, ...d.secondary, d.family]).toEqual(['Hello Beautiful', 'Large', 'Bath & Body']);
  });

  it('supports 3+ options without hardcoding Size', () => {
    const d = variantDisplay({
      displayName: 'Classic Oxford',
      optionValues: ['Black', '10', 'Wide'],
      productTitle: "Men's Dress Shoes",
    });
    expect(d.primary).toBe('Classic Oxford');
    expect(d.secondary).toEqual(['Black', '10', 'Wide']); // none equals the name → all kept
    expect(d.family).toBe("Men's Dress Shoes");
    expect(secondaryLine(d.secondary)).toBe('Black · 10 · Wide');
  });

  it('falls back to the first option value when there is no display name (no slash title)', () => {
    const d = variantDisplay({ displayName: null, optionValues: ['Red', 'Small'], title: 'Red / Small', productTitle: 'Tee' });
    expect(d.primary).toBe('Red');
    expect(d.secondary).toEqual(['Small']);
  });

  it('product-level (no variant): primary is the product title, no family duplicate, no options', () => {
    const d = variantDisplay({ displayName: null, optionValues: [], title: null, productTitle: 'Simple Product' });
    expect(d.primary).toBe('Simple Product');
    expect(d.secondary).toEqual([]);
    expect(d.family).toBeNull(); // family would duplicate the primary → omitted
  });

  it('excludes an option value equal to the display name case-insensitively', () => {
    const d = variantDisplay({ displayName: 'twisted peppermint', optionValues: ['Twisted Peppermint', 'Small'], productTitle: 'Bath & Body' });
    expect(d.secondary).toEqual(['Small']);
  });

  it('never emits a slash-combined primary when structured values exist', () => {
    const d = variantDisplay({ displayName: null, optionValues: ['Blue', 'Large'], title: 'Blue / Large', productTitle: 'Hoodie' });
    expect(d.primary).not.toContain('/');
  });
});

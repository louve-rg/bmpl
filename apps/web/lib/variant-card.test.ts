import { describe, expect, it } from 'vitest';
import { optionValuesFor, variantCardLines } from './variant-card';
import type { OptionLike } from './variant-availability';

const fragranceSize: OptionLike[] = [
  { id: 'frag', name: 'Fragrance', values: [{ id: 'hb', value: 'Hello Beautiful' }, { id: 'pip', value: 'Perfect in Pink' }] },
  { id: 'size', name: 'Size', values: [{ id: 'l', value: 'Large' }, { id: 'm', value: 'Medium' }] },
];
const colorSizeWidth: OptionLike[] = [
  { id: 'c', name: 'Color', values: [{ id: 'black', value: 'Black' }] },
  { id: 's', name: 'Size', values: [{ id: 's10', value: '10' }] },
  { id: 'w', name: 'Width', values: [{ id: 'wide', value: 'Wide' }] },
];

describe('variant card lines', () => {
  it('shows displayName then the remaining option value (Hello Beautiful / Large / price)', () => {
    const lines = variantCardLines({ title: 'Hello Beautiful', displayName: 'Hello Beautiful', optionValueIds: ['hb', 'l'] }, fragranceSize);
    expect(lines.primary).toBe('Hello Beautiful');
    expect(lines.secondary).toEqual(['Large']); // Size on its own line, primary not repeated
  });

  it('does not repeat the primary value when the displayName duplicates an option', () => {
    // "Hello Beautiful" is both the displayName AND the Fragrance value → shown once.
    const lines = variantCardLines({ title: 'x', displayName: 'Hello Beautiful', optionValueIds: ['hb', 'l'] }, fragranceSize);
    expect(lines.secondary).not.toContain('Hello Beautiful');
    expect([lines.primary, ...lines.secondary]).toEqual(['Hello Beautiful', 'Large']);
  });

  it('supports MORE than two options (Classic Oxford / Black · 10 · Wide)', () => {
    const lines = variantCardLines({ title: 'Classic Oxford', displayName: 'Classic Oxford', optionValueIds: ['black', 's10', 'wide'] }, colorSizeWidth);
    expect(lines.primary).toBe('Classic Oxford');
    expect(lines.secondary).toEqual(['Black', '10', 'Wide']);
    expect(lines.secondary.join(' · ')).toBe('Black · 10 · Wide');
  });

  it('falls back to the first option value when there is no displayName', () => {
    const lines = variantCardLines({ title: 'Hello Beautiful · Large', displayName: null, optionValueIds: ['hb', 'l'] }, fragranceSize);
    expect(lines.primary).toBe('Hello Beautiful'); // first value, not the joined title
    expect(lines.secondary).toEqual(['Large']);
  });

  it('optionValuesFor returns values in option order', () => {
    expect(optionValuesFor(['l', 'hb'], fragranceSize)).toEqual(['Hello Beautiful', 'Large']); // Fragrance before Size
  });
});

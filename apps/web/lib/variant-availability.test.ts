import { describe, expect, it } from 'vitest';
import {
  availableValuesForOption,
  presentationVariant,
  purchaseState,
  reconcileSelection,
  resolveSelectedVariant,
  variantsForSelection,
  type OptionLike,
  type ProductLike,
  type Selection,
  type VariantLike,
} from './variant-availability';
import { variantCardLines } from './variant-card';

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

  it('INCLUDES out-of-stock variants that match the selection (shown + marked, never hidden)', () => {
    const withOos = [variant('hb-small', ['hb', 'small']), variant('hb-large', ['hb', 'large'], false)];
    const shown = variantsForSelection(withOos, { frag: 'hb' });
    expect(ids(shown)).toEqual(['hb-large', 'hb-small']); // BOTH — the OOS one is not dropped
    expect(shown.find((v) => v.id === 'hb-large')?.availability.inStock).toBe(false);
  });
});

// ===========================================================================
// The reported "Bags" fixture — 4 variants, only ONE in stock, and TWO sharing the
// display name "Hand Bag". The lineup must show all four (out-of-stock included) and
// never collapse to the single in-stock / first-added variant.
// ===========================================================================
const bagOptions: OptionLike[] = [
  { id: 'type', name: 'Type', values: [
    { id: 'hand', value: 'Hand Bag' }, { id: 'purse', value: 'Purse' }, { id: 'sling', value: 'Sling Bag' },
  ] },
  { id: 'color', name: 'Color', values: [
    { id: 'black', value: 'Black' }, { id: 'mblack', value: 'Matte Black' }, { id: 'beige', value: 'Beige' },
  ] },
  { id: 'size', name: 'Size', values: [
    { id: 'small', value: 'Small' }, { id: 'medium', value: 'Medium' }, { id: 'large', value: 'Large' },
  ] },
];
// A: Hand Bag/Black/Large (OOS), B: Sling/Beige/Small (in stock), C: Purse/Beige/Small (OOS),
// D: Hand Bag/Matte Black/Medium (OOS) — newest-first order as the API returns them.
const bags: VariantLike[] = [
  variant('D-hand-mblack-med', ['hand', 'mblack', 'medium'], false),
  variant('C-purse-beige-sm', ['purse', 'beige', 'small'], false),
  variant('B-sling-beige-sm', ['sling', 'beige', 'small'], true),
  variant('A-hand-black-lg', ['hand', 'black', 'large'], false),
];
const bagIds = (vs: VariantLike[]) => vs.map((v) => v.id);

describe('Bags fixture — all valid variants shown (out-of-stock included, duplicate names kept)', () => {
  it('initial All state lists ALL FOUR variants, not just the in-stock / first one', () => {
    const all = variantsForSelection(bags, {});
    expect(all).toHaveLength(4);
    expect(bagIds(all).sort()).toEqual(['A-hand-black-lg', 'B-sling-beige-sm', 'C-purse-beige-sm', 'D-hand-mblack-med']);
    // exactly one is in stock — the other three must still be present
    expect(all.filter((v) => v.availability.inStock)).toHaveLength(1);
  });

  it('keeps the two "Hand Bag" variants separate (identity is the option combination, not the name)', () => {
    const all = variantsForSelection(bags, {});
    const handBags = all.filter((v) => v.optionValueIds.includes('hand'));
    expect(handBags).toHaveLength(2);
    // unique ids → unique React keys (never keyed by display name)
    expect(new Set(handBags.map((v) => v.id)).size).toBe(2);
    const black = handBags.find((v) => v.id === 'A-hand-black-lg')!;
    const matte = handBags.find((v) => v.id === 'D-hand-mblack-med')!;
    expect(variantCardLines(black, bagOptions)).toEqual({ primary: 'Hand Bag', secondary: ['Black', 'Large'] });
    expect(variantCardLines(matte, bagOptions)).toEqual({ primary: 'Hand Bag', secondary: ['Matte Black', 'Medium'] });
  });

  it('initial All state has NO presentation variant (main view is product-level; gallery = all)', () => {
    expect(presentationVariant(bags, {})).toBeNull();
  });

  it('filters correctly: Type=Sling → 1, Size=Small → both Small variants, Color=Black → 1', () => {
    expect(bagIds(variantsForSelection(bags, { type: 'sling' }))).toEqual(['B-sling-beige-sm']);
    expect(bagIds(variantsForSelection(bags, { size: 'small' })).sort()).toEqual(['B-sling-beige-sm', 'C-purse-beige-sm']);
    expect(bagIds(variantsForSelection(bags, { color: 'black' }))).toEqual(['A-hand-black-lg']);
    // returning to All restores all four
    expect(variantsForSelection(bags, {})).toHaveLength(4);
  });

  it('dropdowns offer values that lead to out-of-stock variants too (so every combo is reachable)', () => {
    const colors = availableValuesForOption(bags, bagOptions, {}, 'color');
    expect([...colors].sort()).toEqual(['beige', 'black', 'mblack']); // Black/Matte Black are OOS but still offered
  });

  it('selecting a fully out-of-stock combination presents it as OUT_OF_STOCK (not hidden/SELECT)', () => {
    const product: ProductLike = { priceMinor: 3000, salePriceMinor: null, availability: { inStock: true, outOfStock: false, available: null, unlimited: true, allowBackorders: false } };
    const ps = purchaseState(product, bags, { type: 'hand', color: 'black', size: 'large' });
    expect(ps.state).toBe('OUT_OF_STOCK');
    expect(ps.variant?.id).toBe('A-hand-black-lg');
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

// ===========================================================================
// Faceted, non-trapping option filtering — the EXACT reported fixture:
//   Hello Beautiful / Large · Perfect in Pink / Medium · Gingham / Small
// (each fragrance in exactly one size — the circular-lock trap scenario)
// ===========================================================================
const fx: VariantLike[] = [
  variant('hb-large', ['hb', 'large']),
  variant('pip-medium', ['pip', 'medium']),
  variant('ging-small', ['ging', 'small']),
];
const vals = (s: Set<string>) => [...s].sort();
const availSize = (sel: Selection) => vals(availableValuesForOption(fx, options, sel, 'size'));
const availFrag = (sel: Selection) => vals(availableValuesForOption(fx, options, sel, 'frag'));
const change = (prev: Selection, opt: string, val: string) => reconcileSelection(fx, options, prev, opt, val);

describe('faceted dropdown availability (ignores its own current value)', () => {
  it('Test 1 — initial state offers every fragrance and every size', () => {
    expect(availFrag({})).toEqual(['ging', 'hb', 'pip']);
    expect(availSize({})).toEqual(['large', 'medium', 'small']);
    expect(ids(variantsForSelection(fx, {}))).toEqual(['ging-small', 'hb-large', 'pip-medium']);
  });

  it('Test 2 (the reported bug) — after Size: Medium, Size STILL offers all sizes; Fragrance narrows but keeps All reachable', () => {
    const sel = change({}, 'size', 'medium');
    expect(sel).toEqual({ size: 'medium' }); // Fragrance is NOT auto-filled
    expect(ids(variantsForSelection(fx, sel))).toEqual(['pip-medium']);
    // Size dropdown ignores its own value → still Small/Medium/Large (NOT collapsed to Medium)
    expect(availSize(sel)).toEqual(['large', 'medium', 'small']);
    // Fragrance dropdown reflects the Size=Medium filter, but "All" (value '') is always in the <select>
    expect(availFrag(sel)).toEqual(['pip']);
  });

  it('Test 3 — Medium → Large switches directly, no reset', () => {
    const sel = change({ size: 'medium' }, 'size', 'large');
    expect(sel).toEqual({ size: 'large' });
    expect(ids(variantsForSelection(fx, sel))).toEqual(['hb-large']);
  });

  it('Test 4 — from Size: Large, choosing All Fragrances keeps a valid, unstuck selection', () => {
    const sel = change({ size: 'large' }, 'frag', ''); // '' = All
    expect(sel).toEqual({ size: 'large' });
    expect(availFrag(sel)).toEqual(['hb']);
    expect(variantsForSelection(fx, sel).length).toBeGreaterThan(0);
  });

  it('Test 5 — Fragrance: Hello Beautiful → Size offers only Large', () => {
    const sel = change({}, 'frag', 'hb');
    expect(availSize(sel)).toEqual(['large']);
    expect(ids(variantsForSelection(fx, sel))).toEqual(['hb-large']);
  });

  it('Test 6 — changing Fragrance HB→Gingham clears the now-invalid Large; Gingham becomes visible', () => {
    const sel = change({ frag: 'hb', size: 'large' }, 'frag', 'ging');
    expect(sel).toEqual({ frag: 'ging' }); // Large dropped (no Gingham/Large), anchor Gingham kept
    expect(ids(variantsForSelection(fx, sel))).toEqual(['ging-small']);
    expect(availSize(sel)).toEqual(['small']);
  });

  it('Test 7 — All Fragrances restores every fragrance', () => {
    const sel = change({ frag: 'ging' }, 'frag', '');
    expect(sel).toEqual({});
    expect(availFrag(sel)).toEqual(['ging', 'hb', 'pip']);
  });

  it('Tests 8 & 9 — repeated alternation never traps and always keeps escapes', () => {
    // Size: Medium → Large → Small → All — Size always offers all three; result always has ≥1 variant or is empty(All)
    let sel: Selection = {};
    for (const step of ['medium', 'large', 'small', '']) {
      sel = change(sel, 'size', step);
      expect(availSize(sel)).toEqual(['large', 'medium', 'small']); // never collapses
      if (Object.values(sel).some(Boolean)) expect(variantsForSelection(fx, sel).length).toBeGreaterThan(0);
    }
    expect(sel).toEqual({});
    // Fragrance: HB → PIP → Gingham → All — Fragrance dropdown always offers all three
    for (const step of ['hb', 'pip', 'ging', '']) {
      sel = change(sel, 'frag', step);
      expect(availFrag(sel)).toEqual(['ging', 'hb', 'pip']);
    }
    expect(sel).toEqual({});
  });

  it('reconcile never yields an impossible selection (invariant)', () => {
    for (const f of ['hb', 'pip', 'ging']) {
      for (const s of ['small', 'medium', 'large']) {
        const sel = change(change({}, 'frag', f), 'size', s);
        // whatever survives must still match at least one variant
        expect(variantsForSelection(fx, sel).length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('presentationVariant (single-match, non-mutating)', () => {
  it('Test 10 — presents the right variant and keeps title/image/price/SKU in sync', () => {
    expect(presentationVariant(fx, {})).toBeNull(); // 3 matches → "Select options"
    expect(presentationVariant(fx, { size: 'medium' })?.id).toBe('pip-medium'); // single partial match
    expect(presentationVariant(fx, { frag: 'hb', size: 'large' })?.id).toBe('hb-large'); // exact
    // deriving a single match does not require (or produce) a fully-written selection
    const sel = change({}, 'size', 'small');
    expect(sel).toEqual({ size: 'small' });
    expect(presentationVariant(fx, sel)?.id).toBe('ging-small');
  });
});

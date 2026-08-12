import { describe, expect, it } from 'vitest';
import { findCategory, flattenCategoryIds, type CatNode } from './marketplace-categories';

/** A two-level taxonomy shaped like the one /marketplace/categories returns. */
const CATS: CatNode[] = [
  {
    id: 'c_food',
    name: 'Food & Drink',
    slug: 'food-drink',
    children: [
      { id: 'c_food_pantry', name: 'Pantry', slug: 'pantry', children: [] },
      { id: 'c_food_produce', name: 'Fresh Produce', slug: 'fresh-produce', children: [] },
    ],
  },
  { id: 'c_home', name: 'Home & Garden', slug: 'home-garden', children: [] },
  {
    id: 'c_tech',
    name: 'Electronics',
    slug: 'electronics',
    children: [{ id: 'c_tech_phones', name: 'Phones', slug: 'phones', children: [] }],
  },
];

describe('findCategory', () => {
  it('finds a top-level category', () => {
    expect(findCategory(CATS, 'c_home')?.name).toBe('Home & Garden');
  });

  it('finds a subcategory and names IT, not its parent', () => {
    // The collapsed mobile label must say what the shopper is actually filtered
    // by; showing "Food & Drink" for a Pantry filter would be a lie.
    expect(findCategory(CATS, 'c_food_produce')?.name).toBe('Fresh Produce');
  });

  it('returns null for "All" and for an unknown id', () => {
    expect(findCategory(CATS, undefined)).toBeNull();
    expect(findCategory(CATS, '')).toBeNull();
    expect(findCategory(CATS, 'c_nope')).toBeNull();
  });

  it('handles a category with no children array at all', () => {
    const sparse = [{ id: 'c_x', name: 'X', slug: 'x' } as unknown as CatNode];
    expect(findCategory(sparse, 'c_x')?.name).toBe('X');
    expect(findCategory(sparse, 'c_y')).toBeNull();
  });

  it('does not mutate or reorder the taxonomy', () => {
    const before = JSON.stringify(CATS);
    findCategory(CATS, 'c_tech_phones');
    flattenCategoryIds(CATS);
    expect(JSON.stringify(CATS)).toBe(before);
  });
});

describe('flattenCategoryIds', () => {
  it('keeps every id in the hierarchy, parents before their children', () => {
    // The mobile control renders the SAME set the desktop sidebar does — the
    // hierarchy is collapsed visually, never flattened away.
    expect(flattenCategoryIds(CATS)).toEqual([
      'c_food',
      'c_food_pantry',
      'c_food_produce',
      'c_home',
      'c_tech',
      'c_tech_phones',
    ]);
  });

  it('resolves every id it produces', () => {
    for (const id of flattenCategoryIds(CATS)) {
      expect(findCategory(CATS, id), id).not.toBeNull();
    }
  });
});

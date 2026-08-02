import { describe, expect, it } from 'vitest';
import { buildGalleryImages, type OrderedImage } from './gallery';

// Exact client fixture. Variant order: Hello Beautiful, Perfect in Pink, Gingham.
// Each variant: Group Image (primary, pos 0), Lotion (pos 1), Spray (pos 2).
const img = (url: string, variantId: string | null, position: number, isPrimary = false): OrderedImage & { url: string } => ({ url, variantId, position, isPrimary });

// Input in the API's GLOBAL order (isPrimary desc, then position asc) — i.e. the
// interleaved sequence the customer currently sees. The utility must regroup it.
const apiInterleaved = [
  img('hb-group', 'hb', 0, true),
  img('pip-group', 'pip', 0, true),
  img('ging-group', 'ging', 0, true),
  img('hb-lotion', 'hb', 1),
  img('pip-lotion', 'pip', 1),
  img('ging-lotion', 'ging', 1),
  img('hb-spray', 'hb', 2),
  img('pip-spray', 'pip', 2),
  img('ging-spray', 'ging', 2),
];
const ORDER = ['hb', 'pip', 'ging'];
const urls = (a: Array<{ url?: string | null }>) => a.map((i) => i.url);

describe('buildGalleryImages — combined "All" gallery', () => {
  it('groups by variant in vendor order, primary first within each group (never interleaved)', () => {
    expect(urls(buildGalleryImages(apiInterleaved, ORDER, null))).toEqual([
      'hb-group', 'hb-lotion', 'hb-spray',
      'pip-group', 'pip-lotion', 'pip-spray',
      'ging-group', 'ging-lotion', 'ging-spray',
    ]);
  });

  it('is insensitive to incoming API order (reversed input → same grouped output)', () => {
    const shuffled = [...apiInterleaved].reverse();
    expect(urls(buildGalleryImages(shuffled, ORDER, null))).toEqual([
      'hb-group', 'hb-lotion', 'hb-spray', 'pip-group', 'pip-lotion', 'pip-spray', 'ging-group', 'ging-lotion', 'ging-spray',
    ]);
  });

  it('places general (non-variant) images first, then the variant groups', () => {
    const withGeneral = [img('gen-2', null, 1), img('gen-1', null, 0, true), ...apiInterleaved];
    expect(urls(buildGalleryImages(withGeneral, ORDER, null))).toEqual([
      'gen-1', 'gen-2',
      'hb-group', 'hb-lotion', 'hb-spray', 'pip-group', 'pip-lotion', 'pip-spray', 'ging-group', 'ging-lotion', 'ging-spray',
    ]);
  });

  it('never duplicates an image', () => {
    const out = buildGalleryImages(apiInterleaved, ORDER, null);
    expect(new Set(urls(out)).size).toBe(out.length);
  });

  it('respects variant order changes (Gingham first → its group leads)', () => {
    expect(urls(buildGalleryImages(apiInterleaved, ['ging', 'hb', 'pip'], null)).slice(0, 3)).toEqual(['ging-group', 'ging-lotion', 'ging-spray']);
  });
});

describe('buildGalleryImages — specific variant selected (unchanged behaviour)', () => {
  it('returns only Perfect in Pink images, vendor order', () => {
    expect(urls(buildGalleryImages(apiInterleaved, ORDER, 'pip'))).toEqual(['pip-group', 'pip-lotion', 'pip-spray']);
  });
  it('returns only Gingham images, vendor order', () => {
    expect(urls(buildGalleryImages(apiInterleaved, ORDER, 'ging'))).toEqual(['ging-group', 'ging-lotion', 'ging-spray']);
  });
  it('returning to All restores the grouped combined sequence', () => {
    const pip = urls(buildGalleryImages(apiInterleaved, ORDER, 'pip'));
    const all = urls(buildGalleryImages(apiInterleaved, ORDER, null));
    expect(pip).toEqual(['pip-group', 'pip-lotion', 'pip-spray']);
    expect(all.length).toBe(9);
    expect(all.slice(3, 6)).toEqual(pip); // PIP group intact inside the All sequence
  });
  it('falls back to general/all when the selected variant has no images', () => {
    const withGeneral = [img('gen-1', null, 0, true), ...apiInterleaved];
    expect(urls(buildGalleryImages(withGeneral, ORDER, 'nonexistent'))).toEqual(['gen-1']);
  });
});

describe('buildGalleryImages — products without variant galleries', () => {
  it('returns general images in vendor order (primary first) for a simple product', () => {
    const simple = [img('s2', null, 1), img('s1', null, 0, true), img('s3', null, 2)];
    expect(urls(buildGalleryImages(simple, [], null))).toEqual(['s1', 's2', 's3']);
  });
});

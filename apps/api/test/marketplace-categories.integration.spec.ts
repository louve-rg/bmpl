/**
 * Marketplace category baseline seed (M26.2) — proves the shipped migration
 * `20260920120000_seed_marketplace_categories` is idempotent, preserves existing
 * (client-edited) rows, keeps parent/child links valid, and surfaces the hierarchy
 * through the public API. The test executes the REAL migration SQL, not a copy.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, resetDb, type TestContext } from './helpers';

let ctx: TestContext;

const MIGRATION_SQL = resolve(
  process.cwd(),
  '../../packages/database/prisma/migrations/20260920120000_seed_marketplace_categories/migration.sql',
);

/** Run the migration file statement-by-statement (strip comments/blank lines). */
async function runBaselineSeed() {
  const raw = readFileSync(MIGRATION_SQL, 'utf8');
  const statements = raw
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await ctx.prisma.$executeRawUnsafe(stmt);
  }
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
});
afterAll(async () => { await ctx.app.close(); });

describe('marketplace category baseline seed', () => {
  it('first run creates the full baseline hierarchy (8 top-level + children)', async () => {
    await runBaselineSeed();
    const total = await ctx.prisma.category.count();
    const top = await ctx.prisma.category.count({ where: { parentId: null } });
    expect(top).toBe(8);
    expect(total).toBe(36);
    // parent/child link is valid
    const phones = await ctx.prisma.category.findUnique({ where: { slug: 'phones-tablets' }, include: { parent: true } });
    expect(phones?.parent?.slug).toBe('electronics');
    // no dangling parentId
    const ids = new Set((await ctx.prisma.category.findMany({ select: { id: true } })).map((c) => c.id));
    const children = await ctx.prisma.category.findMany({ where: { parentId: { not: null } }, select: { parentId: true } });
    expect(children.every((c) => ids.has(c.parentId!))).toBe(true);
  });

  it('second run creates no duplicates and leaves existing (client-edited) rows unchanged', async () => {
    const before = await ctx.prisma.category.count();
    const electronics = await ctx.prisma.category.findUniqueOrThrow({ where: { slug: 'electronics' } });
    // simulate a client edit of an existing category
    await ctx.prisma.category.update({ where: { id: electronics.id }, data: { name: 'Electronics (client-renamed)', featured: false } });
    // re-run the baseline seed
    await runBaselineSeed();
    // no new rows, and the edited row is preserved verbatim (ON CONFLICT DO NOTHING)
    expect(await ctx.prisma.category.count()).toBe(before);
    const after = await ctx.prisma.category.findUniqueOrThrow({ where: { slug: 'electronics' } });
    expect(after.id).toBe(electronics.id); // id never changes
    expect(after.name).toBe('Electronics (client-renamed)'); // client edit preserved
    expect(after.featured).toBe(false);
  });

  it('preserves client-created categories not in the baseline', async () => {
    const custom = await ctx.prisma.category.create({ data: { name: 'Custom Vendor Category', slug: `custom-${Date.now()}` } });
    await runBaselineSeed();
    const still = await ctx.prisma.category.findUnique({ where: { id: custom.id } });
    expect(still).not.toBeNull();
    expect(still?.name).toBe('Custom Vendor Category');
  });

  it('public API returns the category hierarchy with children', async () => {
    const res = await request(ctx.server).get('/api/marketplace/categories');
    expect(res.status).toBe(200);
    const electronics = res.body.find((c: { slug: string }) => c.slug === 'electronics');
    expect(electronics).toBeTruthy();
    expect(Array.isArray(electronics.children)).toBe(true);
    expect(electronics.children.some((c: { slug: string }) => c.slug === 'phones-tablets')).toBe(true);
  });
});

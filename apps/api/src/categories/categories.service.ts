import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { slugify } from '@bmpl/shared';
import type { CreateCategoryInput, UpdateCategoryInput } from '@bmpl/validation';
import type { Category } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface ActorContext {
  userId: string;
  ipAddress?: string | null;
  sessionId?: string | null;
}

/** Public-facing category node (nested; hidden categories + their subtrees omitted). */
export interface PublicCategoryNode {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  iconName: string | null;
  imageKey: string | null;
  featured: boolean;
  sortOrder: number;
  children: PublicCategoryNode[];
}

/** Admin row: the full record plus a child count (to guard deletes in the UI). */
export interface AdminCategoryRow extends Category {
  childCount: number;
}

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  /** Visible categories as a nested tree. A hidden parent hides its whole subtree. */
  async publicTree(): Promise<PublicCategoryNode[]> {
    const rows = await this.prisma.category.findMany({
      where: { isVisible: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    const byId = new Map<string, PublicCategoryNode>();
    for (const c of rows) {
      byId.set(c.id, {
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        iconName: c.iconName,
        imageKey: c.imageKey,
        featured: c.featured,
        sortOrder: c.sortOrder,
        children: [],
      });
    }

    const roots: PublicCategoryNode[] = [];
    for (const c of rows) {
      const node = byId.get(c.id)!;
      if (c.parentId === null) {
        roots.push(node);
      } else {
        const parent = byId.get(c.parentId);
        // Parent not in the visible set => it (and thus this node) is hidden. Drop.
        if (parent) parent.children.push(node);
      }
    }
    return roots;
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  /** Every category (visible or not) as a flat, ordered list with child counts. */
  async adminList(): Promise<AdminCategoryRow[]> {
    const rows = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { children: true } } },
    });
    return rows.map(({ _count, ...c }) => ({ ...c, childCount: _count.children }));
  }

  async create(actor: ActorContext, dto: CreateCategoryInput): Promise<Category> {
    if (dto.parentId) await this.getOrThrow(dto.parentId, 'Parent category');

    const slug = dto.slug
      ? await this.assertSlugFree(dto.slug)
      : await this.deriveUniqueSlug(dto.name);

    const category = await this.prisma.category.create({
      data: {
        name: dto.name,
        slug,
        description: dto.description ?? null,
        iconName: dto.iconName ?? null,
        imageKey: dto.imageKey ?? null,
        featured: dto.featured,
        isVisible: dto.isVisible,
        sortOrder: dto.sortOrder,
        parentId: dto.parentId ?? null,
      },
    });

    await this.audit.record({
      action: 'CATEGORY_CREATED',
      actorId: actor.userId,
      ipAddress: actor.ipAddress ?? null,
      sessionId: actor.sessionId ?? null,
      newValue: { id: category.id, name: category.name, slug: category.slug },
    });
    return category;
  }

  async update(actor: ActorContext, id: string, dto: UpdateCategoryInput): Promise<Category> {
    const existing = await this.getOrThrow(id, 'Category');

    if (dto.parentId !== undefined && dto.parentId !== null) {
      if (dto.parentId === id) throw new BadRequestException('A category cannot be its own parent.');
      await this.getOrThrow(dto.parentId, 'Parent category');
      if (await this.wouldCreateCycle(id, dto.parentId)) {
        throw new BadRequestException('That parent would create a category cycle.');
      }
    }

    let slug = existing.slug;
    if (dto.slug !== undefined && dto.slug !== existing.slug) {
      slug = await this.assertSlugFree(dto.slug, id);
    }

    const updated = await this.prisma.category.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        slug,
        description: dto.description === undefined ? undefined : dto.description,
        iconName: dto.iconName === undefined ? undefined : dto.iconName,
        imageKey: dto.imageKey === undefined ? undefined : dto.imageKey,
        featured: dto.featured ?? undefined,
        isVisible: dto.isVisible ?? undefined,
        sortOrder: dto.sortOrder ?? undefined,
        parentId: dto.parentId === undefined ? undefined : dto.parentId,
      },
    });

    await this.audit.record({
      action: 'CATEGORY_UPDATED',
      actorId: actor.userId,
      ipAddress: actor.ipAddress ?? null,
      sessionId: actor.sessionId ?? null,
      previousValue: { name: existing.name, slug: existing.slug, parentId: existing.parentId },
      newValue: { name: updated.name, slug: updated.slug, parentId: updated.parentId },
    });
    return updated;
  }

  async remove(actor: ActorContext, id: string): Promise<{ id: string }> {
    const existing = await this.getOrThrow(id, 'Category');

    const children = await this.prisma.category.count({ where: { parentId: id } });
    if (children > 0) {
      throw new ConflictException('Move or delete the subcategories first.');
    }

    await this.prisma.category.delete({ where: { id } });

    await this.audit.record({
      action: 'CATEGORY_DELETED',
      actorId: actor.userId,
      ipAddress: actor.ipAddress ?? null,
      sessionId: actor.sessionId ?? null,
      previousValue: { id: existing.id, name: existing.name, slug: existing.slug },
    });
    return { id };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async getOrThrow(id: string, label: string): Promise<Category> {
    const found = await this.prisma.category.findUnique({ where: { id } });
    if (!found) throw new NotFoundException(`${label} not found.`);
    return found;
  }

  /** Throws if `slug` is taken by a different category; returns it otherwise. */
  private async assertSlugFree(slug: string, excludeId?: string): Promise<string> {
    const existing = await this.prisma.category.findUnique({ where: { slug } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`The slug "${slug}" is already in use.`);
    }
    return slug;
  }

  /** Derive a slug from a name, appending -2, -3, ... on collision. */
  private async deriveUniqueSlug(name: string): Promise<string> {
    const root = slugify(name) || 'category';
    let candidate = root;
    let n = 1;
    // Bounded loop: at worst walks existing collisions.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const existing = await this.prisma.category.findUnique({ where: { slug: candidate } });
      if (!existing) return candidate;
      n += 1;
      candidate = `${root}-${n}`;
    }
  }

  /** True if setting `newParentId` as parent of `id` would create a cycle. */
  private async wouldCreateCycle(id: string, newParentId: string): Promise<boolean> {
    let cursor: string | null = newParentId;
    while (cursor) {
      if (cursor === id) return true;
      const parent: { parentId: string | null } | null = await this.prisma.category.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = parent?.parentId ?? null;
    }
    return false;
  }
}

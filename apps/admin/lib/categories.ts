export interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  iconName: string | null;
  imageKey: string | null;
  featured: boolean;
  isVisible: boolean;
  sortOrder: number;
  parentId: string | null;
  childCount: number;
}

/** Flatten the category forest into display order with a depth for indentation. */
export function orderCategories(cats: AdminCategory[]): Array<{ cat: AdminCategory; depth: number }> {
  const byParent = new Map<string | null, AdminCategory[]>();
  for (const c of cats) {
    const list = byParent.get(c.parentId) ?? [];
    list.push(c);
    byParent.set(c.parentId, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }
  const out: Array<{ cat: AdminCategory; depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const c of byParent.get(parentId) ?? []) {
      out.push({ cat: c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

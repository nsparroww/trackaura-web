/* ─────────────────────────────────────────────────────────────────────
   entity-config.ts

   Single source of truth for entity-type routing. Adding a new vertical
   = add one entry here + write a 6-line route file under src/app/.

   This module is import-safe in both server and client code — no
   Supabase client deps, no next/headers. Brand-prefix lists come from
   chip-slug-helpers.ts (the existing v0 source of truth) for now.

   Conventions (Architecture Bible §3, §7):
     - entity_type rows in canonical_entities are: 'gpu_chip', 'gpus' today.
     - Tree traversal via parent_entity_id (bottom-up).
     - childEntityType = null  → leaf (own listings, no children section)
     - childEntityType = 'foo' → branch (children of that type, no own listings)
     - Brand prefixes apply only to slug-form normalization for clean URLs.
       Boards/CPUs have no brand prefix to strip — URL = DB slug.
   ───────────────────────────────────────────────────────────────────── */

import { BRAND_PREFIXES as GPU_CHIP_BRAND_PREFIXES } from './chip-slug-helpers';

/** All entity_type values currently registered. Expand as verticals come online. */
export type EntityType = 'gpu_chip' | 'gpus';

/** All category slugs (drive /c/[slug] and category breadcrumbs). */
export type CategorySlug = 'gpus';

export type EntityTypeConfig = {
  /** URL prefix for entity detail pages, e.g. '/chip', '/board', '/cpu'. */
  routePrefix: string;
  /** Singular human label for breadcrumbs / metadata fallbacks. */
  label: string;
  /** entity_type of children, or null if this entity is a leaf. */
  childEntityType: EntityType | null;
  /** entity_type of parent, or null if top-of-tree. */
  parentEntityType: EntityType | null;
  /** Top-level category this entity rolls up to. */
  category: CategorySlug;
  /** Brand prefixes stripped from slug for clean URLs. Empty = no stripping. */
  cleanSlugBrandPrefixes: readonly string[];
};

export const ENTITY_TYPES: Record<EntityType, EntityTypeConfig> = {
  gpu_chip: {
    routePrefix: '/chip',
    label: 'Graphics Card',
    childEntityType: 'gpus',
    parentEntityType: null,
    category: 'gpus',
    cleanSlugBrandPrefixes: GPU_CHIP_BRAND_PREFIXES,
  },
  gpus: {
    routePrefix: '/board',
    label: 'GPU Board',
    childEntityType: null,
    parentEntityType: 'gpu_chip',
    category: 'gpus',
    cleanSlugBrandPrefixes: [],
  },
};

export type CategoryConfig = {
  /** Plural label for category breadcrumb (e.g. 'Graphics Cards'). */
  label: string;
  /** Top entity_type of the tree under this category. */
  topEntityType: EntityType;
};

export const CATEGORIES: Record<CategorySlug, CategoryConfig> = {
  gpus: { label: 'Graphics Cards', topEntityType: 'gpu_chip' },
};

/** Type guard for narrowing arbitrary strings (e.g. DB column reads). */
export function isRegisteredEntityType(t: string): t is EntityType {
  return Object.prototype.hasOwnProperty.call(ENTITY_TYPES, t);
}

/** Lookup with explicit error. Use when caller has already validated. */
export function getEntityTypeConfig(t: EntityType): EntityTypeConfig {
  const cfg = ENTITY_TYPES[t];
  if (!cfg) throw new Error(`Unregistered entity_type: ${t}`);
  return cfg;
}

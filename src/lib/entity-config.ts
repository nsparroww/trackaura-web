/* ─────────────────────────────────────────────────────────────────────────────
   entity-config.ts

   Single source of truth for entity-type routing. Adding a new vertical
   = add one entry here + write a 6-line route file under src/app/.

   This module is import-safe in both server and client code — no
   Supabase client deps, no next/headers. Brand-prefix lists come from
   chip-slug-helpers.ts (the existing v0 source of truth) for now.

   Conventions (Architecture Bible §3, §7):
     - entity_type rows in canonical_entities are: 'gpu_chip', 'gpus',
       'cpu', 'cpu_microarch' today. ('monitor' exists in DB but no
       frontend route yet — Active queue Item 7.)
     - Tree traversal via parent_entity_id (bottom-up).
     - childEntityType = null  → leaf (own listings, no children section)
     - childEntityType = 'foo' → branch (children of that type, no own listings)
     - Brand prefixes apply only to slug-form normalization for clean URLs.
       Boards / CPUs / microarchs have no brand prefix to strip — URL = DB slug.

   Step-2 additions (2026-05-04):
     - pluralLabel: drives section headings, empty states, stats tile
       labels in EntityPage. Singular `label` was insufficient — "GPU
       Board"/"Boards" need different forms.
     - CategoryConfig.provenance: the trust-statement footer text. Lives
       per-category because catalog source differs by vertical (Phase 1+
       Scryfall, BrickLink, etc). Avoids inlining vertical-specific text
       into the generic EntityPage.

   Phase-0.5 polish addition (2026-05-04):
     - shortSlugAliases: maps user-typed short slugs to canonical clean
       slugs for 308 redirect. Solves the case where DB slug carries a
       disambiguating suffix that natural search queries don't include
       (e.g. /chip/rtx-3060 → /chip/rtx-3060-12-gb). Keeps DB slug
       authoritative; frontend handles the alias.

   Step 4 addition (2026-05-05):
     - 'cpu' entity_type registered. Was 1-level vertical; promoted to
       2-level child of cpu_microarch in 2026-05-11 amendment below.

   2026-05-11 amendment (Phase 3 of microarch migration):
     - 'cpu_microarch' entity_type registered as branch entity above 'cpu'.
       40 microarch entities populated (36 Intel codenames + 4 AMD Zen N
       architectures). cpu.parentEntityType flipped from null → 'cpu_microarch'
       so breadcrumb walks up per Bible §7: Home / Processors /
       Microarchitecture / Item.
     - Parent grain is per-vendor (Bible §5): Intel uses codename,
       AMD uses architecture. Cosmetic only at this layer — slugs
       differ (intel-tiger-lake vs amd-zen-4) but config shape is uniform.
   ───────────────────────────────────────────────────────────────────────── */

import { BRAND_PREFIXES as GPU_CHIP_BRAND_PREFIXES } from './chip-slug-helpers';

/** All entity_type values currently registered. Expand as verticals come online. */
export type EntityType = 'gpu_chip' | 'gpus' | 'cpu' | 'cpu_microarch';

/** All category slugs (drive /c/[slug] and category breadcrumbs). */
export type CategorySlug = 'gpus' | 'cpus';

export type EntityTypeConfig = {
  /** URL prefix for entity detail pages, e.g. '/chip', '/board', '/cpu'. */
  routePrefix: string;
  /** Singular human label for breadcrumbs / metadata fallbacks. */
  label: string;
  /** Plural human label for section headings, empty states, stat tiles. */
  pluralLabel: string;
  /** entity_type of children, or null if this entity is a leaf. */
  childEntityType: EntityType | null;
  /** entity_type of parent, or null if top-of-tree. */
  parentEntityType: EntityType | null;
  /** Top-level category this entity rolls up to. */
  category: CategorySlug;
  /** Brand prefixes stripped from slug for clean URLs. Empty = no stripping. */
  cleanSlugBrandPrefixes: readonly string[];
  /** Short-slug aliases that 308 to a canonical clean slug. Optional;
      omit when no aliases are needed. Map keys are user-typed slugs;
      values are the canonical clean slugs to redirect to. The resolver
      will re-resolve the target slug to find its entity_id, so values
      must themselves resolve via either exact-match or brand-prefix
      fallback. */
  shortSlugAliases?: Readonly<Record<string, string>>;
};

export const ENTITY_TYPES: Record<EntityType, EntityTypeConfig> = {
  gpu_chip: {
    routePrefix: '/chip',
    label: 'Graphics Card',
    pluralLabel: 'Graphics Cards',
    childEntityType: 'gpus',
    parentEntityType: null,
    category: 'gpus',
    cleanSlugBrandPrefixes: GPU_CHIP_BRAND_PREFIXES,
    shortSlugAliases: {
      // High-traffic short queries that don't map 1:1 to DB slugs.
      // 'rtx-3060' → DB row nvidia-geforce-rtx-3060-12-gb (clean form
      // rtx-3060-12-gb) — canonical RTX 3060 is 12 GB; DB slug carries
      // the suffix to disambiguate from the rare 8 GB GA104 variant
      // (canonical_entities id 18522).
      'rtx-3060': 'rtx-3060-12-gb',
    },
  },
  gpus: {
    routePrefix: '/board',
    label: 'GPU Board',
    pluralLabel: 'Boards',
    childEntityType: null,
    parentEntityType: 'gpu_chip',
    category: 'gpus',
    cleanSlugBrandPrefixes: [],
  },
  cpu_microarch: {
    routePrefix: '/cpu-microarch',
    label: 'Microarchitecture',
    pluralLabel: 'Microarchitectures',
    childEntityType: 'cpu',
    parentEntityType: null,
    category: 'cpus',
    cleanSlugBrandPrefixes: [],
  },
  cpu: {
    routePrefix: '/cpu',
    label: 'CPU',
    pluralLabel: 'CPUs',
    childEntityType: null,
    parentEntityType: 'cpu_microarch',
    category: 'cpus',
    cleanSlugBrandPrefixes: [],
  },
};

export type CategoryConfig = {
  /** Plural label for category breadcrumb (e.g. 'Graphics Cards'). */
  label: string;
  /** Top entity_type of the tree under this category. */
  topEntityType: EntityType;
  /** Provenance line for the entity-page footer. Per-category since
      catalog source differs by vertical. */
  provenance: string;
};

export const CATEGORIES: Record<CategorySlug, CategoryConfig> = {
  gpus: {
    label: 'Graphics Cards',
    topEntityType: 'gpu_chip',
    provenance:
      'Catalog data from TechPowerUp (vendored). Prices observed from Canadian retailers and refreshed daily. Current price = most recent observation per listing within the last 7 days.',
  },
  cpus: {
    label: 'CPUs',
    topEntityType: 'cpu_microarch',
    provenance:
      'Catalog data from Intel ARK and AMD spec pages. Microarchitecture context from Wikipedia (CC BY-SA 4.0). Prices observed from Canadian retailers and refreshed daily. Current price = most recent observation per listing within the last 7 days.',
  },
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

/* ───────────────────────────────────────────────────────────────────────────
   entity-config.ts

   Single source of truth for entity-type routing. Adding a new vertical
   = add one entry here + write a 6-line route file under src/app/.

   This module is import-safe in both server and client code — no
   Supabase client deps, no next/headers. Brand-prefix lists come from
   chip-slug-helpers.ts (the existing v0 source of truth) for now.

   Conventions (Architecture Bible §3, §7):
     - entity_type rows in canonical_entities are: 'gpu_chip', 'gpus',
       'cpu' today.
     - Tree traversal via parent_entity_id (bottom-up).
     - childEntityType = null  → leaf (own listings, no children section)
     - childEntityType = 'foo' → branch (children of that type, no own listings)
     - Brand prefixes apply only to slug-form normalization for clean URLs.
       Boards / CPUs have no brand prefix to strip — URL = DB slug.

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
     - 'cpu' entity_type registered. 1-level vertical (no parent, no
       children) per ARCHITECTURE.md §7 table. URL = DB slug; no brand
       prefixes registered yet — the dbgpu-style duplicated-prefix
       pattern that affects GPUs may not appear in CPU naming. Audit
       slug shape after Item 4 (catalog ingest) lands and add prefixes
       only if the data calls for it.
   ─────────────────────────────────────────────────────────────────────────── */

import { BRAND_PREFIXES as GPU_CHIP_BRAND_PREFIXES } from './chip-slug-helpers';

/** All entity_type values currently registered. Expand as verticals come online. */
export type EntityType = 'gpu_chip' | 'gpus' | 'cpu';

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
  cpu: {
    routePrefix: '/cpu',
    label: 'CPU',
    pluralLabel: 'CPUs',
    childEntityType: null,
    parentEntityType: null,
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
    topEntityType: 'cpu',
    // TODO(Item 4): replace with catalog-source-specific provenance once
    // CPU catalog source is chosen (Intel ARK / dbgpu CPU / Wikidata).
    // Until catalog ingest lands, this footer doesn't render anywhere
    // because entity_type='cpu' has zero rows.
    provenance:
      'Prices observed from Canadian retailers and refreshed daily. Current price = most recent observation per listing within the last 7 days.',
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

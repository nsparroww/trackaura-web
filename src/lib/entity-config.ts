/* -------------------------------------------------------------------------
   entity-config.ts

   Single source of truth for entity-type routing. Adding a new vertical
   = add one entry here + write a 6-line route file under src/app/.

   This module is import-safe in both server and client code -- no
   Supabase client deps, no next/headers. Brand-prefix lists come from
   chip-slug-helpers.ts (the existing v0 source of truth) for now.

   Conventions (Architecture Bible Section 3, Section 7):
     - entity_type rows in canonical_entities are: 'gpu_chip', 'gpus',
       'cpu', 'cpu_microarch', 'gpu_microarch', 'monitor', 'lego_set',
       'lego_theme' today.
     - Tree traversal via parent_entity_id (bottom-up).
     - childEntityType = null  -> leaf (own listings, no children section)
     - childEntityType = 'foo' -> branch (children of that type, no own listings)
     - Brand prefixes apply only to slug-form normalization for clean URLs.
       Boards have no brand prefix to strip -- URL = DB slug.

   Step-2 additions (2026-05-04):
     - pluralLabel: drives section headings, empty states, stats tile
       labels in EntityPage. Singular `label` was insufficient -- "GPU
       Board"/"Boards" need different forms.
     - CategoryConfig.provenance: the trust-statement footer text. Lives
       per-category because catalog source differs by vertical (Phase 1+
       Scryfall, BrickLink, etc). Avoids inlining vertical-specific text
       into the generic EntityPage.

   Phase-0.5 polish addition (2026-05-04):
     - shortSlugAliases: maps user-typed short slugs to canonical clean
       slugs for 308 redirect. Solves the case where DB slug carries a
       disambiguating suffix that natural search queries don't include
       (e.g. /chip/rtx-3060 -> /chip/rtx-3060-12-gb). Keeps DB slug
       authoritative; frontend handles the alias.

   Step 4 addition (2026-05-05):
     - 'cpu' entity_type registered. Was 1-level vertical; promoted to
       2-level child of cpu_microarch in 2026-05-11 amendment below.

   2026-05-11 amendment (Phase 3 of microarch migration):
     - 'cpu_microarch' entity_type registered as branch entity above 'cpu'.
       40 microarch entities populated (36 Intel codenames + 4 AMD Zen N
       architectures). cpu.parentEntityType flipped from null -> 'cpu_microarch'
       so breadcrumb walks up per Bible Section 7: Home / Processors /
       Microarchitecture / Item.
     - Parent grain is per-vendor (Bible Section 5): Intel uses codename,
       AMD uses architecture. Cosmetic only at this layer -- slugs
       differ (intel-tiger-lake vs amd-zen-4) but config shape is uniform.

   2026-05-11 amendment (CPU page coverage probe; Active queue Item 1):
     - 'cpu' registered with cleanSlugBrandPrefixes ['intel-', 'amd-'].
       Canonical URL form is now brand-stripped, mirroring GPU pattern:
       /cpu/i7-8700k, /cpu/ryzen-7-7800x3d, /cpu/core-ultra-265k.
       Legacy /cpu/intel-* and /cpu/amd-* URLs 308 to brand-stripped form.
     - slugRewrites field added to EntityTypeConfig for marketing-form to
       canonical-form equivalences that don't fit prefix-prepend semantics.
       Two CPU rewrite families:
         (a) Core i-series: 'intel-core-i{3,5,7,9}-*' -> 'intel-i*' (DB form).
             Intel markets as "Core i7-8700K"; DB drops the 'core-' segment.
         (b) Core Ultra: 'intel-core-ultra-{3,5,7,9}-*' -> 'intel-core-ultra-*'.
             Intel markets as "Core Ultra 7 265K"; DB drops the tier digit.
       Scope is narrow on purpose -- intel-core-N* (no -i / no Ultra-tier)
       matches exact and doesn't need rewrite.
     - 'cpu_microarch' gains cleanSlugBrandPrefixes ['intel-', 'amd-'].
       All 40 microarch slugs in DB are brand-prefixed; without this,
       bare-form queries like /cpu-microarch/coffee-lake 404'd.
       Canonical URLs: /cpu-microarch/coffee-lake, /cpu-microarch/zen-4.

   2026-05-19 amendment (monitor vertical wiring; Active queue Item 7):
     - 'monitor' entity_type registered as a 1-level leaf vertical
       (no parent, no children) -- Home / Monitors / Item.
     - Catalog fed by the LG ingest (462 rows, 2026-05-11) and the ASUS
       ingest (296 rows, 2026-05-18). All monitor slugs in DB are
       brand-prefixed (lg-*, asus-*), so cleanSlugBrandPrefixes is
       ['lg-', 'asus-']; canonical URLs are brand-stripped
       (/monitor/27gl850-b, /monitor/va27dqsby) and legacy brand-prefixed
       URLs 308 to that form -- same pattern as GPU chips.
     - 'monitors' CategorySlug + CATEGORIES entry added. The /c/monitors
       alias in category-entity-map.ts ships separately, after the
       /monitor/[slug] route verifies (Bible Protocol #35).

   2026-05-25 amendment (gpu_microarch registration; ROADMAP encyclopedic
   table item):
     - 'gpu_microarch' entity_type registered as branch entity above
       'gpu_chip'. 57 microarch entities live: 19 NVIDIA architectures
       (Ada Lovelace, Ampere, Blackwell, ...), 19 AMD architectures
       (CDNA, GCN, RDNA, Terascale, VLIW), 19 Intel (Generation, Knights,
       PowerVR, Xe variants).
     - gpu_chip.parentEntityType flipped from null -> 'gpu_microarch'
       so breadcrumb walks up per Bible Section 7 cpu precedent.
       Breadcrumb becomes Home / Graphics Cards / Microarchitecture /
       Chip / Board on board pages (Bible Section 7 GPU row reads "2
       levels" today; that's the doc-vs-code drift to address separately).
     - cleanSlugBrandPrefixes ['nvidia-', 'amd-', 'intel-']; all 57
       slugs in DB are brand-prefixed. Canonical URLs: /gpu-microarch/
       ada-lovelace, /gpu-microarch/rdna-3-0, /gpu-microarch/xe-lpg.
     - Closes the session 23 smoke log warning:
       "[entity] breadcrumb walk hit unregistered entity_type='gpu_microarch'".
   ------------------------------------------------------------------------- */

import { BRAND_PREFIXES as GPU_CHIP_BRAND_PREFIXES } from './chip-slug-helpers';

/** All entity_type values currently registered. Expand as verticals come online. */
export type EntityType =
  | 'gpu_chip'
  | 'gpus'
  | 'gpu_microarch'
  | 'cpu'
  | 'cpu_microarch'
  | 'monitor'
  | 'lego_set'
  | 'lego_theme'
  | 'motherboard'
  | 'ram_kit';

/** All category slugs (drive /c/[slug] and category breadcrumbs). */
export type CategorySlug = 'gpus' | 'cpus' | 'monitors' | 'lego-sets' | 'motherboards' | 'ram';

/** Regex-driven slug-form rewrite. Use for marketing-form to canonical-form
    equivalences that don't fit prefix-prepend semantics. Pattern is matched
    against the requested slug; on match, slug.replace(pattern, replacement)
    becomes the lookup key. First matching rewrite wins; resolver falls back
    to prefix-prepend if rewrite finds no DB row. */
export type SlugRewrite = {
  pattern: RegExp;
  replacement: string;
};

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
  /** When true, this entity type â€” shown as a child in its parent's grid
      (EntityChildren) â€” falls back to the parent's image when it has no
      own image_primary_url. Set for entity types whose siblings share the
      parent's appearance (CPUs: one physical package per microarch). Left
      unset for visually-distinct children (GPU boards differ AIB-to-AIB,
      so they must not borrow the chip's image). */
  gridImageInheritsParent?: boolean;
  /** Regex-driven rewrites for marketing-form to canonical-form lookups.
      Tried after exact-match + alias, before brand-prefix prepend. First
      rewrite whose pattern matches AND whose rewritten slug hits a DB row
      wins; resolver computes finalClean (via cleanSlugBrandPrefixes) before
      returning so the redirect chain is single-hop. Optional. */
  slugRewrites?: readonly SlugRewrite[];
};

export const ENTITY_TYPES: Record<EntityType, EntityTypeConfig> = {
  gpu_microarch: {
    routePrefix: '/gpu-microarch',
    label: 'GPU Microarchitecture',
    pluralLabel: 'GPU Microarchitectures',
    childEntityType: 'gpu_chip',
    parentEntityType: null,
    category: 'gpus',
    // All 57 gpu_microarch slugs are brand-prefixed (nvidia-, amd-, intel-).
    // Canonical URLs are brand-stripped: /gpu-microarch/ada-lovelace,
    // /gpu-microarch/rdna-3-0, /gpu-microarch/xe-lpg.
    cleanSlugBrandPrefixes: ['nvidia-', 'amd-', 'intel-'],
  },
  gpu_chip: {
    routePrefix: '/chip',
    label: 'Graphics Card',
    pluralLabel: 'Graphics Cards',
    childEntityType: 'gpus',
    // Flipped null -> 'gpu_microarch' 2026-05-25. DB already carries
    // parent_entity_id pointers from chips to microarchs; this aligns
    // config with that data so breadcrumb walks gain the microarch tier.
    parentEntityType: 'gpu_microarch',
    category: 'gpus',
    cleanSlugBrandPrefixes: GPU_CHIP_BRAND_PREFIXES,
    shortSlugAliases: {
      // High-traffic short queries that don't map 1:1 to DB slugs.
      // 'rtx-3060' -> DB row nvidia-geforce-rtx-3060-12-gb (clean form
      // rtx-3060-12-gb) -- canonical RTX 3060 is 12 GB; DB slug carries
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
    cleanSlugBrandPrefixes: ['intel-', 'amd-'],
  },
  cpu: {
    routePrefix: '/cpu',
    label: 'CPU',
    pluralLabel: 'CPUs',
    childEntityType: null,
    parentEntityType: 'cpu_microarch',
    category: 'cpus',
    cleanSlugBrandPrefixes: ['intel-', 'amd-'],
    /* CPUs under one microarchitecture are the same physical package â€”
       the microarch image is the honest hero image. Drives the
       parent-image fallback in entity.ts fetchChildren. */
    gridImageInheritsParent: true,
    slugRewrites: [
      // (a) Core i-series. Intel markets as "Intel Core i7-8700K"
      // everywhere (Wikipedia, retailer pages, natural Googling). DB
      // stores canonical short form 'intel-i7-8700k' without 'core-'.
      // Covers i3 / i5 / i7 / i9.
      { pattern: /^intel-core-(i[3579]-)/, replacement: 'intel-$1' },
      // Same shape without the brand prefix.
      { pattern: /^core-(i[3579]-)/, replacement: 'intel-$1' },

      // (b) Core Ultra. Intel markets as "Intel Core Ultra 7 265K";
      // DB drops the tier digit to 'intel-core-ultra-265k'. Covers
      // Ultra 3 / 5 / 7 / 9.
      { pattern: /^intel-core-ultra-[3579]-/, replacement: 'intel-core-ultra-' },
      // Bare form: '/cpu/core-ultra-7-265k' -> 'intel-core-ultra-265k'.
      // finalClean strips brand prefix for /cpu/core-ultra-265k redirect.
      { pattern: /^core-ultra-[3579]-/, replacement: 'intel-core-ultra-' },
    ],
  },
  monitor: {
    routePrefix: '/monitor',
    label: 'Monitor',
    pluralLabel: 'Monitors',
    childEntityType: null,
    parentEntityType: null,
    category: 'monitors',
    // All monitor slugs in DB are brand-prefixed (lg-*, asus-*).
    // Canonical URL is brand-stripped: /monitor/27gl850-b,
    // /monitor/va27dqsby. Legacy /monitor/lg-* and /monitor/asus-*
    // 308 to that form -- mirrors the GPU-chip pattern.
    cleanSlugBrandPrefixes: ['lg-', 'asus-'],
  },
  /* 2026-05-30 amendment (motherboard vertical wiring; VERTICALBACKLOG #3):
     - 'motherboard' = 1-level leaf vertical (no parent, no children) --
       Home / Motherboards / Item. Catalog seeded from existing retailer
       scrapes (1,466 boards), not a new catalog source -- provenance is
       the listings table, same as GPU boards (Bible Section 5).
     - cleanSlugBrandPrefixes [] -- committed DB slugs are double-brand-
       prefixed (msi-msi-..., asus-asus-...) because raw titles lead with
       the brand; URL = DB slug, GPU-board precedent. Clean-slug is
       Phase-0.5 polish, not a vertical blocker.
     - socket is the price-defining attribute and the CPU-relationship
       axis; chipset/form_factor are display attributes. */
  motherboard: {
    routePrefix: '/motherboard',
    label: 'Motherboard',
    pluralLabel: 'Motherboards',
    childEntityType: null,
    parentEntityType: null,
    category: 'motherboards',
    cleanSlugBrandPrefixes: [],
  },
  /* 2026-05-30 amendment (RAM vertical wiring; VERTICALBACKLOG #4):
     - 'ram_kit' = 1-level leaf vertical (no parent, no children) --
       Home / Memory / Item. Catalog seeded from existing retailer scrapes
       (1,746 kits), not a new catalog source -- provenance is the listings
       table, same as GPU boards and motherboards (Bible Section 5).
     - cleanSlugBrandPrefixes [] -- RAM slugs lead with brand by design
       (corsair-vengeance-lpx-32gb-..., kingston-fury-beast-...); the brand
       is load-bearing for disambiguation (vengeance-lpx alone is ambiguous
       across makers). URL = DB slug, motherboard/GPU-board precedent.
     - ddr_gen / speed / form_factor are price-defining; capacity / config /
       cas_latency / mpn are display attributes. */
  ram_kit: {
    routePrefix: '/ram',
    label: 'Memory Kit',
    pluralLabel: 'Memory',
    childEntityType: null,
    parentEntityType: null,
    category: 'ram',
    cleanSlugBrandPrefixes: [],
  },
  /* 2026-05-19 amendment (Phase 1 LEGO collectibles vertical):
     - 'lego_theme' = branch entity, parents 'lego_set' (and other
       lego_themes via parent_entity_id self-reference). Three-level
       tree shapes exist in the data (e.g., Star Wars > UCS >
       Millennium Falcon); EntityPage breadcrumb walk handles depth
       natively. cleanSlugBrandPrefixes empty -- theme slugs are
       'theme-<id>-<name>' by construction; no brand prefix to strip.
     - 'lego_set' = leaf. parentEntityType 'lego_theme'. No brand
       prefix to strip (set slugs are '<name>-<set_num>' where set_num
       is universal across all LEGO catalogs -- BrickLink, Brickset,
       Rebrickable). gridImageInheritsParent NOT set -- every LEGO set
       has its own hero image (100% coverage from Rebrickable). */
  lego_theme: {
    routePrefix: '/theme',
    label: 'LEGO Theme',
    pluralLabel: 'LEGO Themes',
    childEntityType: 'lego_set',
    parentEntityType: null, // can also point to another lego_theme via parent_entity_id (3-level tree)
    category: 'lego-sets',
    cleanSlugBrandPrefixes: [],
  },
  lego_set: {
    routePrefix: '/set',
    label: 'LEGO Set',
    pluralLabel: 'LEGO Sets',
    childEntityType: null,
    parentEntityType: 'lego_theme',
    category: 'lego-sets',
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
    // topEntityType stays 'gpu_chip' even though gpu_microarch is now
    // registered as the true tree root. Changing this would rewire what
    // /c/gpus renders (chips today; microarchs if flipped) and is a UX
    // change outside this ticket. Flip later if a microarch-first browse
    // experience is genuinely wanted.
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
  monitors: {
    label: 'Monitors',
    topEntityType: 'monitor',
    provenance:
      'Catalog data from LG and ASUS manufacturer specification pages. Prices observed from Canadian retailers and refreshed daily. Current price = most recent observation per listing within the last 7 days.',
  },
  motherboards: {
    label: 'Motherboards',
    topEntityType: 'motherboard',
    provenance:
      'Catalog normalized from Canadian retailer listings. Prices observed from Canadian retailers and refreshed daily. Current price = most recent observation per listing within the last 7 days.',
  },
  ram: {
    label: 'Memory',
    topEntityType: 'ram_kit',
    provenance:
      'Catalog normalized from Canadian retailer listings. Prices observed from Canadian retailers and refreshed daily. Current price = most recent observation per listing within the last 7 days.',
  },
  'lego-sets': {
    label: 'LEGO Sets',
    topEntityType: 'lego_theme',
    provenance:
      'Catalog data from Rebrickable (rebrickable.com, freely licensed for any purpose, refreshed daily). Prices observed from Canadian retailers including LEGO.com Canada and refreshed daily. Current price = most recent observation per listing within the last 7 days.',
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

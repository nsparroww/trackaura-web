// src/lib/category-entity-map.ts
//
// Maps top-level category slugs (e.g. the URL /c/graphics-cards) to the
// canonical_entities entity_type for that vertical, plus the route prefix
// for individual entity pages.
//
// Two consumers, two different needs:
//
//   1. /c/[slug] landing page (getCategoryEntityConfig -> page.tsx).
//      Browses a category as a card grid. For a 2-level vertical the
//      landing should list the PARENT tier - the browsable index - not
//      the leaf SKUs. CPUs lists processor architectures; you drill into
//      one to reach its CPUs (mirrors GPUs, where the landing lists chips
//      and you drill in to reach boards). The optional browseEntityType /
//      browseRoutePrefix fields express that override.
//
//   2. Homepage (home.ts). getMigratedEntityTypeCounts drives the category
//      TILE COUNTS; getHomeFeaturedEntities drives the "lowest tracked
//      prices" section. Both iterate CATEGORY_ENTITY_MAP directly and read
//      entityType / routePrefix. They want the LEAF type: the tile count
//      is "how many CPUs" (873, not 40 architectures), and the featured
//      section needs priced rows - architecture rows carry no price, only
//      leaf CPUs do.
//
// So entityType / routePrefix stay the LEAF/canonical type and the homepage
// uses them unchanged. browseEntityType / browseRoutePrefix are the
// /c/[slug]-only override; getCategoryEntityConfig resolves them, home.ts
// deliberately does not. GPUs need no override - gpu_chip is both the
// browsable tier and the priced/counted tier (the RPC rolls board prices
// up to the chip).
//
// When a category slug is in this map, /c/[slug] reads from
// canonical_entities (new schema) via the get_category_entities_aggregated
// RPC. When a slug is NOT in this map, /c/[slug] falls back to the
// canonical_products v0 read path via getCategoryViewModel.
//
// Activation discipline (Bible Protocol #35):
// Add an entry HERE only after BOTH gates are clear:
//   (a) canonical_entities has rows of the target entity_type, AND
//   (b) a per-entity-type route file (/foo/[slug]/page.tsx) exists.
// This applies to browseEntityType too: the browse tier needs its own
// catalog rows and its own route file (landing cards link into it).
// Activating before (a) creates a homepage fed-status lie; before (b)
// makes card links 404.
//
// History:
// - 2026-05-05: 'cpus' / 'processors' added prematurely as part of CPU
//   route abstraction. canonical_entities had zero entity_type='cpu'
//   rows. ROLLED BACK same day.
// - 2026-05-11: 'cpus' / 'processors' re-activated (entityType 'cpu').
//   CPU catalog populated 2026-05-09 (Intel ARK) + 2026-05-10 (AMD),
//   873 rows; /cpu/[slug] route exists. Both Protocol #35 gates met.
// - 2026-05-11: LG monitor catalog ingested (462 rows). Gate (a) met,
//   gate (b) not - /monitor/[slug] route file pending. Deferred.
// - 2026-05-17: 'cpus' / 'processors' gain browseEntityType
//   'cpu_microarch'. The /c/ landing now lists processor architectures
//   (the 2-level parent tier) instead of 873 flat CPUs, matching the GPU
//   landing. entityType stays 'cpu' so the homepage tile count (873) and
//   the featured section (priced CPU leaves) are unaffected. Both
//   Protocol #35 gates hold for cpu_microarch: 40 rows exist and the
//   /cpu-microarch/[slug] route is live.

export type CategoryEntityMapEntry = {
  /** Leaf / canonical entity_type for the vertical. The homepage reads
      this directly (tile counts + featured section). */
  entityType: string;
  /** Route prefix for the leaf entity pages (e.g. '/cpu', '/chip'). */
  routePrefix: string;
  /** Optional override: the entity_type the /c/[slug] landing page should
      list instead of `entityType`. Set on 2-level verticals whose landing
      should be the parent-tier index. Omit when the landing lists the leaf
      tier directly (e.g. GPUs, where gpu_chip is both tiers). */
  browseEntityType?: string;
  /** Route prefix for the browse-tier entity pages. Required whenever
      browseEntityType is set - landing cards link here. */
  browseRoutePrefix?: string;
};

/** Resolved entity_type + route prefix the /c/[slug] landing browses. */
export type ResolvedCategoryEntity = {
  entityType: string;
  routePrefix: string;
};

export const CATEGORY_ENTITY_MAP: Record<string, CategoryEntityMapEntry> = {
  // GPU chips (Phase 0, fed 2026-05-05). gpu_chip is both the browse tier
  // and the priced/counted tier - no browse override needed.
  'graphics-cards': { entityType: 'gpu_chip', routePrefix: '/chip' },
  'gpus':           { entityType: 'gpu_chip', routePrefix: '/chip' },
  'video-cards':    { entityType: 'gpu_chip', routePrefix: '/chip' },

  // CPUs (Phase 0, 2-level). Leaf = 'cpu' - the homepage counts and
  // features it. The /c/ landing browses 'cpu_microarch', the
  // architecture index.
  'cpus': {
    entityType: 'cpu',
    routePrefix: '/cpu',
    browseEntityType: 'cpu_microarch',
    browseRoutePrefix: '/cpu-microarch',
  },
  'processors': {
    entityType: 'cpu',
    routePrefix: '/cpu',
    browseEntityType: 'cpu_microarch',
    browseRoutePrefix: '/cpu-microarch',
  },

  // Monitor: 1-level leaf vertical, no parent tier -- no browseEntityType
  // override (the landing lists the monitor leaves directly).
  'monitors': {
    entityType: 'monitor',
    routePrefix: '/monitor',
  },
  'displays': {
    entityType: 'monitor',
    routePrefix: '/monitor',
  },

  // LEGO sets (Phase 1, 2-level). Leaf = 'lego_set' - homepage counts
  // 26,845 sets, featured shows priced sets. The /c/ landing browses
  // 'lego_theme', the 494-theme index (mirrors CPU's microarch landing).
  // Both Protocol #35 gates met 2026-05-19: lego_theme + lego_set rows
  // exist; /set/[slug] and /theme/[slug] routes ship in this commit.
  'lego-sets': {
    entityType: 'lego_set',
    routePrefix: '/set',
    browseEntityType: 'lego_theme',
    browseRoutePrefix: '/theme',
  },
  'lego-themes': {
    entityType: 'lego_set',
    routePrefix: '/set',
    browseEntityType: 'lego_theme',
    browseRoutePrefix: '/theme',
  },
  // Motherboards (Phase 0, 1-level leaf). Catalog ingested s47 (1,466
  // boards), /motherboard/[slug] route live s47, worth/listings linked
  // s48. Both Protocol #35 gates met. No browse override - landing lists
  // the board leaves directly (mirrors monitors).
  'motherboards': {
    entityType: 'motherboard',
    routePrefix: '/motherboard',
  },
  'mobos': {
    entityType: 'motherboard',
    routePrefix: '/motherboard',
  },

﻿  // RAM kits (Phase 0, 1-level leaf). Catalog ingested s50 (1,746 kits),
  // /ram/[slug] route live + prod-verified s51. Both Protocol #35 gates
  // met. No browse override - landing lists the kit leaves directly.
  'ram': {
    entityType: 'ram_kit',
    routePrefix: '/ram',
  },
  'memory': {
    entityType: 'ram_kit',
    routePrefix: '/ram',
  },

  // Future entries go here as verticals migrate. Until then, /c/<slug>
  // for these falls through to the canonical_products v0 read path.
};

/**
 * Resolves the entity_type + route prefix the /c/[slug] landing page should
 * browse. Applies the browseEntityType / browseRoutePrefix override when
 * set, so a 2-level vertical's landing lists the parent tier. Returns null
 * when the slug is not a migrated vertical (the route falls back to the v0
 * canonical_products path in that case).
 *
 * NOTE: home.ts deliberately does NOT call this - it reads entityType /
 * routePrefix off CATEGORY_ENTITY_MAP directly, so the homepage tile
 * counts and featured section keep using the leaf tier.
 */
export function getCategoryEntityConfig(
  categorySlug: string,
): ResolvedCategoryEntity | null {
  const entry = CATEGORY_ENTITY_MAP[categorySlug];
  if (!entry) return null;
  return {
    entityType: entry.browseEntityType ?? entry.entityType,
    routePrefix: entry.browseRoutePrefix ?? entry.routePrefix,
  };
}

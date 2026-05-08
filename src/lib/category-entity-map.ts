// src/lib/category-entity-map.ts
//
// Maps top-level category slugs (e.g., the URL /c/graphics-cards) to the
// canonical_entities entity_type that should be browsed and the route
// prefix for individual entity pages.
//
// When a category slug is in this map, /c/[slug] reads from
// canonical_entities (new schema) via the get_category_entities_aggregated
// RPC and links cards to the entity-specific route. When a slug is NOT in
// this map, /c/[slug] falls back to the canonical_products v0 read path
// via getCategoryViewModel.
//
// Multiple slugs can point at the same vertical (e.g. graphics-cards / gpus
// both route to gpu_chip) so whichever slug the homepage tile uses, the
// catalog is reachable. Unused slugs are dormant; no harm.
//
// Activation discipline (Bible Protocol #35, learned 2026-05-05):
// Add an entry HERE only after canonical_entities has rows of the target
// entity_type. Activating before catalog ingest creates a homepage
// fed-status lie — the tile's accent-green count comes from
// canonical_products v0, but the tile claims those entries live in the
// migrated canonical_entities path. Route files (`/foo/[slug]/page.tsx`)
// can ship ahead of catalog; category aliases must not.
//
// 2026-05-05: 'cpus' / 'processors' added prematurely as part of Step 4
// (CPU route abstraction), then ROLLED BACK same day — canonical_entities
// has zero entity_type='cpu' rows, so the tile was lying. The route file
// /cpu/[slug] stays. Re-add these aliases when Item 3 (CPU sub-vertical
// catalog + scraper) ships and rows actually exist.

export type CategoryEntityMapEntry = {
  /** entity_type value in canonical_entities. */
  entityType: string;
  /** Route prefix for individual entity pages (e.g., '/chip' for chips). */
  routePrefix: string;
};

export const CATEGORY_ENTITY_MAP: Record<string, CategoryEntityMapEntry> = {
  // GPU chips (Phase 0, fed 2026-05-05)
  'graphics-cards': { entityType: 'gpu_chip', routePrefix: '/chip' },
  'gpus':           { entityType: 'gpu_chip', routePrefix: '/chip' },
  'video-cards':    { entityType: 'gpu_chip', routePrefix: '/chip' },

  // Future entries go here as verticals migrate. Until then, /c/<slug>
  // for these falls through to the canonical_products v0 read path.
  // CPUs route abstraction shipped 2026-05-05 but aliases NOT activated
  // until catalog ingest lands (Bible Protocol #35).
  //   'cpus':         { entityType: 'cpu',     routePrefix: '/cpu' },
  //   'processors':   { entityType: 'cpu',     routePrefix: '/cpu' },
  //   'monitors':     { entityType: 'monitor', routePrefix: '/monitor' },
  //   'displays':     { entityType: 'monitor', routePrefix: '/monitor' },
  //   'motherboards': { entityType: 'mobo',    routePrefix: '/mobo' },
};

export function getCategoryEntityConfig(
  categorySlug: string,
): CategoryEntityMapEntry | null {
  return CATEGORY_ENTITY_MAP[categorySlug] ?? null;
}

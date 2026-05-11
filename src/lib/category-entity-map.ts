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
// Activation discipline (Bible Protocol #35):
// Add an entry HERE only after BOTH gates are clear:
//   (a) canonical_entities has rows of the target entity_type, AND
//   (b) a per-entity-type route file (/foo/[slug]/page.tsx) exists.
// Activating before (a) creates a homepage fed-status lie — the tile's
// accent-green count comes from canonical_products v0, but the tile claims
// those entries live in the migrated canonical_entities path. Activating
// before (b) makes card links 404.
//
// History:
// - 2026-05-05: 'cpus' / 'processors' added prematurely as part of CPU
//   route abstraction. Route file shipped, but canonical_entities had zero
//   entity_type='cpu' rows. ROLLED BACK same day.
// - 2026-05-11: 'cpus' / 'processors' re-activated. CPU catalog populated
//   2026-05-09 (Intel ARK, 783 rows) + 2026-05-10 (AMD, 90 rows), 873 total.
//   Retailer linkage shipped 2026-05-10 (commit 9aeeb51). Route file
//   /cpu/[slug] exists. Both Protocol #35 gates satisfied.
// - 2026-05-11: LG monitor catalog ingested (462 rows, entity_type='monitor').
//   Gate (a) satisfied; gate (b) is not — the /monitor/[slug] route file
//   doesn't exist yet. Filed as Phase-0.5 polish; activate 'monitors' /
//   'displays' aliases once the route file ships.

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

  // CPUs (Phase 0, fed 2026-05-09 Intel + 2026-05-10 AMD; route file exists)
  'cpus':           { entityType: 'cpu',      routePrefix: '/cpu' },
  'processors':     { entityType: 'cpu',      routePrefix: '/cpu' },

  // Future entries go here as verticals migrate. Until then, /c/<slug>
  // for these falls through to the canonical_products v0 read path.
  //   'monitors':     { entityType: 'monitor', routePrefix: '/monitor' },  // catalog fed 2026-05-11; route file pending
  //   'displays':     { entityType: 'monitor', routePrefix: '/monitor' },  // catalog fed 2026-05-11; route file pending
  //   'motherboards': { entityType: 'mobo',    routePrefix: '/mobo' },
};

export function getCategoryEntityConfig(
  categorySlug: string,
): CategoryEntityMapEntry | null {
  return CATEGORY_ENTITY_MAP[categorySlug] ?? null;
}

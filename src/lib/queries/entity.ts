import { createCatalogClient } from '@/lib/supabase/server';
import { resolveRetailer, type RetailerKey } from '@/lib/retailers';
import type { PriceBandPoint } from '@/types';
import { fetchEntityAttributes, type EntityAttribute } from './entity-attributes';
import {
  ENTITY_TYPES,
  CATEGORIES,
  getEntityTypeConfig,
  isRegisteredEntityType,
  type EntityType,
} from '@/lib/entity-config';
import { cleanEntitySlug } from '@/lib/entity-slug-helpers';

/* ---------------------------------------------------------------------
   entity.ts

   Generic getEntityViewModel(entityId, expectedType). Replaces the
   chip-specific getChipViewModel during cutover. Same data shape as
   today, generalized over entity_type:

     - Branch entities (childEntityType set): fetch children + their
       listings, no own listings.
     - Leaf entities (childEntityType null): fetch own listings, no
       children. ALSO fetch parent's attributes for display ("inherited
       specs" â€” Phase-0.5 polish, 2026-05-04). The dbgpu-backfilled
       attributes (architecture, clocks, memory, TDP, process node) all
       live on the gpu_chip parent; without inheritance, board pages
       render an empty Specifications section.
     - Stats roll up whichever set applies.
     - Breadcrumbs are walked server-side via parent_entity_id.

   Honest-labeling layer (Bible Â§9, 2026-05-08):
     - coverageTier on every leaf and every child of a branch.
     - Branches' own coverageTier is null â€” the chip itself isn't sold;
       only its boards are. Per-child tier on each EntityChild row
       carries the trust signal in the chip's children grid.
     - Window split: display still uses 7d (FRESHNESS_DAYS) so a price
       4 days stale still shows on the page; tier classification uses
       48hr (FRESHNESS_HOURS_FOR_TIER) to align with the bar in
       Architecture Â§9. The page can show you a 4-day-old price
       honestly without the page claiming "well-tracked".

   Cookie-free (createCatalogClient) per Bible Â§7 ISR-eligibility note:
     - createClient() reads cookies(), forcing dynamic rendering on any
       calling route regardless of revalidate/generateStaticParams.
     - Catalog reads on canonical_entities, listings, entity_attributes,
       price_observations all have public-read RLS, so anon-key access
       via the cookie-free client is correct.

   Parent-column inheritance + Wikipedia attribution (2026-05-11):
     - Adds parent-column fallback for image_primary_url and
       description_md. Previously only EAV attributes inherited; the
       column-level fields stayed null on leaf pages even when the
       parent had them. Surfaced when the Intel CPU microarch ingest
       (Phase 1) became the first source of catalog descriptions and
       nothing rendered.
     - inheritedFromName now computed from a direct parent-row fetch
       instead of walking the breadcrumb chain. Robust against
       unregistered intermediate entity_types (e.g. cpu_microarch
       before its frontend route ships in Phase 3).
     - Three new view-model fields surface inherited content for
       CC BY-SA attribution: imageInheritedFromName,
       descriptionInheritedFromName, sourceUrl. The first two name the
       parent the content was inherited from (null when leaf-owned);
       sourceUrl is the parent's wikipedia_url entity_attribute, used
       as the attribution link target. wikipedia_url is also filtered
       out of inheritedAttributes so it doesn't accidentally render as
       a displayable spec â€” it's metadata only.

   Lineage (predecessor/successor) — 2026-05-13:
     - fetchLineage() reads entity_relationships for the current
       entity and resolves each predecessor/successor edge to a
       LineageItem (minimal display payload: id, cleanSlug,
       routePrefix, name, releaseDate, imageUrl).
     - Schema-permitted N edges per relationship per entity collapse
       to at most one of each in v0 (the backfill_gpu_lineage.py
       ingest writes one chain edge per direction). If multiple
       arrive in v1 (forked chains, variant siblings promoted), the
       resolver picks the last row Postgres returns — stable enough
       until variant_of lands.
     - Empty result is the common case today: only NVIDIA GeForce
       desktop chips (gen 4-50 mainline) have edges. All other
       entity_types resolve to {predecessor: null, successor: null}.
     - Cost: two extra round-trips inside the Promise.all wrapper.
       Not collapsed into a JOIN-style RPC because (a) the entity-
       relationships table is small enough to make this cheap and
       (b) keeping it client-side keeps the v1 expansion path
       (adding variant_of, alternative_to) one-file.
   --------------------------------------------------------------------- */

/* Types --------------------------------------------------------------- */

export type EntityListing = {
  id: string;
  retailerKey: RetailerKey;
  retailerName: string;
  retailerRaw: string;
  url: string;
  currentPrice: number | null;
  currency: string;
  isOpenBox: boolean;
  lastObservedAt: string | null;
  lastSeen: string | null;
  isActive: boolean;
  countryCode: string | null;
  matchConfidence: number | null;
};

/** One point in an entity's price history, shaped for <PriceChart>.
    For leaves: `date` is the raw price_observations.observed_at timestamp.
    For branches (chips): `date` is a YYYY-MM-DD day and `price` is the
    median across child-board observations on that day (fetchChipPriceHistory).
    Either way PriceChart slices to YYYY-MM-DD and daily-means; the chip
    series is pre-collapsed to one value per day so that mean is a no-op.
    Open-box observations are excluded upstream in both paths. */
export type PriceHistoryPoint = {
  date: string;
  price: number;
};

/** Per Architecture Bible Â§9 honest-labeling. Derived from
    freshRetailerCount (within 48hr) and price-history existence:
      - well_tracked      N >= 3 fresh retailers
      - tracked           N == 2 fresh retailers
      - single_source     N == 1 fresh retailer
      - historical        N == 0 fresh, but past prices exist
      - encyclopedic_only N == 0 fresh, no past prices ever
    UI obligations:
      - well_tracked / tracked: "Lowest current" framing OK.
      - single_source: drop "lowest" framing (no comparison being made).
      - historical: surface as no-current-availability + past prices.
      - encyclopedic_only: hide listings section entirely. */
export type CoverageTier =
  | 'well_tracked'
  | 'tracked'
  | 'single_source'
  | 'historical'
  | 'encyclopedic_only';

export type EntityChild = {
  id: string;
  /** DB-form slug. */
  slug: string;
  /** Slug in clean form for URL emission. Boards/CPUs: same as slug. */
  cleanSlug: string;
  /** Child's own entity_type â€” drives the URL (`${routePrefix}/${cleanSlug}`). */
  entityType: EntityType;
  /** Cached from ENTITY_TYPES[entityType].routePrefix. */
  routePrefix: string;
  name: string;
  brand: string | null;
  /** Hero image URL. The child's own image_primary_url, or — when the
      child entity type sets gridImageInheritsParent (CPUs, which share
      one physical package per microarch) — the parent's image as a
      fallback. Null when neither exists; the card renders "No image".
      GPU boards do NOT inherit — boards are visually distinct products. */
  imageUrl: string | null;
  listings: EntityListing[];
  lowestPrice: number | null;
  lowestPriceCurrency: string | null;
  inStockListingCount: number;
  retailerCount: number;
  /** Distinct retailers with a price observation within FRESHNESS_HOURS_FOR_TIER
      (48hr). Drives coverageTier classification. May be lower than retailerCount,
      which counts retailers with a 7d-fresh price (display freshness). */
  freshRetailerCount: number;
  /** See CoverageTier. For children, computed with the heuristic
      "listings.length > 0 implies historical" â€” tightening to an exact
      historical-observation query per child would require an N+1 against
      price_observations on chip pages with 50+ boards. The leaf case
      (EntityViewModel.coverageTier) does the strict check. */
  coverageTier: CoverageTier;
};

/** Minimal display payload for a predecessor or successor entity.
    Designed to render a navigation card (image + name + release year +
    link) without re-fetching the full target view model. Price/listings
    deliberately excluded — lineage is about chronological context, not
    comparison. Users click through if they want price. */
export type LineageItem = {
  id: string;
  /** Clean form for URL emission (brand prefixes stripped per the
      target's entity_type config). */
  cleanSlug: string;
  /** Cached from ENTITY_TYPES[entityType].routePrefix for the target. */
  routePrefix: string;
  /** display_name with canonical_name fallback. */
  name: string;
  /** ISO release date for "(2022)" side context. May be null. */
  releaseDate: string | null;
  /** Hero image URL. May be null; the card renders a name-only state. */
  imageUrl: string | null;
};

export type BreadcrumbItem = {
  label: string;
  /** href is null for the current page (terminal item, not a link). */
  href: string | null;
};

export type EntityStats = {
  /** 0 for leaves. */
  childCount: number;
  childrenWithListingsCount: number;
  /** All listings under this entity â€” children's for branches, own for leaves. */
  activeListingCount: number;
  inStockListingCount: number;
  retailerCount: number;
  lowestPrice: number | null;
  lowestPriceCurrency: string | null;
};

/** Nightly-cached worth estimate (WORTH_ENGINE_SPEC). Persisted on the
    listing-bearing entity by scripts/persist_worth.py; read straight from
    canonical_entities columns here -- no render-time math. Null when the
    worth engine returned no publishable estimate (below the confidence
    floor, or no observations). Branches (chips) are always null: worth is
    persisted on boards, not the abstract chip identity. */
export type EntityWorth = {
  /** CAD median worth estimate. */
  estimate: number;
  /** Confidence [0,1] from the worth engine. */
  confidence: number;
  /** 'W1' (live retail) | 'W2' (decayed history) in Phase 0. */
  sourceTier: string;
  /** Date of the freshest observation behind the estimate (NOT the
      nightly write date) -- preserves the 'never silently today'
      honesty even though the column is <=24h stale. */
  asOf: string;
};

export type EntityViewModel = {
  id: string;
  entityType: EntityType;
  dbSlug: string;
  cleanSlug: string;
  name: string;
  brand: string | null;
  releaseDate: string | null;
  msrp: number | null;
  msrpCurrency: string | null;
  imageUrl: string | null;
  description: string | null;

  /** Set when imageUrl was inherited from this entity's parent â€” carries
      the parent's display name for attribution. Null when leaf-owned or
      when no image at all. */
  imageInheritedFromName: string | null;
  /** Same shape for description_md inheritance. */
  descriptionInheritedFromName: string | null;
  /** Parent's wikipedia_url entity_attribute, if any. Used by the
      frontend to render CC BY-SA attribution when description or image
      was inherited. Null when leaf has no parent or parent has no
      wikipedia_url attribute. */
  sourceUrl: string | null;

  breadcrumbs: BreadcrumbItem[];
  /** Attributes fetched directly from this entity's entity_attributes rows. */
  attributes: EntityAttribute[];
  /** Attributes inherited from this entity's parent (leaves only). De-duplicated
      against `attributes` â€” keys appearing in both are dropped from this list,
      so the leaf's own attribute wins. `wikipedia_url` is filtered out (it's
      attribution metadata, surfaced via sourceUrl rather than as a spec).
      Empty for branches and orphan leaves. */
  inheritedAttributes: EntityAttribute[];
  /** Display name of the parent entity attributes were inherited from, or null
      when no inheritance is in effect. Used as the SpecsBlock heading. */
  inheritedFromName: string | null;

  /** Populated only for branch entities. Leaves: []. */
  children: EntityChild[];
  /** Populated only for leaf entities. Branches: []. */
  listings: EntityListing[];

  /** Price-history series for this entity, oldest-first. Populated for
      LEAVES only — the entity's own price_observations rows. Branches
      (chips) leave this [] and use priceBand instead. Open-box excluded.
      Consumed by the leaf Price history section via <PriceChart>. */
  priceHistory: PriceHistoryPoint[];

  /** Aggregated price BAND for a BRANCH entity (chip), oldest-first:
      per-day min / max / median across all child-board observations
      (fetchChipPriceHistory), 90d-windowed, open-box excluded. Empty []
      for leaves. Consumed by the chip Price history section via the
      band-mode chart. The min/max spread absorbs the day-to-day
      board-mix noise that a single median line would show as false
      volatility. */
  priceBand: PriceBandPoint[];

  stats: EntityStats;

  /** Distinct retailers with a price observation on THIS entity within
      FRESHNESS_HOURS_FOR_TIER (48hr). For branches, always 0 â€” per-child
      counts are on EntityChild.freshRetailerCount. */
  freshRetailerCount: number;
  /** Honest-labeling tier per Bible Â§9. Null for branches: a chip
      itself isn't sold, so a single tier label for the chip would either
      lie about its boards' coverage or invent an aggregate that means
      nothing. The trust signal lives on each EntityChild row instead. */
  coverageTier: CoverageTier | null;

  /** Predecessor on this entity's product line per entity_relationships.
      Null when no edge exists (chain head, or lineage not yet derived
      for this entity_type), or when the target row's entity_type isn't
      registered in entity-config.ts. */
  predecessor: LineageItem | null;
  /** Successor on this entity's product line. Same null semantics as
      predecessor (chain tail, or lineage not yet derived). */
  successor: LineageItem | null;
  /** Variant_of edges - sibling configurations under the same
      generation / architecture. e.g. an RTX 5070 Ti's 16GB and
      SUPER editions, or all the Ryzen 5 8000-series desktop SKUs.
      Empty array when no edges exist; ordered alphabetically. */
  variants: LineageItem[];

  /** Nightly-cached worth estimate, or null when none is publishable.
      Feeds tier-aware JSON-LD additionalProperty (bible Section 1 user 5). */
  worth: EntityWorth | null;

  lastRefreshed: string;
};

/* Constants ---------------------------------------------------------- */

/** is_in_stock is NULL on 100% of price_observations rows (Bible Risk #19).
    Until the writer is patched, "current price" = most recent observation
    inside the freshness window with a non-null price. 7d gives one full
    daily-scrape margin. Matches getChipViewModel today. */
const FRESHNESS_DAYS = 7;
const OBSERVATION_LIMIT = 10_000;

/** Window for the aggregated chip (branch) price-history chart. Bounds
    row count on chips with many boards and matches the worth engine's
    W2 horizon (WORTH_ENGINE_SPEC §2). Leaf history is unbounded; chip
    history is 90d because it fans out across every child board. */
const CHIP_HISTORY_WINDOW_DAYS = 90;

/** Rolling-window width for the chip price band. Each output point
    aggregates the trailing N days of board observations so the band
    reflects a stable board set rather than one day's scrape subset.
    7 days = one full daily-scrape cycle with margin. */
const BAND_WINDOW_DAYS = 7;

/** Tier classification window. Architecture Â§9 specifies the strengthened
    fed criterion as "ratio of actively-stocked SKUs at N>=3 fresh observations
    within 48 hours". Display freshness (FRESHNESS_DAYS) stays at 7d so prices
    don't flicker on every missed scrape; this stricter window only governs
    whether the page claims "well-tracked / tracked / single-source". */
const FRESHNESS_HOURS_FOR_TIER = 48;
const TIER_FRESHNESS_MS = FRESHNESS_HOURS_FOR_TIER * 3_600_000;

/** Cycle defence on parent_entity_id walk. Phase 1+ trees go up to 3
    levels (TCG: card -> printing -> grading); 5 leaves headroom. */
const MAX_BREADCRUMB_DEPTH = 5;

/* Internal types ----------------------------------------------------- */

type ListingRow = {
  id: string;
  entity_id: string;
  retailer: string;
  url: string | null;
  is_active: boolean;
  country_code: string | null;
  match_confidence: number | null;
  last_seen: string | null;
};

type Observation = {
  price: number;
  currency: string;
  isOpenBox: boolean;
  observedAt: string;
};

type WalkNode = {
  id: string;
  entityType: EntityType;
  slug: string;
  displayName: string;
  parentEntityId: string | null;
};

type AncestorRow = {
  id: string;
  image_primary_url: string | null;
  description_md: string | null;
  canonical_name: string;
  display_name: string | null;
  entity_type: string;
  parent_entity_id: string | null;
};

/* Use a permissive Supabase type until the project's generated types land.
   The catalog client is sync (no Awaited<...> wrapper needed). */
type SupabaseClient = ReturnType<typeof createCatalogClient>;

/* Coverage tier helpers ---------------------------------------------- */

/** Count distinct retailers whose most-recent price observation on this
    listing-set falls within the 48hr tier window. Only listings with a
    non-null currentPrice and a non-null lastObservedAt are eligible. */
function countFreshRetailersFromListings(
  listings: EntityListing[],
): number {
  const now = Date.now();
  const fresh = new Set<RetailerKey>();
  for (const l of listings) {
    if (l.currentPrice == null) continue;
    /* Phase 0 = NEW only (Bible Section 2). Openbox does not
       contribute to fresh-retailer count -> coverage tier. */
    if (l.isOpenBox) continue;
    if (!l.lastObservedAt) continue;
    const ageMs = now - new Date(l.lastObservedAt).getTime();
    if (Number.isNaN(ageMs)) continue;
    if (ageMs <= TIER_FRESHNESS_MS) fresh.add(l.retailerKey);
  }
  return fresh.size;
}

function classifyCoverageTier(
  freshRetailerCount: number,
  hasPriceHistory: boolean,
): CoverageTier {
  if (freshRetailerCount >= 3) return 'well_tracked';
  if (freshRetailerCount === 2) return 'tracked';
  if (freshRetailerCount === 1) return 'single_source';
  return hasPriceHistory ? 'historical' : 'encyclopedic_only';
}

/** Strict historical-observation existence check. Used only by leaves
    when freshRetailerCount === 0 AND no within-7d observation exists â€”
    i.e. when the heuristic of "any currentPrice implies history" fails
    and we need to reach beyond the display window to distinguish
    historical from encyclopedic_only. Single COUNT query, no row fetch. */
async function anyHistoricalObservationExists(
  supabase: SupabaseClient,
  listingIds: string[],
): Promise<boolean> {
  if (listingIds.length === 0) return false;
  const { count, error } = await supabase
    .from('price_observations')
    .select('id', { count: 'exact', head: true })
    .in('listing_id', listingIds)
    .eq('is_openbox', false);
  if (error) {
    console.error('[entity] historical observation check failed:', error);
    return false;
  }
  return (count ?? 0) > 0;
}

/* Parent-row fetch --------------------------------------------------- */

/** Fetch parent's column-level fields needed for inheritance fallback
    (image_primary_url, description_md) and attribution display
    (display_name / canonical_name). Returns null when the parent row
    can't be loaded â€” caller treats as "no inheritance possible". */
/* Walk parent_entity_id chain bottom-up, returning ancestors in order
   (ancestors[0] = immediate parent, [1] = grandparent, ...).
   Unlike buildBreadcrumbs, does NOT halt at unregistered entity_types —
   inheritance must climb past entity_types like gpu_microarch whose frontend
   route hasn't shipped. Caps at MAX_BREADCRUMB_DEPTH for cycle defence.
   2026-05-12: replaces single-hop fetchParentColumns for N-level inheritance
   (ROADMAP Active Item 6). Sequential round-trips acceptable at current
   tree depth (max 3 levels today); revisit RPC consolidation if Phase 2
   deepens trees. */
async function fetchAncestorChain(
  supabase: SupabaseClient,
  startParentId: string,
): Promise<AncestorRow[]> {
  const chain: AncestorRow[] = [];
  let nextId: string | null = startParentId;
  for (let i = 0; i < MAX_BREADCRUMB_DEPTH && nextId; i++) {
    const { data, error } = await supabase
      .from('canonical_entities')
      .select(
        'id, image_primary_url, description_md, canonical_name, display_name, entity_type, parent_entity_id',
      )
      .eq('id', nextId)
      .maybeSingle();
    if (error) {
      console.error('[entity] ancestor walk failed:', error);
      break;
    }
    if (!data) break;
    const row: AncestorRow = {
      id: String(data.id),
      image_primary_url: data.image_primary_url ?? null,
      description_md: data.description_md ?? null,
      canonical_name: data.canonical_name,
      display_name: data.display_name ?? null,
      entity_type: data.entity_type,
      parent_entity_id:
        data.parent_entity_id != null ? String(data.parent_entity_id) : null,
    };
    chain.push(row);
    nextId = row.parent_entity_id;
  }
  return chain;
}

/* Lineage fetch ------------------------------------------------------ */

/** Resolve predecessor/successor edges for an entity. Two round-trips:
    (1) read entity_relationships, (2) batch-fetch the target canonical_entities
    rows. Targets with an unregistered entity_type are skipped (logged warn)
    so a future entity_type without a config entry can't crash the chip page. */
async function fetchLineage(
  supabase: SupabaseClient,
  entityId: string,
): Promise<{
  predecessor: LineageItem | null;
  successor: LineageItem | null;
  variants: LineageItem[];
}> {
  const { data: edges, error: edgesErr } = await supabase
    .from('entity_relationships')
    .select('to_entity_id, relationship')
    .eq('from_entity_id', entityId)
    .in('relationship', ['predecessor', 'successor', 'variant_of']);

  if (edgesErr) {
    console.error('[entity] lineage edge fetch failed:', edgesErr);
    return { predecessor: null, successor: null, variants: [] };
  }
  const rows = edges ?? [];
  if (rows.length === 0) {
    return { predecessor: null, successor: null, variants: [] };
  }

  /* predecessor / successor are singleton edges (last-write-wins on
     duplicates); variant_of can be many per entity. Collect them in
     parallel structures: a Map for the singletons, a deduped list
     for the variants. */
  const byRel = new Map<string, string>();
  const variantTargetIds: string[] = [];
  for (const e of rows) {
    if (e.relationship === 'variant_of') {
      const tid = String(e.to_entity_id);
      if (!variantTargetIds.includes(tid)) variantTargetIds.push(tid);
    } else {
      byRel.set(e.relationship, String(e.to_entity_id));
    }
  }
  const targetIds = Array.from(
    new Set([...byRel.values(), ...variantTargetIds]),
  );

  const { data: targets, error: tgtErr } = await supabase
    .from('canonical_entities')
    .select(
      'id, slug, canonical_name, display_name, release_date, image_primary_url, entity_type',
    )
    .in('id', targetIds);

  if (tgtErr) {
    console.error('[entity] lineage target fetch failed:', tgtErr);
    return { predecessor: null, successor: null, variants: [] };
  }

  type TargetRow = {
    id: string | number;
    slug: string;
    canonical_name: string;
    display_name: string | null;
    release_date: string | null;
    image_primary_url: string | null;
    entity_type: string;
  };
  const targetById = new Map<string, TargetRow>();
  for (const t of (targets ?? []) as TargetRow[]) {
    targetById.set(String(t.id), t);
  }

  /* Resolve a target id to a LineageItem, skipping unregistered
     entity_types so the page can't crash when a relationship target
     is from a vertical whose frontend route hasn't shipped yet. */
  const toLineageItem = (tgtId: string): LineageItem | null => {
    const t = targetById.get(tgtId);
    if (!t) return null;
    if (!isRegisteredEntityType(t.entity_type)) {
      console.warn(
        `[entity] lineage target id=${tgtId} has unregistered entity_type='${t.entity_type}' — skipping`,
      );
      return null;
    }
    const targetCfg = getEntityTypeConfig(t.entity_type as EntityType);
    return {
      id: String(t.id),
      cleanSlug: cleanEntitySlug(t.slug, targetCfg.cleanSlugBrandPrefixes),
      routePrefix: targetCfg.routePrefix,
      name: t.display_name ?? t.canonical_name,
      releaseDate: t.release_date,
      imageUrl: t.image_primary_url,
    };
  };

  const predTgt = byRel.get('predecessor');
  const succTgt = byRel.get('successor');
  const variants: LineageItem[] = variantTargetIds
    .map((id) => toLineageItem(id))
    .filter((x): x is LineageItem => x != null);
  variants.sort((a, b) => a.name.localeCompare(b.name));

  return {
    predecessor: predTgt ? toLineageItem(predTgt) : null,
    successor: succTgt ? toLineageItem(succTgt) : null,
    variants,
  };
}

/* Main --------------------------------------------------------------- */

export async function getEntityViewModel(
  entityId: string,
  expectedType: EntityType,
): Promise<EntityViewModel | null> {
  const cfg = getEntityTypeConfig(expectedType);
  const supabase = createCatalogClient();

  /* 1. Entity row + own attributes in parallel. */
  const [entityRes, attributes] = await Promise.all([
    supabase
      .from('canonical_entities')
      .select(
        'id, slug, canonical_name, display_name, brand, release_date, msrp_cad, msrp_currency, image_primary_url, description_md, entity_type, parent_entity_id, worth_estimate, worth_confidence, worth_source_tier, worth_as_of',
      )
      .eq('id', entityId)
      .maybeSingle(),
    fetchEntityAttributes(entityId),
  ]);

  const { data: entity, error: entityErr } = entityRes;
  if (entityErr) {
    console.error(
      `[entity] canonical_entities query failed (id=${entityId}):`,
      entityErr,
    );
    return null;
  }
  if (!entity) {
    console.warn(`[entity] no canonical_entities row for id=${entityId}`);
    return null;
  }
  if (entity.entity_type !== expectedType) {
    console.warn(
      `[entity] id=${entityId} has entity_type='${entity.entity_type}', expected '${expectedType}'`,
    );
    return null;
  }

  /* 2. Children (branch) OR own listings + price history (leaf). */
  let children: EntityChild[] = [];
  let ownListings: EntityListing[] = [];
  let priceHistory: PriceHistoryPoint[] = [];
  let priceBand: PriceBandPoint[] = [];
  if (cfg.childEntityType) {
    children = await fetchChildren(supabase, String(entity.id), cfg.childEntityType);
    /* Branch: aggregated price BAND from all child observations, per-day
       min/max/median (Bible §6). Runs after fetchChildren so the child
       id set is known.

       GATED to gpu_chip only. A gpu_chip's children are boards — all
       variants of the SAME chip, so a band across them ("what does an
       RTX 5090 cost") is meaningful. A cpu_microarch's children are
       distinct CPUs (a $50 Celeron and a $600 i9 are both Comet Lake),
       so a band across them is a category price range, not a product
       worth — misleading. cpu_microarch pages skip the band; CPU worth
       lives on the individual /cpu leaf pages. */
    if (entity.entity_type === 'gpu_chip') {
      priceBand = await fetchChipPriceHistory(
        supabase,
        children.map((c) => c.id),
      );
    }
  } else {
    /* Leaf: own listings + full price-history series, in parallel.
       fetchOwnListings hits listings + price_observations for the
       latest-per-listing price; fetchPriceHistory is an independent
       read of the full series by entity_id (the leaf's own id). */
    [ownListings, priceHistory] = await Promise.all([
      fetchOwnListings(supabase, String(entity.id)),
      fetchPriceHistory(supabase, String(entity.id)),
    ]);
  }

  /* 3. Breadcrumbs + parent attributes + parent columns + lineage in parallel.
        Inheritance applies to any entity with a parent (the 2026-05-12
        amendment); branches with no parent and orphan leaves still
        resolve them as []/null. Direct parent-row fetch is the
        source of truth for inheritedFromName + image/description
        fallback â€” the breadcrumb walk halts at unregistered entity_types
        (e.g. cpu_microarch before its frontend route ships) so it can't
        be relied on for the immediate-parent name.
        Lineage (predecessor/successor) is on every entity, not just
        those with a parent — chain heads/tails have no edges and
        resolve to {null, null} naturally. */
  const hasParent = entity.parent_entity_id != null;
  const parentId = hasParent ? String(entity.parent_entity_id) : null;

  const [breadcrumbs, rawInherited, ancestors, lineage] = await Promise.all([
    buildBreadcrumbs(supabase, {
      id: String(entity.id),
      entityType: entity.entity_type as EntityType,
      slug: entity.slug,
      displayName: entity.display_name ?? entity.canonical_name,
      parentEntityId:
        entity.parent_entity_id != null ? String(entity.parent_entity_id) : null,
    }),
    parentId
      ? fetchEntityAttributes(parentId)
      : Promise.resolve([] as EntityAttribute[]),
    parentId
      ? fetchAncestorChain(supabase, parentId)
      : Promise.resolve([] as AncestorRow[]),
    fetchLineage(supabase, String(entity.id)),
  ]);

  /* First ancestor (climbing up from the leaf) with a non-null
     image_primary_url and description_md, computed independently so
     image and description can come from different ancestors. A board
     with no own image inherits the chip's product photo, while a chip
     with no own description inherits the microarch's prose. */
  const imageAncestor =
    ancestors.find((a) => a.image_primary_url != null) ?? null;
  const descAncestor =
    ancestors.find((a) => a.description_md != null) ?? null;

  /* Wikipedia URL belongs to whoever supplied the description (the
     attribution is for the description prose; image attribution would
     need a separate Commons-license treatment). Single follow-up query
     for the description ancestor's wikipedia_url attribute. */
  const wikipediaSourceUrl = await (async () => {
    if (!descAncestor) return null;
    const { data } = await supabase
      .from('entity_attributes')
      .select('attribute_value')
      .eq('entity_id', descAncestor.id)
      .eq('attribute_key', 'wikipedia_url')
      .maybeSingle();
    return (data?.attribute_value as string | null) ?? null;
  })();

  /* 4. Inheritance + attribution. wikipedia_url is fetched separately
        above from the description ancestor's entity_attributes (not in
        ATTRIBUTE_CONFIG, so fetchEntityAttributes wouldn't surface it).
        The wikipedia_url filter on inheritedAttributes below is retained
        as defense-in-depth in case the config gains a wikipedia_url
        entry later. Image and description fall back to the first
        ancestor with a non-null value, independently — a board inherits
        chip image + microarch description on a typical GPU page. */
  const ownKeys = new Set(attributes.map((a) => a.key));
  const inheritedAttributes = rawInherited.filter(
    (a) => !ownKeys.has(a.key) && a.key !== 'wikipedia_url',
  );

  const ancestorDisplayName = (a: AncestorRow): string =>
    a.display_name ?? a.canonical_name;

  const imageUrl =
    entity.image_primary_url ?? imageAncestor?.image_primary_url ?? null;
  const description =
    entity.description_md ?? descAncestor?.description_md ?? null;

  const imageInheritedFromName =
    entity.image_primary_url == null && imageAncestor != null
      ? ancestorDisplayName(imageAncestor)
      : null;
  const descriptionInheritedFromName =
    entity.description_md == null && descAncestor != null
      ? ancestorDisplayName(descAncestor)
      : null;

  /* inheritedFromName: section heading for the EAV inheritance block in
     EntitySpecs. The EAV inheritance is still single-hop (only the
     immediate parent's attributes are merged in via fetchEntityAttributes
     above); the heading reflects that ancestor, not the deeper image/
     description sources. */
  const immediateParent = ancestors[0] ?? null;
  const inheritedFromName =
    hasParent && inheritedAttributes.length > 0 && immediateParent
      ? ancestorDisplayName(immediateParent)
      : null;

  /* 5. Stats + tier classification. Stats roll up from whichever set applies.
        Tier classification:
          - Branches: coverageTier = null, freshRetailerCount = 0.
            Per-child tier already computed in fetchChildren and lives on
            each EntityChild row.
          - Leaves: count fresh retailers within 48hr window. If zero AND
            listings exist AND no within-7d price suggests history, fire
            one strict historical check before classifying as
            encyclopedic_only vs historical. */
  const stats = computeStats({ children, ownListings });

  let coverageTier: CoverageTier | null;
  let freshRetailerCount: number;
  if (cfg.childEntityType) {
    coverageTier = null;
    freshRetailerCount = 0;
  } else {
    freshRetailerCount = countFreshRetailersFromListings(ownListings);
    let hasPriceHistory: boolean;
    if (ownListings.length === 0) {
      hasPriceHistory = false;
    } else if (
      ownListings.some((l) => l.currentPrice != null && !l.isOpenBox)
    ) {
      hasPriceHistory = true;
    } else {
      hasPriceHistory = await anyHistoricalObservationExists(
        supabase,
        ownListings.map((l) => l.id),
      );
    }
    coverageTier = classifyCoverageTier(freshRetailerCount, hasPriceHistory);
  }

  console.log(
    `[entity] id=${entityId} type=${expectedType} children=${children.length} listings=${ownListings.length} history=${priceHistory.length} attrs=${attributes.length} inherited=${inheritedAttributes.length} tier=${coverageTier ?? 'branch'} freshRetailers=${freshRetailerCount} imgInh=${imageInheritedFromName ?? 'no'} descInh=${descriptionInheritedFromName ?? 'no'} lineage=${lineage.predecessor ? 'pre' : '-'}/${lineage.successor ? 'suc' : '-'}`,
  );

  /* Worth tuple straight off the cached columns. numeric/real may arrive
     as strings via PostgREST, so coerce; null estimate -> null worth. */
  const worth: EntityWorth | null =
    entity.worth_estimate != null
      ? {
          estimate: Number(entity.worth_estimate),
          confidence: Number(entity.worth_confidence),
          sourceTier: String(entity.worth_source_tier),
          asOf: String(entity.worth_as_of),
        }
      : null;

  return {
    id: String(entity.id),
    entityType: entity.entity_type as EntityType,
    dbSlug: entity.slug,
    cleanSlug: cleanEntitySlug(entity.slug, cfg.cleanSlugBrandPrefixes),
    name: entity.display_name ?? entity.canonical_name,
    brand: entity.brand,
    releaseDate: entity.release_date,
    msrp: entity.msrp_cad != null ? Number(entity.msrp_cad) : null,
    msrpCurrency: entity.msrp_currency,
    imageUrl,
    description,
    imageInheritedFromName,
    descriptionInheritedFromName,
    sourceUrl: wikipediaSourceUrl,
    breadcrumbs,
    attributes,
    inheritedAttributes,
    inheritedFromName,
    children,
    listings: ownListings,
    priceHistory,
    priceBand,
    stats,
    freshRetailerCount,
    coverageTier,
    predecessor: lineage.predecessor,
    successor: lineage.successor,
    variants: lineage.variants,
    worth,
    lastRefreshed: new Date().toISOString(),
  };
}

/* Internals ---------------------------------------------------------- */

async function fetchChildren(
  supabase: SupabaseClient,
  parentId: string,
  childType: EntityType,
): Promise<EntityChild[]> {
  const { data: rawChildren, error: childErr } = await supabase
    .from('canonical_entities')
    .select('id, slug, canonical_name, display_name, brand, image_primary_url, entity_type')
    .eq('parent_entity_id', parentId)
    .eq('entity_type', childType);

  if (childErr) {
    console.error('[entity] children fetch failed:', childErr);
    return [];
  }
  const childRows = rawChildren ?? [];
  if (childRows.length === 0) return [];

  /* Active listings for those children. */
  const childIds = childRows.map((c) => c.id);
  const { data: rawListings, error: listErr } = await supabase
    .from('listings')
    .select(
      'id, entity_id, retailer, url, is_active, country_code, match_confidence, last_seen',
    )
    .in('entity_id', childIds)
    .eq('is_active', true);

  if (listErr) {
    console.error('[entity] children listings fetch failed:', listErr);
  }
  const listings = (rawListings ?? []) as ListingRow[];

  /* Recent observations per listing. */
  const obsByListing = await fetchObservationsByListing(
    supabase,
    listings.map((l) => l.id),
  );

  /* Group listings by child id, attaching current observation. */
  const childCfg = getEntityTypeConfig(childType);

  /* Parent-image fallback for the children grid. Only when the child
     entity type opts in via gridImageInheritsParent (CPUs — every CPU
     under one microarch is the same physical package, so the microarch
     image is the honest image). NOT done for visually-distinct children
     like GPU boards. One extra query, gated to the opt-in types. */
  let parentImageUrl: string | null = null;
  if (childCfg.gridImageInheritsParent) {
    const { data: parentRow } = await supabase
      .from('canonical_entities')
      .select('image_primary_url')
      .eq('id', parentId)
      .maybeSingle();
    parentImageUrl = parentRow?.image_primary_url ?? null;
  }

  const listingsByChild = new Map<string, EntityListing[]>();
  for (const l of listings) {
    const obs = obsByListing.get(l.id);
    const r = resolveRetailer(l.retailer);
    const lst: EntityListing = {
      id: l.id,
      retailerKey: r.id,
      retailerName: r.name,
      retailerRaw: l.retailer,
      url: l.url ?? '',
      currentPrice: obs?.price ?? null,
      currency: obs?.currency ?? 'CAD',
      isOpenBox: obs?.isOpenBox ?? false,
      lastObservedAt: obs?.observedAt ?? null,
      lastSeen: l.last_seen,
      isActive: l.is_active,
      countryCode: l.country_code,
      matchConfidence: l.match_confidence,
    };
    if (!listingsByChild.has(l.entity_id)) listingsByChild.set(l.entity_id, []);
    listingsByChild.get(l.entity_id)!.push(lst);
  }

  /* Sort each child's listings: cheapest in-stock first, then by retailer. */
  for (const [, list] of listingsByChild) {
    list.sort((a, b) => {
      const ap = a.currentPrice ?? Infinity;
      const bp = b.currentPrice ?? Infinity;
      if (ap !== bp) return ap - bp;
      return a.retailerName.localeCompare(b.retailerName);
    });
  }

  /* Assemble children with per-child roll-ups + tier classification.
     Per-child tier uses the heuristic: any active listing implies
     historical. The strict beyond-7d check is reserved for leaf pages
     to avoid an N+1 query against price_observations on chips with
     dozens of boards (Bible Protocol #14 pattern). */
  const children: EntityChild[] = childRows.map((c) => {
    const lst = listingsByChild.get(c.id) ?? [];
    const inStock = lst.filter(
      (l) => l.currentPrice != null && !l.isOpenBox,
    );
    const retailers = new Set(inStock.map((l) => l.retailerKey));
    const cheapest = inStock[0];

    const childFresh = countFreshRetailersFromListings(lst);
    const childHasHistory = lst.length > 0;
    const childTier = classifyCoverageTier(childFresh, childHasHistory);

    return {
      id: String(c.id),
      slug: c.slug,
      cleanSlug: cleanEntitySlug(c.slug, childCfg.cleanSlugBrandPrefixes),
      entityType: childType,
      routePrefix: childCfg.routePrefix,
      name: c.display_name ?? c.canonical_name,
      brand: c.brand,
      imageUrl: c.image_primary_url ?? parentImageUrl,
      listings: lst,
      lowestPrice: cheapest?.currentPrice ?? null,
      lowestPriceCurrency: cheapest?.currency ?? null,
      inStockListingCount: inStock.length,
      retailerCount: retailers.size,
      freshRetailerCount: childFresh,
      coverageTier: childTier,
    };
  });

  /* Sort children: in-stock first (by cheapest), then alphabetical. */
  children.sort((a, b) => {
    const aHas = a.inStockListingCount > 0;
    const bHas = b.inStockListingCount > 0;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && bHas) {
      return (a.lowestPrice ?? Infinity) - (b.lowestPrice ?? Infinity);
    }
    return a.name.localeCompare(b.name);
  });

  return children;
}

async function fetchOwnListings(
  supabase: SupabaseClient,
  entityId: string,
): Promise<EntityListing[]> {
  const { data, error } = await supabase
    .from('listings')
    .select(
      'id, entity_id, retailer, url, is_active, country_code, match_confidence, last_seen',
    )
    .eq('entity_id', entityId)
    .eq('is_active', true);

  if (error) {
    console.error('[entity] own listings fetch failed:', error);
    return [];
  }
  const rows = (data ?? []) as ListingRow[];
  if (rows.length === 0) return [];

  const obsByListing = await fetchObservationsByListing(
    supabase,
    rows.map((l) => l.id),
  );

  const out: EntityListing[] = rows.map((l) => {
    const obs = obsByListing.get(l.id);
    const r = resolveRetailer(l.retailer);
    return {
      id: l.id,
      retailerKey: r.id,
      retailerName: r.name,
      retailerRaw: l.retailer,
      url: l.url ?? '',
      currentPrice: obs?.price ?? null,
      currency: obs?.currency ?? 'CAD',
      isOpenBox: obs?.isOpenBox ?? false,
      lastObservedAt: obs?.observedAt ?? null,
      lastSeen: l.last_seen,
      isActive: l.is_active,
      countryCode: l.country_code,
      matchConfidence: l.match_confidence,
    };
  });

  out.sort((a, b) => {
    const ap = a.currentPrice ?? Infinity;
    const bp = b.currentPrice ?? Infinity;
    if (ap !== bp) return ap - bp;
    return a.retailerName.localeCompare(b.retailerName);
  });

  return out;
}

async function fetchObservationsByListing(
  supabase: SupabaseClient,
  listingIds: string[],
): Promise<Map<string, Observation>> {
  const out = new Map<string, Observation>();
  if (listingIds.length === 0) return out;
  const since = new Date(Date.now() - FRESHNESS_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('price_observations')
    .select('listing_id, price, currency, is_openbox, observed_at')
    .in('listing_id', listingIds)
    .gte('observed_at', since)
    .order('observed_at', { ascending: false })
    .limit(OBSERVATION_LIMIT);

  if (error) {
    console.error('[entity] price_observations fetch failed:', error);
    return out;
  }
  for (const o of data ?? []) {
    if (out.has(o.listing_id)) continue; // first seen = most recent
    if (o.price == null) continue;
    out.set(o.listing_id, {
      price: Number(o.price),
      currency: o.currency ?? 'CAD',
      isOpenBox: !!o.is_openbox,
      observedAt: o.observed_at,
    });
  }
  return out;
}

/** Full new-price observation series for a leaf entity, oldest-first.

    Queries price_observations directly by entity_id (the denormalized
    column) â€” for a leaf the observation's entity_id IS this entity, so no
    listings round-trip is needed. Branches must NOT call this: their
    observations carry child entity_ids, not the branch's own id, so the
    result would be empty and misleading. fetchOwnListings/the leaf branch
    of getEntityViewModel is the only caller.

    is_openbox=false: PriceChart draws a daily-MEAN line, so an open-box
    observation sharing a day with a new-price observation would pull the
    mean toward a figure that is neither. Open-box prices still surface as
    individual rows via EntityListings; they're excluded from the trend
    line only. Rows with a NULL/negative price or NULL observed_at are
    dropped defensively. */
async function fetchPriceHistory(
  supabase: SupabaseClient,
  entityId: string,
): Promise<PriceHistoryPoint[]> {
  const { data, error } = await supabase
    .from('price_observations')
    .select('price, observed_at')
    .eq('entity_id', entityId)
    .eq('is_openbox', false)
    .order('observed_at', { ascending: true })
    .limit(OBSERVATION_LIMIT);

  if (error) {
    console.error('[entity] price history fetch failed:', error);
    return [];
  }

  const out: PriceHistoryPoint[] = [];
  for (const o of data ?? []) {
    if (o.price == null || !o.observed_at) continue;
    const price = Number(o.price);
    if (Number.isNaN(price) || price < 0) continue;
    out.push({ date: o.observed_at as string, price });
  }
  return out;
}

/** Aggregated price BAND for a BRANCH entity (chip), built from every
    child board's observations. One PriceBandPoint per day carrying the
    min / max / median board price that day plus the observation count.

    Why a band, not a single line: a chip has dozens of boards at very
    different prices. A single median line jumps day-to-day purely from
    which boards happened to be scraped, reading as false volatility. The
    min/max band shows the real spread; the median line inside it is the
    honest central trend (Bible §6: median, never min).

    Scoped to CHIP_HISTORY_WINDOW_DAYS — a chip fans out across dozens of
    boards, so an unbounded query is the row-count risk the leaf path
    doesn't have. Branches must call THIS, not fetchPriceHistory: a chip's
    own id has no price_observations rows (observations carry child board
    ids), so fetchPriceHistory would return []. */
async function fetchChipPriceHistory(
  supabase: SupabaseClient,
  childIds: string[],
): Promise<PriceBandPoint[]> {
  if (childIds.length === 0) return [];
  const since = new Date(
    Date.now() - CHIP_HISTORY_WINDOW_DAYS * 86_400_000,
  ).toISOString();

  const { data, error } = await supabase
    .from('price_observations')
    .select('entity_id, price, observed_at')
    .in('entity_id', childIds)
    .eq('is_openbox', false)
    .gte('observed_at', since)
    .order('observed_at', { ascending: true })
    .limit(OBSERVATION_LIMIT);

  if (error) {
    console.error('[entity] chip price history fetch failed:', error);
    return [];
  }

  /* Rolling-window aggregation (BAND_WINDOW_DAYS).

     A single-calendar-day band thrashes: the scraper doesn't see every
     board each day, so each day's min/max swings with whichever boards
     happened to be in that day's batch, not with real price movement.

     Fix: each output point aggregates the trailing BAND_WINDOW_DAYS of
     observations. Over a 7-day window the scraper has almost certainly
     seen most boards at least once, so every point is computed from
     roughly the same full board set and the band stops jittering.

     Within a window, each BOARD contributes once — its most recent
     observation inside the window. A board scraped 5 days running must
     not count 5x and drag the band toward its price; the unit is the
     board, not the row (mirrors the worth engine's per-retailer
     collapse). */
  type Obs = { boardId: string; price: number; t: number };
  const all: Obs[] = [];
  for (const o of data ?? []) {
    if (o.price == null || !o.observed_at) continue;
    const price = Number(o.price);
    if (Number.isNaN(price) || price < 0) continue;
    const t = Math.floor(
      new Date(o.observed_at as string).getTime() / 86_400_000,
    );
    all.push({ boardId: String(o.entity_id), price, t });
  }
  if (all.length === 0) return [];

  /* Distinct observation days, ascending — one output point per day
     that actually has data. */
  const days = Array.from(new Set(all.map((o) => o.t))).sort((a, b) => a - b);
  const firstDay = days[0];

  /* Warm-up trim. A point at day D aggregates the trailing
     BAND_WINDOW_DAYS, but for the first BAND_WINDOW_DAYS-1 days that
     window reaches back before any data exists — it is computed from a
     partial board set and the band is artificially narrow then wild as
     coverage fills in. Those points are not trustworthy, so they are
     dropped: the first emitted point is the first day whose full
     trailing window lies within the observed range. If the catalog has
     less than BAND_WINDOW_DAYS of history total, nothing is trimmed
     (better a short honest chart than an empty one). */
  const warmupCutoff = firstDay + (BAND_WINDOW_DAYS - 1);
  const trimWarmup = days[days.length - 1] >= warmupCutoff;

  const out: PriceBandPoint[] = [];
  for (const day of days) {
    if (trimWarmup && day < warmupCutoff) continue;
    const lo = day - (BAND_WINDOW_DAYS - 1);
    /* Most recent price per board within [lo, day]. */
    const latestPerBoard = new Map<string, Obs>();
    for (const o of all) {
      if (o.t < lo || o.t > day) continue;
      const prev = latestPerBoard.get(o.boardId);
      if (prev == null || o.t > prev.t) latestPerBoard.set(o.boardId, o);
    }
    const prices = [...latestPerBoard.values()].map((o) => o.price);
    if (prices.length === 0) continue;
    out.push({
      date: new Date(day * 86_400_000).toISOString().slice(0, 10),
      min: Math.min(...prices),
      max: Math.max(...prices),
      median: medianOf(prices),
      count: prices.length,
    });
  }
  return out;
}

/** Median of a non-empty number array. Caller guarantees length >= 1
    (byDay only creates a bucket when pushing into it). */
function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

async function buildBreadcrumbs(
  supabase: SupabaseClient,
  start: WalkNode,
): Promise<BreadcrumbItem[]> {
  /* Walk parent chain bottom-up: [self, parent, grandparent, ...]. */
  const chain: WalkNode[] = [start];
  let current: WalkNode = start;
  for (let i = 0; i < MAX_BREADCRUMB_DEPTH && current.parentEntityId; i++) {
    const { data: parent, error } = await supabase
      .from('canonical_entities')
      .select(
        'id, slug, canonical_name, display_name, entity_type, parent_entity_id',
      )
      .eq('id', current.parentEntityId)
      .maybeSingle();

    if (error) {
      console.error('[entity] breadcrumb walk failed:', error);
      break;
    }
    if (!parent) break;
    if (!isRegisteredEntityType(parent.entity_type)) {
      console.warn(
        `[entity] breadcrumb walk hit unregistered entity_type='${parent.entity_type}' (id=${parent.id})`,
      );
      break;
    }

    const next: WalkNode = {
      id: String(parent.id),
      entityType: parent.entity_type as EntityType,
      slug: parent.slug,
      displayName: parent.display_name ?? parent.canonical_name,
      parentEntityId:
        parent.parent_entity_id != null ? String(parent.parent_entity_id) : null,
    };
    chain.push(next);
    current = next;
  }

  /* Outermost ancestor's category determines the category breadcrumb. */
  const root = chain[chain.length - 1];
  const rootCfg = ENTITY_TYPES[root.entityType];
  const category = CATEGORIES[rootCfg.category];

  const items: BreadcrumbItem[] = [
    { label: 'Home', href: '/' },
    { label: category.label, href: `/c/${rootCfg.category}` },
  ];

  /* Walk back from root -> start, emitting links for non-final items. */
  for (let i = chain.length - 1; i >= 0; i--) {
    const node = chain[i];
    const cfg = ENTITY_TYPES[node.entityType];
    const cleaned = cleanEntitySlug(node.slug, cfg.cleanSlugBrandPrefixes);
    const isCurrent = i === 0;
    items.push({
      label: node.displayName,
      href: isCurrent ? null : `${cfg.routePrefix}/${cleaned}`,
    });
  }

  return items;
}

function computeStats(input: {
  children: EntityChild[];
  ownListings: EntityListing[];
}): EntityStats {
  const { children, ownListings } = input;

  /* Source listings from whichever side has them. */
  const allListings: EntityListing[] =
    children.length > 0 ? children.flatMap((c) => c.listings) : ownListings;

  const inStock = allListings.filter(
    (l) => l.currentPrice != null && !l.isOpenBox,
  );
  const retailers = new Set(inStock.map((l) => l.retailerKey));
  const cheapest = inStock.reduce<EntityListing | null>(
    (acc, l) =>
      acc == null ||
      (l.currentPrice ?? Infinity) < (acc.currentPrice ?? Infinity)
        ? l
        : acc,
    null,
  );

  return {
    childCount: children.length,
    childrenWithListingsCount: children.filter(
      (c) => c.inStockListingCount > 0,
    ).length,
    activeListingCount: allListings.length,
    inStockListingCount: inStock.length,
    retailerCount: retailers.size,
    lowestPrice: cheapest?.currentPrice ?? null,
    lowestPriceCurrency: cheapest?.currency ?? null,
  };
}

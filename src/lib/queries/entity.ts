import { createClient } from '@/lib/supabase/server';
import { resolveRetailer, type RetailerKey } from '@/lib/retailers';
import { fetchEntityAttributes, type EntityAttribute } from './entity-attributes';
import {
  ENTITY_TYPES,
  CATEGORIES,
  getEntityTypeConfig,
  isRegisteredEntityType,
  type EntityType,
} from '@/lib/entity-config';
import { cleanEntitySlug } from '@/lib/entity-slug-helpers';

/* ───────────────────────────────────────────────────────────────────────────
   entity.ts

   Generic getEntityViewModel(entityId, expectedType). Replaces the
   chip-specific getChipViewModel during cutover. Same data shape as
   today, generalized over entity_type:

     - Branch entities (childEntityType set): fetch children + their
       listings, no own listings.
     - Leaf entities (childEntityType null): fetch own listings, no
       children. ALSO fetch parent's attributes for display ("inherited
       specs" — Phase-0.5 polish, 2026-05-04). The dbgpu-backfilled
       attributes (architecture, clocks, memory, TDP, process node) all
       live on the gpu_chip parent; without inheritance, board pages
       render an empty Specifications section.
     - Stats roll up whichever set applies.
     - Breadcrumbs are walked server-side via parent_entity_id.

   Live chip page is NOT touched by this module. Step 3 of the design
   doc (cutover) is the only point at which chip/[slug]/page.tsx swaps
   to using this.
   ─────────────────────────────────────────────────────────────────────────── */

/* Types ─────────────────────────────────────────────────────────────────── */

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

export type EntityChild = {
  id: string;
  /** DB-form slug. */
  slug: string;
  /** Slug in clean form for URL emission. Boards/CPUs: same as slug. */
  cleanSlug: string;
  /** Child's own entity_type — drives the URL (`${routePrefix}/${cleanSlug}`). */
  entityType: EntityType;
  /** Cached from ENTITY_TYPES[entityType].routePrefix. */
  routePrefix: string;
  name: string;
  brand: string | null;
  listings: EntityListing[];
  lowestPrice: number | null;
  lowestPriceCurrency: string | null;
  inStockListingCount: number;
  retailerCount: number;
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
  /** All listings under this entity — children's for branches, own for leaves. */
  activeListingCount: number;
  inStockListingCount: number;
  retailerCount: number;
  lowestPrice: number | null;
  lowestPriceCurrency: string | null;
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

  breadcrumbs: BreadcrumbItem[];
  /** Attributes fetched directly from this entity's entity_attributes rows. */
  attributes: EntityAttribute[];
  /** Attributes inherited from this entity's parent (leaves only). De-duplicated
      against `attributes` — keys appearing in both are dropped from this list,
      so the leaf's own attribute wins. Empty for branches and orphan leaves. */
  inheritedAttributes: EntityAttribute[];
  /** Display name of the parent entity attributes were inherited from, or null
      when no inheritance is in effect. Used as the SpecsBlock heading. */
  inheritedFromName: string | null;

  /** Populated only for branch entities. Leaves: []. */
  children: EntityChild[];
  /** Populated only for leaf entities. Branches: []. */
  listings: EntityListing[];

  stats: EntityStats;
  lastRefreshed: string;
};

/* Constants ─────────────────────────────────────────────────────────────── */

/** is_in_stock is NULL on 100% of price_observations rows (Bible Risk #19).
    Until the writer is patched, "current price" = most recent observation
    inside the freshness window with a non-null price. 7d gives one full
    daily-scrape margin. Matches getChipViewModel today. */
const FRESHNESS_DAYS = 7;
const OBSERVATION_LIMIT = 10_000;

/** Cycle defence on parent_entity_id walk. Phase 1+ trees go up to 3
    levels (TCG: card → printing → grading); 5 leaves headroom. */
const MAX_BREADCRUMB_DEPTH = 5;

/* Internal types ────────────────────────────────────────────────────────── */

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

/* Use a permissive Supabase type until the project's generated types land.
   The existing chip.ts also leaves this implicit. */
type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/* Main ──────────────────────────────────────────────────────────────────── */

export async function getEntityViewModel(
  entityId: string,
  expectedType: EntityType,
): Promise<EntityViewModel | null> {
  const cfg = getEntityTypeConfig(expectedType);
  const supabase = await createClient();

  /* 1. Entity row + own attributes in parallel. */
  const [entityRes, attributes] = await Promise.all([
    supabase
      .from('canonical_entities')
      .select(
        'id, slug, canonical_name, display_name, brand, release_date, msrp_cad, msrp_currency, image_primary_url, description_md, entity_type, parent_entity_id',
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

  /* 2. Children (branch) OR own listings (leaf). */
  let children: EntityChild[] = [];
  let ownListings: EntityListing[] = [];
  if (cfg.childEntityType) {
    children = await fetchChildren(supabase, String(entity.id), cfg.childEntityType);
  } else {
    ownListings = await fetchOwnListings(supabase, String(entity.id));
  }

  /* 3. Breadcrumbs + parent attributes (leaves only) in parallel.
        Both depend only on entity.parent_entity_id, so they parallelize
        cleanly. Branches and orphan leaves resolve parent attrs as []. */
  const isLeafWithParent =
    !cfg.childEntityType && entity.parent_entity_id != null;
  const parentId = isLeafWithParent ? String(entity.parent_entity_id) : null;

  const [breadcrumbs, rawInherited] = await Promise.all([
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
  ]);

  /* 4. De-duplicate inherited against own keys (leaf's own attribute wins
        if both exist; e.g. a board with a factory boost_clock_mhz overrides
        the chip's reference clock). Then resolve the parent's display name
        from the breadcrumb chain — the immediate parent is the second-to-
        last breadcrumb item ([Home, Category, ...ancestors..., Self]). */
  const ownKeys = new Set(attributes.map((a) => a.key));
  const inheritedAttributes = rawInherited.filter((a) => !ownKeys.has(a.key));

  const inheritedFromName =
    isLeafWithParent &&
    inheritedAttributes.length > 0 &&
    breadcrumbs.length >= 2
      ? breadcrumbs[breadcrumbs.length - 2].label
      : null;

  /* 5. Stats — roll up from whichever set applies. */
  const stats = computeStats({ children, ownListings });

  console.log(
    `[entity] id=${entityId} type=${expectedType} children=${children.length} listings=${ownListings.length} attrs=${attributes.length} inherited=${inheritedAttributes.length}`,
  );

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
    imageUrl: entity.image_primary_url,
    description: entity.description_md,
    breadcrumbs,
    attributes,
    inheritedAttributes,
    inheritedFromName,
    children,
    listings: ownListings,
    stats,
    lastRefreshed: new Date().toISOString(),
  };
}

/* Internals ─────────────────────────────────────────────────────────────── */

async function fetchChildren(
  supabase: SupabaseClient,
  parentId: string,
  childType: EntityType,
): Promise<EntityChild[]> {
  const { data: rawChildren, error: childErr } = await supabase
    .from('canonical_entities')
    .select('id, slug, canonical_name, display_name, brand, entity_type')
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

  /* Assemble children with per-child roll-ups. */
  const children: EntityChild[] = childRows.map((c) => {
    const lst = listingsByChild.get(c.id) ?? [];
    const inStock = lst.filter((l) => l.currentPrice != null);
    const retailers = new Set(inStock.map((l) => l.retailerKey));
    const cheapest = inStock[0];
    return {
      id: String(c.id),
      slug: c.slug,
      cleanSlug: cleanEntitySlug(c.slug, childCfg.cleanSlugBrandPrefixes),
      entityType: childType,
      routePrefix: childCfg.routePrefix,
      name: c.display_name ?? c.canonical_name,
      brand: c.brand,
      listings: lst,
      lowestPrice: cheapest?.currentPrice ?? null,
      lowestPriceCurrency: cheapest?.currency ?? null,
      inStockListingCount: inStock.length,
      retailerCount: retailers.size,
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

  /* Walk back from root → start, emitting links for non-final items. */
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

  const inStock = allListings.filter((l) => l.currentPrice != null);
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

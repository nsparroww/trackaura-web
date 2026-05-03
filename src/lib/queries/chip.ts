import { createClient } from '@/lib/supabase/server';
import { cleanChipSlug } from '@/lib/chip-slug';
import { resolveRetailer, type RetailerKey } from '@/lib/retailers';
import {
  fetchChipAttributes,
  type ChipAttribute,
} from '@/lib/queries/chip-attributes';

/* ─────────────────────────────────────────────────────────────────────
   Types
   ───────────────────────────────────────────────────────────────────── */

export type ChipListing = {
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

export type ChipBoard = {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  listings: ChipListing[];
  lowestPrice: number | null;
  lowestPriceCurrency: string | null;
  inStockListingCount: number;
  retailerCount: number;
};

export type ChipViewModel = {
  id: string;
  dbSlug: string;
  cleanSlug: string;
  name: string;
  brand: string | null;
  releaseDate: string | null;
  msrp: number | null;
  msrpCurrency: string | null;
  imageUrl: string | null;
  description: string | null;
  attributes: ChipAttribute[];
  boards: ChipBoard[];
  stats: {
    boardCount: number;
    boardsWithListingsCount: number;
    activeListingCount: number;
    inStockListingCount: number;
    retailerCount: number;
    lowestPrice: number | null;
    lowestPriceCurrency: string | null;
  };
  lastRefreshed: string;
};

/* ─────────────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────────────── */

// is_in_stock is NULL on 100% of price_observations rows today (Architecture
// Bible Draft 17 §11 risk 20). Until the observations writer is patched,
// "current price" = the most recent observation inside this window with a
// non-null price. 7d gives one full daily-scrape margin.
const FRESHNESS_DAYS = 7;
const OBSERVATION_LIMIT = 10_000;

/* ─────────────────────────────────────────────────────────────────────
   Main query
   ───────────────────────────────────────────────────────────────────── */

export async function getChipViewModel(
  entityId: string,
): Promise<ChipViewModel | null> {
  const supabase = await createClient();

  // 1. Chip entity itself + attributes (parallelized).
  const [chipRes, attributes] = await Promise.all([
    supabase
      .from('canonical_entities')
      .select(
        'id, slug, canonical_name, display_name, brand, release_date, msrp_cad, msrp_currency, image_primary_url, description_md, entity_type',
      )
      .eq('id', entityId)
      .maybeSingle(),
    fetchChipAttributes(entityId),
  ]);

  const { data: chip, error: chipErr } = chipRes;

  if (chipErr) {
    console.error('[chip] canonical_entities query failed:', chipErr);
    return null;
  }
  if (!chip) {
    console.warn(`[chip] no canonical_entities row for id=${entityId}`);
    return null;
  }
  if (chip.entity_type !== 'gpu_chip') {
    console.warn(
      `[chip] entity id=${entityId} has entity_type="${chip.entity_type}", expected "gpu_chip"`,
    );
    return null;
  }

  // 2. Board children (entity_type='gpus' under this chip).
  const { data: boardsRaw, error: boardsErr } = await supabase
    .from('canonical_entities')
    .select('id, slug, canonical_name, display_name, brand')
    .eq('parent_entity_id', entityId)
    .eq('entity_type', 'gpus');

  if (boardsErr) {
    console.error('[chip] boards query failed:', boardsErr);
    return null;
  }
  const boards = boardsRaw ?? [];

  // 3. Active listings for those boards.
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
  let listingsRaw: ListingRow[] = [];
  if (boards.length > 0) {
    const boardIds = boards.map((b) => b.id);
    const { data, error: listingsErr } = await supabase
      .from('listings')
      .select(
        'id, entity_id, retailer, url, is_active, country_code, match_confidence, last_seen',
      )
      .in('entity_id', boardIds)
      .eq('is_active', true);
    if (listingsErr) {
      console.error('[chip] listings query failed:', listingsErr);
    } else {
      listingsRaw = (data ?? []) as ListingRow[];
    }
  }

  // 4. Recent price observations per listing.
  // Pull all observations in the freshness window descending; the first
  // row we see for each listing_id wins (most recent).
  const obsByListing = new Map<
    string,
    { price: number; currency: string; isOpenBox: boolean; observedAt: string }
  >();
  if (listingsRaw.length > 0) {
    const listingIds = listingsRaw.map((l) => l.id);
    const since = new Date(
      Date.now() - FRESHNESS_DAYS * 86_400_000,
    ).toISOString();
    const { data: obsData, error: obsErr } = await supabase
      .from('price_observations')
      .select('listing_id, price, currency, is_openbox, observed_at')
      .in('listing_id', listingIds)
      .gte('observed_at', since)
      .order('observed_at', { ascending: false })
      .limit(OBSERVATION_LIMIT);
    if (obsErr) {
      console.error('[chip] price_observations query failed:', obsErr);
    }
    for (const o of obsData ?? []) {
      if (obsByListing.has(o.listing_id)) continue; // first seen = most recent
      if (o.price == null) continue;
      obsByListing.set(o.listing_id, {
        price: Number(o.price),
        currency: o.currency ?? 'CAD',
        isOpenBox: !!o.is_openbox,
        observedAt: o.observed_at,
      });
    }
  }

  // Group listings by their parent board, attaching current observation.
  const listingsByBoard = new Map<string, ChipListing[]>();
  for (const l of listingsRaw) {
    const obs = obsByListing.get(l.id);
    const cfg = resolveRetailer(l.retailer);
    const listing: ChipListing = {
      id: l.id,
      retailerKey: cfg.id,
      retailerName: cfg.name,
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
    if (!listingsByBoard.has(l.entity_id)) listingsByBoard.set(l.entity_id, []);
    listingsByBoard.get(l.entity_id)!.push(listing);
  }

  // Sort each board's listings: cheapest in-stock first, then by retailer.
  for (const [, list] of listingsByBoard) {
    list.sort((a, b) => {
      const ap = a.currentPrice ?? Infinity;
      const bp = b.currentPrice ?? Infinity;
      if (ap !== bp) return ap - bp;
      return a.retailerName.localeCompare(b.retailerName);
    });
  }

  // Assemble boards with per-board roll-ups.
  const chipBoards: ChipBoard[] = boards.map((b) => {
    const listings = listingsByBoard.get(b.id) ?? [];
    const inStock = listings.filter((l) => l.currentPrice != null);
    const retailers = new Set(inStock.map((l) => l.retailerKey));
    const cheapest = inStock[0];
    return {
      id: b.id,
      slug: b.slug,
      name: b.display_name ?? b.canonical_name,
      brand: b.brand,
      listings,
      lowestPrice: cheapest?.currentPrice ?? null,
      lowestPriceCurrency: cheapest?.currency ?? null,
      inStockListingCount: inStock.length,
      retailerCount: retailers.size,
    };
  });

  // Sort boards: in-stock first (by cheapest), then alphabetical.
  chipBoards.sort((a, b) => {
    const aHas = a.inStockListingCount > 0;
    const bHas = b.inStockListingCount > 0;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && bHas) {
      return (a.lowestPrice ?? Infinity) - (b.lowestPrice ?? Infinity);
    }
    return a.name.localeCompare(b.name);
  });

  // Chip-level roll-up.
  const allListings = chipBoards.flatMap((b) => b.listings);
  const inStockListings = allListings.filter((l) => l.currentPrice != null);
  const retailerSet = new Set(inStockListings.map((l) => l.retailerKey));
  const cheapestOverall = inStockListings.reduce<ChipListing | null>(
    (acc, l) =>
      acc == null ||
      (l.currentPrice ?? Infinity) < (acc.currentPrice ?? Infinity)
        ? l
        : acc,
    null,
  );

  console.log(
    `[chip] entity=${entityId} boards=${chipBoards.length} listings=${allListings.length} in_stock=${inStockListings.length} retailers=${retailerSet.size} attrs=${attributes.length}`,
  );

  return {
    id: chip.id,
    dbSlug: chip.slug,
    cleanSlug: cleanChipSlug(chip.slug),
    name: chip.display_name ?? chip.canonical_name,
    brand: chip.brand,
    releaseDate: chip.release_date,
    msrp: chip.msrp_cad != null ? Number(chip.msrp_cad) : null,
    msrpCurrency: chip.msrp_currency,
    imageUrl: chip.image_primary_url,
    description: chip.description_md,
    attributes,
    boards: chipBoards,
    stats: {
      boardCount: chipBoards.length,
      boardsWithListingsCount: chipBoards.filter(
        (b) => b.inStockListingCount > 0,
      ).length,
      activeListingCount: allListings.length,
      inStockListingCount: inStockListings.length,
      retailerCount: retailerSet.size,
      lowestPrice: cheapestOverall?.currentPrice ?? null,
      lowestPriceCurrency: cheapestOverall?.currency ?? null,
    },
    lastRefreshed: new Date().toISOString(),
  };
}

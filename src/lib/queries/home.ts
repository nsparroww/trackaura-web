import { createClient } from '@/lib/supabase/server';
import { resolveRetailer, type RetailerKey } from '@/lib/retailers';
import { CATEGORY_ENTITY_MAP } from '@/lib/category-entity-map';

/* ----------------------------------------------------------------------
   Types
   ---------------------------------------------------------------------- */

export type HomeCategory = {
  key: string;
  label: string;
  count: number;
  atLowest: number;
};

export type HomeFeaturedProduct = {
  id: number;
  slug: string;
  name: string;
  brand: string | null;
  category: string;
  imageUrl: string | null;
  bestPrice: number;
  allTimeLow: number;
  allTimeHigh: number;
  savings: number;
  dropPct: number;
  bestRetailerId: RetailerKey | null;
  bestRetailerName: string | null;
  isAtl: boolean;
};

/**
 * Entity-native featured shape used by the migrated-vertical homepage
 * section. Differs from HomeFeaturedProduct in that it carries the route
 * prefix (e.g. '/chip', '/cpu') so cards link to the right per-vertical
 * page without homepage code knowing about specific verticals.
 */
export type HomeFeaturedEntity = {
  id: number;
  slug: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  routePrefix: string;
  bestPrice: number;
  allTimeLow: number;
  allTimeHigh: number;
  bestRetailerId: RetailerKey | null;
  bestRetailerName: string | null;
  retailerCount: number;
  dropPct: number;
  isAtl: boolean;
};

export type HomeRecentDrop = {
  productSlug: string;
  productName: string;
  category: string;
  retailerId: RetailerKey;
  retailerName: string;
  oldPrice: number;
  newPrice: number;
  pct: number;
  when: string;
};

export type HomeStats = {
  totalProducts: number;
  totalRetailers: number;
  categoriesTracked: number;
};

/* ----------------------------------------------------------------------
   Utils
   ---------------------------------------------------------------------- */

function prettify(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function formatRelative(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = 60_000, h = 60 * m, d = 24 * h;
  if (diff < h) return `${Math.max(1, Math.round(diff / m))}m ago`;
  if (diff < d) return `${Math.round(diff / h)}h ago`;
  return `${Math.round(diff / d)}d ago`;
}

const SKIP_KEYWORDS = [
  'server', 'enterprise', 'hpe ', 'proliant', 'rack mount',
  'ecc reg', 'registered', 'refurbished', 'open box',
  'replacement', 'spare', 'oem', 'bulk pack',
  'keycap', 'key cap', 'wrist rest', 'cable', 'adapter',
  'dongle', 'converter', 'extension', 'splitter',
];

function isJunkName(name: string): boolean {
  if (!name) return true;
  if (/[{}]/.test(name)) return true;
  const wordCount = name.trim().split(/\s+/).length;
  if (wordCount < 3) return true;
  if (name === name.toUpperCase() && wordCount <= 4) return true;
  const lower = name.toLowerCase();
  if (SKIP_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  return false;
}

/* ----------------------------------------------------------------------
   Home stats
   ---------------------------------------------------------------------- */

export async function getHomeStats(): Promise<HomeStats> {
  const supabase = await createClient();

  const [canonicalCount, retailersData, categoriesData] = await Promise.all([
    supabase
      .from('canonical_products')
      .select('id', { count: 'exact', head: true }),
    supabase
      .from('products')
      .select('retailer')
      .not('retailer', 'is', null)
      .limit(50_000),
    supabase
      .from('canonical_products')
      .select('category')
      .not('category', 'is', null)
      .limit(50_000),
  ]);

  const distinctRetailers = new Set<string>();
  for (const row of retailersData.data ?? []) {
    const cfg = resolveRetailer(row.retailer);
    if (cfg.id !== 'unknown') distinctRetailers.add(cfg.id);
  }

  const distinctCategories = new Set<string>();
  for (const row of categoriesData.data ?? []) {
    if (row.category && row.category !== 'other')
      distinctCategories.add(row.category);
  }

  return {
    totalProducts: canonicalCount.count ?? 0,
    totalRetailers: distinctRetailers.size,
    categoriesTracked: distinctCategories.size,
  };
}

/* ----------------------------------------------------------------------
   Top categories
   ---------------------------------------------------------------------- */

export async function getHomeCategories(
  limit: number = 12,
): Promise<HomeCategory[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('home_top_categories', {
    result_limit: limit,
  });

  if (error) {
    console.error('[home] categories RPC failed:', error);
    return [];
  }
  if (!data) return [];

  return (data as Array<{ category: string; cnt: number }>).map((row) => ({
    key: row.category,
    label: prettify(row.category),
    count: Number(row.cnt),
    atLowest: 0,
  }));
}

/* ----------------------------------------------------------------------
   Featured entities (NEW; entity-native, replaces getFeaturedDeals on
   the homepage)
   ----------------------------------------------------------------------

   Walks CATEGORY_ENTITY_MAP, calls get_category_entities_aggregated for
   each distinct entity_type, and returns items currently at all-time low
   or with a significant gap from peak. Designed to survive the transition
   window: as verticals migrate (CPU, monitors, etc.), they're picked up
   automatically without homepage code changes.

   Threshold (isAtl OR dropPct >= 15) is intentionally strict so the
   section reflects real price intelligence rather than promotional
   "deals". Bible Â§2: not a deals site.
*/

type AggregatedRow = {
  id: number;
  slug: string;
  canonical_name: string;
  display_name: string | null;
  brand: string | null;
  image_primary_url: string | null;
  best_price: number | null;
  best_retailer: string | null;
  retailer_count: number;
  all_time_low: number | null;
  all_time_high: number | null;
  in_stock: boolean;
};

export async function getHomeFeaturedEntities(
  limit: number = 8,
): Promise<HomeFeaturedEntity[]> {
  const supabase = await createClient();

  // Dedupe entity types (multiple slugs alias to the same vertical).
  const verticals = new Map<string, { routePrefix: string }>();
  for (const cfg of Object.values(CATEGORY_ENTITY_MAP)) {
    if (verticals.has(cfg.entityType)) continue;
    verticals.set(cfg.entityType, { routePrefix: cfg.routePrefix });
  }

  const all: HomeFeaturedEntity[] = [];

  for (const [entityType, { routePrefix }] of verticals) {
    const { data, error } = await supabase.rpc(
      'get_category_entities_aggregated',
      { p_entity_type: entityType },
    );
    if (error) {
      console.error(`[home] featured entities RPC failed for ${entityType}:`, error);
      continue;
    }
    if (!Array.isArray(data)) continue;

    for (const row of data as AggregatedRow[]) {
      const bestPrice = row.best_price != null ? Number(row.best_price) : null;
      const atl = row.all_time_low != null ? Number(row.all_time_low) : null;
      const ath = row.all_time_high != null ? Number(row.all_time_high) : null;

      if (bestPrice == null || atl == null || ath == null) continue;
      if (!row.in_stock) continue;
      if (ath <= atl * 1.02) continue; // no real range = no signal

      const isAtl = bestPrice <= atl && bestPrice < ath * 0.95;
      const dropPct = ((ath - bestPrice) / ath) * 100;

      // Strict threshold; the section is a price-intelligence surface,
      // not a deals carousel.
      if (!isAtl && dropPct < 15) continue;

      const name = row.display_name ?? row.canonical_name;
      if (isJunkName(name)) continue;

      const retailerCfg = row.best_retailer
        ? resolveRetailer(row.best_retailer)
        : null;

      all.push({
        id: row.id,
        slug: row.slug,
        name,
        brand: row.brand,
        imageUrl: row.image_primary_url,
        routePrefix,
        bestPrice,
        allTimeLow: atl,
        allTimeHigh: ath,
        bestRetailerId: retailerCfg && retailerCfg.id !== 'unknown' ? retailerCfg.id : null,
        bestRetailerName: retailerCfg && retailerCfg.id !== 'unknown' ? retailerCfg.name : null,
        retailerCount: row.retailer_count,
        dropPct,
        isAtl,
      });
    }
  }

  // ATL items first, then biggest drop %.
  all.sort((a, b) => {
    if (a.isAtl !== b.isAtl) return a.isAtl ? -1 : 1;
    return b.dropPct - a.dropPct;
  });

  return all.slice(0, limit);
}

/* ----------------------------------------------------------------------
   Featured deals (DEPRECATED on the homepage â€” kept for safety in case
   another component imports it. Delete once confirmed unused.)
   ---------------------------------------------------------------------- */

export async function getFeaturedDeals(
  count: number = 6,
): Promise<HomeFeaturedProduct[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('home_featured_deals', {
    candidate_limit: 80,
  });

  if (error) {
    console.error('[home] featured deals RPC failed:', error);
    return [];
  }
  if (!data) return [];

  type RpcRow = {
    canonical_id: number;
    slug: string;
    name: string;
    brand: string | null;
    category: string;
    image_url: string | null;
    current_price: number;
    min_price: number;
    max_price: number;
    retailer: string;
    drop_pct: number;
  };

  const scored: HomeFeaturedProduct[] = [];
  for (const row of data as RpcRow[]) {
    if (isJunkName(row.name)) continue;

    const curr = Number(row.current_price);
    const min = Number(row.min_price);
    const max = Number(row.max_price);
    const retailerCfg = resolveRetailer(row.retailer);

    const hasRealRange = max > 0 && min > 0 && max > min * 1.02;
    const isAtl = hasRealRange && curr <= min && curr < max * 0.95;

    scored.push({
      id: row.canonical_id,
      slug: row.slug,
      name: row.name,
      brand: row.brand,
      category: row.category,
      imageUrl: row.image_url,
      bestPrice: curr,
      allTimeLow: min,
      allTimeHigh: max,
      savings: max - curr,
      dropPct: Number(row.drop_pct),
      bestRetailerId: retailerCfg.id !== 'unknown' ? retailerCfg.id : null,
      bestRetailerName: retailerCfg.id !== 'unknown' ? retailerCfg.name : null,
      isAtl,
    });
  }

  const byCategory = new Map<string, HomeFeaturedProduct[]>();
  for (const p of scored) {
    const arr = byCategory.get(p.category) ?? [];
    arr.push(p);
    byCategory.set(p.category, arr);
  }

  const categoryOrder = [...byCategory.keys()].sort((a, b) => {
    const topA = byCategory.get(a)![0].dropPct;
    const topB = byCategory.get(b)![0].dropPct;
    return topB - topA;
  });

  const featured: HomeFeaturedProduct[] = [];
  for (let round = 0; featured.length < count && round < 4; round++) {
    for (const cat of categoryOrder) {
      if (featured.length >= count) break;
      const p = byCategory.get(cat)?.[round];
      if (p) featured.push(p);
    }
  }
  return featured;
}

/* ----------------------------------------------------------------------
   Recent price drops (DEPRECATED on the homepage â€” same notes as above)
   ---------------------------------------------------------------------- */

export async function getRecentDrops(limit: number = 6): Promise<HomeRecentDrop[]> {
  const supabase = await createClient();

  const { data: points } = await supabase
    .from('price_points')
    .select('product_id, price, timestamp')
    .order('timestamp', { ascending: false })
    .limit(500);

  if (!points || points.length === 0) return [];

  const byProduct = new Map<number, typeof points>();
  for (const p of points) {
    const arr = byProduct.get(p.product_id) ?? [];
    arr.push(p);
    byProduct.set(p.product_id, arr);
  }

  type Drop = {
    productId: number;
    oldPrice: number;
    newPrice: number;
    pct: number;
    dollars: number;
    timestamp: string;
  };
  const drops: Drop[] = [];
  for (const [productId, arr] of byProduct) {
    if (arr.length < 2) continue;
    const curr = Number(arr[0].price);
    const prev = Number(arr[1].price);
    if (!(prev > 0 && curr < prev)) continue;
    const pct = ((prev - curr) / prev) * 100;
    const dollars = prev - curr;
    if (pct < 2 || dollars < 2) continue;
    drops.push({
      productId,
      oldPrice: prev,
      newPrice: curr,
      pct,
      dollars,
      timestamp: arr[0].timestamp,
    });
  }

  drops.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const top = drops.slice(0, limit * 6);

  if (top.length === 0) return [];

  const productIds = top.map((d) => d.productId);
  const { data: productRows } = await supabase
    .from('products')
    .select('id, retailer, canonical_id')
    .in('id', productIds);

  if (!productRows) return [];

  const canonicalIds = productRows
    .map((p) => p.canonical_id)
    .filter((id): id is number => id != null);

  const { data: canonicalRows } = await supabase
    .from('canonical_products')
    .select('id, slug, name, category')
    .in('id', canonicalIds);

  const productById = new Map(productRows.map((p) => [p.id, p]));
  const canonicalById = new Map((canonicalRows ?? []).map((c) => [c.id, c]));

  const result: HomeRecentDrop[] = [];
  for (const d of top) {
    if (result.length >= limit) break;
    const product = productById.get(d.productId);
    if (!product) continue;
    const canonical = product.canonical_id
      ? canonicalById.get(product.canonical_id)
      : null;
    if (!canonical) continue;

    if (isJunkName(canonical.name)) continue;
    if (canonical.category === 'other') continue;

    const retailerCfg = resolveRetailer(product.retailer);
    if (retailerCfg.id === 'unknown') continue;

    result.push({
      productSlug: canonical.slug,
      productName: canonical.name,
      category: canonical.category,
      retailerId: retailerCfg.id,
      retailerName: retailerCfg.name,
      oldPrice: d.oldPrice,
      newPrice: d.newPrice,
      pct: d.pct,
      when: formatRelative(d.timestamp),
    });
  }
  return result;
}
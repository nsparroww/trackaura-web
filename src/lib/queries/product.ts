import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import {
  resolveRetailer,
  type RetailerConfig,
  type RetailerKey,
} from '@/lib/retailers';

/* ────────────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────────────── */

export type RetailerSnapshot = RetailerConfig & {
  productId: number;
  url: string | null;
  price: number | null;
  prev24hPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  lastUpdated: string | null;
  lastSeen: string | null;
  inStock: boolean;
  isOpenBox: boolean;
};

export type PriceHistoryRow = {
  date: string;
} & Partial<Record<RetailerKey, number>>;

export type ActivityEntry = {
  retailerId: RetailerKey;
  kind: 'drop' | 'rise' | 'atl';
  from: number;
  to: number;
  delta: number;
  when: string;
  timestamp: string;
};

export type SpecGroup = {
  group: string;
  items: Array<[string, string]>;
};

export type ProductViewModel = {
  id: number;
  slug: string;
  title: string;
  brand: string;
  category: string;
  sku: string | null;
  msrp: number | null;
  imageUrl: string | null;
  blurb: string | null;
  retailers: RetailerSnapshot[];
  priceHistory: PriceHistoryRow[];
  stats: {
    atl: number;
    ath: number;
    median: number;
    current: number;
    currentRetailerId: RetailerKey | null;
    isAtl: boolean;
  };
  specs: SpecGroup[];
  activity: ActivityEntry[];
  breadcrumbs: Array<{ label: string; href: string }>;
  lastRefreshed: string;
};

/* ────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────── */

const HISTORY_DAYS = 365;
const PRICE_POINT_LIMIT = 50_000;

function slugifySegment(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatRelative(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = 60_000,
    h = 60 * m,
    d = 24 * h;
  if (diff < h) return `${Math.max(1, Math.round(diff / m))}m ago`;
  if (diff < d) return `${Math.round(diff / h)}h ago`;
  const days = Math.round(diff / d);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/* ────────────────────────────────────────────────────────────────────
   Main query

   Wrapped in React's cache() so generateMetadata() and the Page
   component share a single database round trip per render. Without
   this, every page render fires 2× (metadata + body) × 3 queries =
   6 database round trips. With cache(), it's 3.

   cache() scope is per-request; ISR regeneration creates a new cache
   per regenerated page, so this doesn't compromise revalidation.
   See https://react.dev/reference/react/cache
   ──────────────────────────────────────────────────────────────────── */

export const getProductViewModel = cache(_getProductViewModel);

async function _getProductViewModel(
  slug: string,
): Promise<ProductViewModel | null> {
  const supabase = await createClient();

  // 1. Canonical product
  const { data: canonical, error: canonicalErr } = await supabase
    .from('canonical_products')
    .select(
      'id, slug, name, brand, model_number, category, subcategory, msrp, image_url, description',
    )
    .eq('slug', slug)
    .maybeSingle();

  if (canonicalErr) {
    console.error('[product] canonical_products query failed:', canonicalErr);
    return null;
  }
  if (!canonical) {
    console.warn(`[product] no canonical_products row for slug="${slug}"`);
    return null;
  }

  // 2. Linked retailer products
  const { data: rProducts, error: rProductsErr } = await supabase
    .from('products')
    .select(
      'id, retailer, url, current_price, min_price, max_price, last_updated, last_seen, image_url, specs, is_openbox',
    )
    .eq('canonical_id', canonical.id);

  if (rProductsErr) {
    console.error('[product] products query failed:', rProductsErr);
    return null;
  }
  if (!rProducts || rProducts.length === 0) {
    console.warn(
      `[product] canonical id=${canonical.id} (slug="${slug}") has no linked products`,
    );
    return null;
  }

  // 3. Price history for all linked products
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();
  const productIds = rProducts.map((p) => p.id);
  const { data: pricePointsRaw, error: ppErr } = await supabase
    .from('price_points')
    .select('product_id, price, timestamp')
    .in('product_id', productIds)
    .gte('timestamp', since)
    .order('timestamp', { ascending: true })
    .limit(PRICE_POINT_LIMIT);
  if (ppErr) {
    console.error('[product] price_points query failed:', ppErr);
  }
  const pricePoints = pricePointsRaw ?? [];
  console.log(
    `[product] slug="${slug}" canonical=${canonical.id} retailers=${rProducts.length} price_points=${pricePoints.length}`,
  );

  /* ── Dedup per retailer ──────────────────────────────────────────
     A canonical_id can have multiple products per retailer (e.g.
     open-box + regular). Prefer the cheapest non-open-box row. */
  const productsByRetailerId = new Map<RetailerKey, (typeof rProducts)[number]>();
  const retailerByProductId = new Map<number, RetailerConfig>();
  for (const p of rProducts) {
    const cfg = resolveRetailer(p.retailer);
    retailerByProductId.set(p.id, cfg);
    const existing = productsByRetailerId.get(cfg.id);
    const pPrice = p.current_price != null ? Number(p.current_price) : Infinity;
    const ePrice =
      existing && existing.current_price != null
        ? Number(existing.current_price)
        : Infinity;
    const better =
      !existing ||
      (!p.is_openbox && existing.is_openbox) ||
      (p.is_openbox === existing.is_openbox && pPrice < ePrice);
    if (better) productsByRetailerId.set(cfg.id, p);
  }

  /* ── Per-retailer snapshots ────────────────────────────────────── */
  const cutoff24h = Date.now() - 24 * 3600 * 1000;
  const retailers: RetailerSnapshot[] = [];
  for (const [, p] of productsByRetailerId) {
    const cfg = resolveRetailer(p.retailer);
    let prev24h: number | null = null;
    for (let i = pricePoints.length - 1; i >= 0; i--) {
      const pp = pricePoints[i];
      if (
        pp.product_id === p.id &&
        new Date(pp.timestamp).getTime() <= cutoff24h
      ) {
        prev24h = Number(pp.price);
        break;
      }
    }
    retailers.push({
      ...cfg,
      productId: p.id,
      url: p.url,
      price: p.current_price != null ? Number(p.current_price) : null,
      prev24hPrice: prev24h,
      minPrice: p.min_price != null ? Number(p.min_price) : null,
      maxPrice: p.max_price != null ? Number(p.max_price) : null,
      lastUpdated: p.last_updated,
      lastSeen: p.last_seen,
      inStock: p.current_price != null,
      isOpenBox: p.is_openbox,
    });
  }
  retailers.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));

  /* ── Merged daily price history (pivot + forward-fill) ────────── */
  const bucketsByDate = new Map<string, Map<RetailerKey, number>>();
  for (const pp of pricePoints) {
    const cfg = retailerByProductId.get(pp.product_id);
    if (!cfg || cfg.id === 'unknown') continue;
    const date = pp.timestamp.slice(0, 10);
    if (!bucketsByDate.has(date)) bucketsByDate.set(date, new Map());
    bucketsByDate.get(date)!.set(cfg.id, Number(pp.price));
  }
  const sortedDates = [...bucketsByDate.keys()].sort();
  const priceHistory: PriceHistoryRow[] = [];
  const running = {} as Partial<Record<RetailerKey, number>>;
  for (const date of sortedDates) {
    const bucket = bucketsByDate.get(date)!;
    for (const [rid, price] of bucket) running[rid] = price;
    priceHistory.push({ date, ...running });
  }

  /* ── Stats ──────────────────────────────────────────────────────── */
  const allHistoryPrices: number[] = [];
  for (const row of priceHistory) {
    for (const key of Object.keys(row)) {
      if (key === 'date') continue;
      const v = (row as Record<string, unknown>)[key];
      if (typeof v === 'number') allHistoryPrices.push(v);
    }
  }
  const retailerMins = retailers
    .map((r) => r.minPrice)
    .filter((v): v is number => v != null);
  const retailerMaxes = retailers
    .map((r) => r.maxPrice)
    .filter((v): v is number => v != null);
  const inStockPrices = retailers
    .filter((r) => r.inStock && r.price != null)
    .map((r) => r.price as number);

  const current = inStockPrices.length
    ? Math.min(...inStockPrices)
    : (allHistoryPrices.at(-1) ?? 0);
  const currentRetailer = retailers.find(
    (r) => r.inStock && r.price === current,
  );
  const currentRetailerId = currentRetailer?.id ?? null;

  const atlPool = [...allHistoryPrices, ...retailerMins];
  const athPool = [...allHistoryPrices, ...retailerMaxes];
  const atl = atlPool.length ? Math.min(...atlPool) : current;
  const ath = athPool.length ? Math.max(...athPool) : current;
  const medianPrice = median(allHistoryPrices.length ? allHistoryPrices : inStockPrices);

  /* ── Specs: pick the richest jsonb from any linked product ───── */
  const specGroups: SpecGroup[] = (() => {
    const candidates = rProducts
      .map((p) => p.specs)
      .filter(
        (s): s is Record<string, unknown> =>
          !!s && typeof s === 'object' && !Array.isArray(s),
      )
      .sort((a, b) => Object.keys(b).length - Object.keys(a).length);
    const best = candidates[0];
    if (!best) return [];

    // Handle two shapes:
    //   flat:    { "Memory": "16 GB", "TGP": "360 W" }
    //   grouped: { "Memory": { "Size": "16 GB" }, "Power": { "TGP": "360 W" } }
    const grouped: SpecGroup[] = [];
    const flatItems: Array<[string, string]> = [];
    for (const [k, v] of Object.entries(best)) {
      if (v == null || v === '') continue;
      if (typeof v === 'object' && !Array.isArray(v)) {
        const items: Array<[string, string]> = Object.entries(
          v as Record<string, unknown>,
        )
          .filter(([, vv]) => vv != null && vv !== '')
          .map(([kk, vv]) => [kk, String(vv)]);
        if (items.length) grouped.push({ group: k, items });
      } else {
        flatItems.push([k, String(v)]);
      }
    }
    if (grouped.length) {
      if (flatItems.length)
        grouped.push({ group: 'Other', items: flatItems });
      return grouped;
    }
    return flatItems.length
      ? [{ group: 'Specifications', items: flatItems }]
      : [];
  })();

  /* ── Activity feed (10 most recent price changes) ─────────────── */
  const pointsByProduct = new Map<number, typeof pricePoints>();
  for (const pp of pricePoints) {
    if (!pointsByProduct.has(pp.product_id))
      pointsByProduct.set(pp.product_id, []);
    pointsByProduct.get(pp.product_id)!.push(pp);
  }
  const activityItems: ActivityEntry[] = [];
  for (const [productId, points] of pointsByProduct) {
    const cfg = retailerByProductId.get(productId);
    if (!cfg || cfg.id === 'unknown') continue;
    let runningMin = Infinity;
    for (let i = 0; i < points.length; i++) {
      const price = Number(points[i].price);
      const ts = points[i].timestamp;
      if (i === 0) {
        runningMin = price;
        continue;
      }
      const prev = Number(points[i - 1].price);
      if (price === prev) continue;
      const isAtl = price <= runningMin && price < prev;
      runningMin = Math.min(runningMin, price);
      activityItems.push({
        retailerId: cfg.id,
        kind: isAtl ? 'atl' : price < prev ? 'drop' : 'rise',
        from: prev,
        to: price,
        delta: price - prev,
        when: formatRelative(ts),
        timestamp: ts,
      });
    }
  }
  activityItems.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const activity = activityItems.slice(0, 10);

  /* ── Breadcrumbs ────────────────────────────────────────────────── */
  const breadcrumbs: Array<{ label: string; href: string }> = [];
  if (canonical.category)
    breadcrumbs.push({
      label: canonical.category,
      href: `/c/${slugifySegment(canonical.category)}`,
    });
  if (canonical.brand && canonical.category)
    breadcrumbs.push({
      label: canonical.brand,
      href: `/c/${slugifySegment(canonical.category)}/b/${slugifySegment(canonical.brand)}`,
    });

  return {
    id: canonical.id,
    slug: canonical.slug,
    title: canonical.name,
    brand: canonical.brand,
    category: canonical.category,
    sku: canonical.model_number || null,
    msrp: canonical.msrp != null ? Number(canonical.msrp) : null,
    imageUrl: canonical.image_url,
    blurb: canonical.description,
    retailers,
    priceHistory,
    stats: {
      atl,
      ath,
      median: medianPrice,
      current,
      currentRetailerId,
      isAtl: current > 0 && current <= atl,
    },
    specs: specGroups,
    activity,
    breadcrumbs,
    lastRefreshed: new Date().toISOString(),
  };
}

// src/lib/queries/category-entity.ts
//
// Reads a migrated category from canonical_entities via the
// get_category_entities_aggregated RPC. The function returns a single
// JSON value (an array of row objects) rather than a TABLE, which
// sidesteps Supabase's server-side max-rows cap on PostgREST table
// responses (Risk #18). data from .rpc() is the parsed array directly.

import { createClient } from '@/lib/supabase/server';
import {
  resolveRetailer,
  RETAILERS,
  type RetailerKey,
} from '@/lib/retailers';
import type {
  CategoryViewModel,
  CategoryProduct,
  BrandSummary,
} from './category';

const ACRONYMS = new Set<string>([
  'GPU', 'CPU', 'RAM', 'SSD', 'HDD', 'PSU', 'NAS', 'PC', 'TV',
  'USB', 'HDMI', 'AIO', 'API', 'ARGB', 'RGB', 'ATX', 'NVME',
  'OLED', 'IPS', 'VA', 'TN', 'LCD', 'LED', 'UPS', 'DAC', 'AMP',
]);

function prettifyCategorySlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => {
      if (!w) return w;
      const upper = w.toUpperCase();
      if (upper.length > 1 && upper.endsWith('S')) {
        const stem = upper.slice(0, -1);
        if (ACRONYMS.has(stem)) return stem + 's';
      }
      if (ACRONYMS.has(upper)) return upper;
      return w[0].toUpperCase() + w.slice(1);
    })
    .join(' ');
}

type RpcRow = {
  id: number;
  slug: string;
  canonical_name: string;
  display_name: string | null;
  brand: string | null;
  image_primary_url: string | null;
  msrp_cad: number | null;
  best_price: number | null;
  best_retailer: string | null;
  retailer_count: number;
  retailers: string[] | null;
  all_time_low: number | null;
  all_time_high: number | null;
  in_stock: boolean;
  is_openbox: boolean;
};

/**
 * Reads the catalog for a migrated category slug. Returns null when the
 * RPC errors or returns an empty array; the route falls back to the v0
 * canonical_products query in that case.
 */
export async function getCategoryEntityViewModel(
  categorySlug: string,
  entityType: string,
): Promise<CategoryViewModel | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    'get_category_entities_aggregated',
    { p_entity_type: entityType },
  );

  if (error) {
    console.error('[category-entity] RPC failed:', error);
    return null;
  }

  // RPC returns a JSON array directly (function RETURNS json). No row cap.
  const rows = (Array.isArray(data) ? data : []) as RpcRow[];

  if (rows.length === 0) {
    console.warn(
      `[category-entity] no entities for type="${entityType}" (slug="${categorySlug}")`,
    );
    return null;
  }

  const products: CategoryProduct[] = rows.map((r) => {
    const bestRetailerCfg = r.best_retailer
      ? resolveRetailer(r.best_retailer)
      : null;

    let isAtl = false;
    if (
      r.best_price != null &&
      r.all_time_low != null &&
      r.all_time_high != null &&
      r.all_time_high > r.all_time_low * 1.02
    ) {
      isAtl =
        r.best_price <= r.all_time_low &&
        r.best_price < r.all_time_high * 0.95;
    }

    return {
      id: r.id,
      slug: r.slug,
      name: r.display_name ?? r.canonical_name,
      brand: r.brand,
      imageUrl: r.image_primary_url,
      msrp: r.msrp_cad != null ? Number(r.msrp_cad) : null,
      bestPrice: r.best_price != null ? Number(r.best_price) : null,
      bestRetailerId: bestRetailerCfg?.id ?? null,
      bestRetailerName: bestRetailerCfg?.name ?? null,
      bestRetailerUrl: null, // chip page surfaces the actual URL per listing
      allTimeLow: r.all_time_low != null ? Number(r.all_time_low) : null,
      allTimeHigh: r.all_time_high != null ? Number(r.all_time_high) : null,
      retailerCount: r.retailer_count,
      inStock: r.in_stock,
      isOpenBox: r.is_openbox,
      isAtl,
    };
  });

  // ----- stats -----
  const withPrice = products.filter((p) => p.bestPrice != null);
  const sortedPrices = withPrice
    .map((p) => p.bestPrice as number)
    .sort((a, b) => a - b);
  const avgPrice = sortedPrices.length
    ? Math.round(sortedPrices.reduce((s, v) => s + v, 0) / sortedPrices.length)
    : 0;
  const medianPrice = sortedPrices.length
    ? sortedPrices[Math.floor(sortedPrices.length / 2)]
    : 0;
  const atLowestCount = products.filter((p) => p.isAtl && p.inStock).length;

  // Catalog-level retailer counts: how many entities each retailer carries
  // (not just where each retailer happens to be cheapest). Sourced from the
  // `retailers` array column on the RPC.
  const retailerProductCounts = new Map<RetailerKey, number>();
  for (const r of rows) {
    const list = r.retailers ?? [];
    for (const ret of list) {
      const cfg = resolveRetailer(ret);
      if (cfg.id === 'unknown') continue;
      retailerProductCounts.set(
        cfg.id,
        (retailerProductCounts.get(cfg.id) ?? 0) + 1,
      );
    }
  }
  const retailers = [...retailerProductCounts.entries()]
    .map(([id, count]) => ({ id, name: RETAILERS[id].name, count }))
    .sort((a, b) => b.count - a.count);

  // ----- brand summaries -----
  type BrandBucket = {
    variants: Map<string, number>;
    count: number;
    prices: number[];
    atLowest: number;
  };
  const brandMap = new Map<string, BrandBucket>();
  for (const p of products) {
    if (!p.brand) continue;
    const key = p.brand.trim().toUpperCase();
    if (!key) continue;
    let bucket = brandMap.get(key);
    if (!bucket) {
      bucket = { variants: new Map(), count: 0, prices: [], atLowest: 0 };
      brandMap.set(key, bucket);
    }
    bucket.variants.set(p.brand, (bucket.variants.get(p.brand) ?? 0) + 1);
    bucket.count += 1;
    if (p.bestPrice != null) bucket.prices.push(p.bestPrice);
    if (p.isAtl && p.inStock) bucket.atLowest += 1;
  }

  const brands: BrandSummary[] = [...brandMap.entries()]
    .filter(
      ([key, b]) =>
        b.count >= 2 &&
        key.length >= 2 &&
        !/^\d+$/.test(key) &&
        key !== 'UNKNOWN',
    )
    .map(([, b]) => {
      const displayName = [...b.variants.entries()].sort(
        (a, c) => c[1] - a[1],
      )[0][0];
      return {
        name: displayName,
        count: b.count,
        avgPrice: b.prices.length
          ? Math.round(
              b.prices.reduce((s, v) => s + v, 0) / b.prices.length,
            )
          : 0,
        minPrice: b.prices.length ? Math.min(...b.prices) : 0,
        atLowestCount: b.atLowest,
      };
    })
    .sort((a, b) => b.count - a.count);

  return {
    slug: categorySlug,
    name: prettifyCategorySlug(categorySlug),
    products,
    brands,
    stats: {
      totalProducts: products.length,
      withPrice: withPrice.length,
      atLowest: atLowestCount,
      avgPrice,
      medianPrice,
      retailers,
    },
  };
}
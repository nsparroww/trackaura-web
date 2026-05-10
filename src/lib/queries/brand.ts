import { createCatalogClient } from '@/lib/supabase/server';
import { resolveRetailer, RETAILERS, type RetailerKey } from '@/lib/retailers';
import type { CategoryProduct } from '@/lib/queries/category';

/* ────────────────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────────────────── */

export type BrandInCategoryViewModel = {
  categorySlug: string;
  categoryName: string;
  brandSlug: string;
  brandName: string;
  products: CategoryProduct[];
  stats: {
    totalProducts: number;
    withPrice: number;
    atLowest: number;
    avgPrice: number;
    medianPrice: number;
    retailers: Array<{ id: RetailerKey; name: string; count: number }>;
  };
  siblingBrands: Array<{ name: string; slug: string; count: number }>;
};

/* ────────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────────── */

const CANONICAL_LIMIT = 5_000;
const PRODUCT_ROWS_LIMIT = 25_000;

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

export function brandToSlug(brand: string): string {
  return brand
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Convert a brand slug back into the set of canonical-brand variants that
 * map to it. The brand column has mixed casing ("YEALINK"/"Yealink",
 * "MSI"/"Msi", "SAPPHIRE"/"Sapphire"/"SAPPHIRE TECH") and the slugifier
 * collapses casing AND non-alphanumerics. So multiple raw brand strings
 * may share one slug, and we want to fetch products under any of them.
 *
 * Returns the most-common variant as `displayName` plus the full list
 * for a downstream `.in('brand', variants)` query.
 */
async function resolveBrandVariants(
  categorySlug: string,
  brandSlug: string,
): Promise<{ displayName: string; variants: string[] } | null> {
  const supabase = createCatalogClient();
  const { data } = await supabase
    .from('canonical_products')
    .select('brand')
    .eq('category', categorySlug)
    .not('brand', 'is', null)
    .limit(50_000);

  if (!data) return null;

  const counts = new Map<string, number>();
  for (const row of data) {
    const b = row.brand as string | null;
    if (!b) continue;
    if (brandToSlug(b) !== brandSlug) continue;
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return {
    displayName: sorted[0][0],
    variants: sorted.map(([name]) => name),
  };
}

/* ────────────────────────────────────────────────────────────────────────
   Main query
   ──────────────────────────────────────────────────────────────────────── */

export async function getBrandInCategoryViewModel(
  categorySlug: string,
  brandSlug: string,
): Promise<BrandInCategoryViewModel | null> {
  const supabase = createCatalogClient();

  // 1. Resolve brand slug → all case variants in this category.
  const resolved = await resolveBrandVariants(categorySlug, brandSlug);
  if (!resolved) {
    console.warn(
      `[brand] no brand matching slug="${brandSlug}" in category="${categorySlug}"`,
    );
    return null;
  }
  const { displayName: brandName, variants } = resolved;

  // 2. Canonical products in this category + ANY case variant of the brand.
  const { data: canonicalRows, error: cErr } = await supabase
    .from('canonical_products')
    .select('id, slug, name, brand, image_url, msrp')
    .eq('category', categorySlug)
    .in('brand', variants)
    .not('image_url', 'is', null)
    .limit(CANONICAL_LIMIT);

  if (cErr) {
    console.error('[brand] canonical_products query failed:', cErr);
    return null;
  }
  if (!canonicalRows || canonicalRows.length === 0) {
    console.warn(
      `[brand] no canonical rows for variants=${JSON.stringify(variants)} category="${categorySlug}"`,
    );
    return null;
  }

  // 3. Linked retailer products, slim columns only.
  const canonicalIds = canonicalRows.map((c) => c.id);
  const { data: productRows, error: pErr } = await supabase
    .from('products')
    .select(
      'canonical_id, retailer, current_price, min_price, max_price, url, is_openbox',
    )
    .in('canonical_id', canonicalIds)
    .limit(PRODUCT_ROWS_LIMIT);

  if (pErr) {
    console.error('[brand] products query failed:', pErr);
    return null;
  }

  // 4. Group per canonical.
  const productsByCanonical = new Map<number, NonNullable<typeof productRows>>();
  for (const p of productRows ?? []) {
    const arr = productsByCanonical.get(p.canonical_id) ?? [];
    arr.push(p);
    productsByCanonical.set(p.canonical_id, arr);
  }

  // 5. Aggregate into CategoryProduct shape (reuses the card component).
  const products: CategoryProduct[] = canonicalRows.map((c) => {
    const linked = productsByCanonical.get(c.id) ?? [];
    const inStock = linked.filter((p) => p.current_price != null);

    const sorted = [...inStock].sort((a, b) => {
      if (a.is_openbox !== b.is_openbox) return a.is_openbox ? 1 : -1;
      return Number(a.current_price) - Number(b.current_price);
    });
    const best = sorted[0] ?? null;
    const bestRetailerCfg = best ? resolveRetailer(best.retailer) : null;
    const bestPrice =
      best?.current_price != null ? Number(best.current_price) : null;

    const allPrices = linked
      .flatMap((p) => [
        p.min_price != null ? Number(p.min_price) : null,
        p.max_price != null ? Number(p.max_price) : null,
        p.current_price != null ? Number(p.current_price) : null,
      ])
      .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);

    const allTimeLow = allPrices.length ? Math.min(...allPrices) : null;
    const allTimeHigh = allPrices.length ? Math.max(...allPrices) : null;

    // Same gate as category.ts — don't flag ATL on degenerate price ranges.
    let isAtl = false;
    if (
      bestPrice != null &&
      allTimeLow != null &&
      allTimeHigh != null &&
      allTimeHigh > allTimeLow * 1.02
    ) {
      isAtl = bestPrice <= allTimeLow && bestPrice < allTimeHigh * 0.95;
    }

    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      brand: c.brand,
      imageUrl: c.image_url,
      msrp: c.msrp != null ? Number(c.msrp) : null,
      bestPrice,
      bestRetailerId: bestRetailerCfg?.id ?? null,
      bestRetailerName: bestRetailerCfg?.name ?? null,
      bestRetailerUrl: best?.url ?? null,
      allTimeLow,
      allTimeHigh,
      retailerCount: linked.length,
      inStock: inStock.length > 0,
      isOpenBox: best?.is_openbox ?? false,
      isAtl,
    };
  });

  // 6. Stats (same shape as category).
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

  const retailerCounts = new Map<RetailerKey, number>();
  for (const p of productRows ?? []) {
    const cfg = resolveRetailer(p.retailer);
    if (cfg.id === 'unknown') continue;
    retailerCounts.set(cfg.id, (retailerCounts.get(cfg.id) ?? 0) + 1);
  }
  const retailers = [...retailerCounts.entries()]
    .map(([id, count]) => ({ id, name: RETAILERS[id].name, count }))
    .sort((a, b) => b.count - a.count);

  // 7. Sibling brands — case-folded by slug so MSI/Msi/Gigabyte/GIGABYTE
  //    don't appear as duplicate links in the side strip.
  const { data: siblingRows } = await supabase
    .from('canonical_products')
    .select('brand')
    .eq('category', categorySlug)
    .not('brand', 'is', null)
    .not('image_url', 'is', null);

  const siblingMap = new Map<
    string,
    { variants: Map<string, number>; count: number }
  >();
  for (const r of siblingRows ?? []) {
    const b = r.brand as string | null;
    if (!b) continue;
    const slug = brandToSlug(b);
    if (!slug || slug === brandSlug) continue;
    let entry = siblingMap.get(slug);
    if (!entry) {
      entry = { variants: new Map(), count: 0 };
      siblingMap.set(slug, entry);
    }
    entry.variants.set(b, (entry.variants.get(b) ?? 0) + 1);
    entry.count += 1;
  }

  const siblingBrands = [...siblingMap.entries()]
    .filter(([slug, e]) => e.count >= 2 && slug.length >= 2)
    .map(([slug, e]) => {
      const display = [...e.variants.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return { name: display, slug, count: e.count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    categorySlug,
    categoryName: prettifyCategorySlug(categorySlug),
    brandSlug,
    brandName,
    products,
    stats: {
      totalProducts: products.length,
      withPrice: withPrice.length,
      atLowest: atLowestCount,
      avgPrice,
      medianPrice,
      retailers,
    },
    siblingBrands,
  };
}

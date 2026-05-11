'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { ArrowRight, Tag, Check, Flame } from 'lucide-react';
import { RETAILERS } from '@/lib/retailers';
import type {
  CategoryViewModel,
  CategoryProduct,
} from '@/lib/queries/category';

/* Theme helpers */
const C = {
  bg: 'var(--bg-primary)',
  bgCard: 'var(--bg-card)',
  bgSecondary: 'var(--bg-secondary)',
  border: 'var(--border)',
  text: 'var(--text-primary)',
  textDim: 'var(--text-secondary)',
  accent: 'var(--accent)',
  accentGlow: 'var(--accent-glow)',
  danger: 'var(--danger)',
  warning: 'var(--warning)',
};
const FONT_DISPLAY = 'var(--font-sora)';

const fmtPrice = (n: number) =>
  `$${Math.round(n).toLocaleString('en-CA', { maximumFractionDigits: 0 })}`;
const fmtCount = (n: number) => n.toLocaleString('en-CA');

const PAGE_SIZE = 48;

type SortKey =
  | 'deals'
  | 'price-asc'
  | 'price-desc'
  | 'name-asc'
  | 'date-desc'
  | 'date-asc';

/* ---------- Page ---------- */

export default function CategoryPage({
  category,
  entityRoutePrefix = '/p',
}: {
  category: CategoryViewModel;
  /**
   * Where individual product cards link. Defaults to '/p' (v0 canonical_products
   * read path). Migrated verticals pass '/chip', '/cpu', etc. via the route.
   */
  entityRoutePrefix?: string;
}) {
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set());
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('deals');
  const [page, setPage] = useState(1);

  // Reset to page 1 whenever filters or sort change.
  useEffect(() => {
    setPage(1);
  }, [selectedBrands, inStockOnly, sortKey]);

  const filteredProducts = useMemo(() => {
    let list = category.products;

    if (selectedBrands.size > 0) {
      list = list.filter((p) => p.brand && selectedBrands.has(p.brand));
    }
    if (inStockOnly) {
      list = list.filter((p) => p.inStock);
    }

    const withPriceFirst = (
      a: CategoryProduct,
      b: CategoryProduct,
    ): number | null => {
      const ap = a.bestPrice == null;
      const bp = b.bestPrice == null;
      if (ap !== bp) return ap ? 1 : -1;
      return null;
    };

    // Entities with no release_date sink to the end regardless of direction.
    // releaseDate is null on the v0 path (unmigrated categories) and on
    // entity-aware rows where the source didn't supply a date — both should
    // degrade gracefully rather than block the sort.
    const withDateFirst = (
      a: CategoryProduct,
      b: CategoryProduct,
    ): number | null => {
      const ad = a.releaseDate == null;
      const bd = b.releaseDate == null;
      if (ad !== bd) return ad ? 1 : -1;
      return null;
    };

    const sorted = [...list];
    switch (sortKey) {
      case 'price-asc':
        sorted.sort(
          (a, b) =>
            withPriceFirst(a, b) ??
            (a.bestPrice as number) - (b.bestPrice as number),
        );
        break;
      case 'price-desc':
        sorted.sort(
          (a, b) =>
            withPriceFirst(a, b) ??
            (b.bestPrice as number) - (a.bestPrice as number),
        );
        break;
      case 'name-asc':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'date-desc':
        // Newest first. ISO date strings compare lexicographically in date
        // order so localeCompare on the strings is correct. Both-null falls
        // through here (withDateFirst returns null only when both sides have
        // a date OR both are null); guard with a final 0 to keep sort stable
        // across the both-null case.
        sorted.sort((a, b) => {
          const bucketed = withDateFirst(a, b);
          if (bucketed != null) return bucketed;
          if (a.releaseDate == null || b.releaseDate == null) return 0;
          return b.releaseDate.localeCompare(a.releaseDate);
        });
        break;
      case 'date-asc':
        sorted.sort((a, b) => {
          const bucketed = withDateFirst(a, b);
          if (bucketed != null) return bucketed;
          if (a.releaseDate == null || b.releaseDate == null) return 0;
          return a.releaseDate.localeCompare(b.releaseDate);
        });
        break;
      case 'deals':
      default:
        sorted.sort((a, b) => {
          const priced = withPriceFirst(a, b);
          if (priced != null) return priced;
          const aAtl = a.isAtl && a.inStock;
          const bAtl = b.isAtl && b.inStock;
          if (aAtl !== bAtl) return aAtl ? -1 : 1;
          const aDrop =
            a.allTimeHigh && a.bestPrice
              ? (a.allTimeHigh - a.bestPrice) / a.allTimeHigh
              : 0;
          const bDrop =
            b.allTimeHigh && b.bestPrice
              ? (b.allTimeHigh - b.bestPrice) / b.allTimeHigh
              : 0;
          return bDrop - aDrop;
        });
        break;
    }
    return sorted;
  }, [category.products, selectedBrands, inStockOnly, sortKey]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredProducts.length / PAGE_SIZE),
  );
  const safePage = Math.min(page, totalPages);
  const pagedProducts = useMemo(
    () =>
      filteredProducts.slice(
        (safePage - 1) * PAGE_SIZE,
        safePage * PAGE_SIZE,
      ),
    [filteredProducts, safePage],
  );

  const goToPage = (n: number) => {
    const target = Math.max(1, Math.min(totalPages, n));
    setPage(target);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const toggleBrand = (name: string) => {
    setSelectedBrands((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const firstOnPage = (safePage - 1) * PAGE_SIZE + 1;
  const lastOnPage = Math.min(safePage * PAGE_SIZE, filteredProducts.length);

  return (
    <div>
      {/* Breadcrumbs: Home / Category. Matches ARCHITECTURE §7 spec. */}
      <div style={{ borderBottom: `1px solid ${C.border}` }}>
        <div
          className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-1.5 px-4 py-2 text-[11px]"
          style={{ color: C.textDim }}
        >
          <Link
            href="/"
            className="transition-opacity hover:opacity-80"
            style={{ color: C.textDim }}
          >
            Home
          </Link>
          <span style={{ color: C.border }}>/</span>
          <span style={{ color: C.text }}>{category.name}</span>
        </div>
      </div>

      {/* Header + stats */}
      <section style={{ borderBottom: `1px solid ${C.border}` }}>
        <div className="mx-auto max-w-[1400px] px-4 py-6">
          <div
            className="flex items-center gap-2 text-[10px] uppercase tracking-wider"
            style={{ color: C.textDim, fontFamily: FONT_DISPLAY }}
          >
            <Tag className="h-3 w-3" />
            Category
          </div>
          <h1
            className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl"
            style={{ color: C.text, fontFamily: FONT_DISPLAY }}
          >
            {category.name}
          </h1>
          <p className="mt-2 text-sm" style={{ color: C.textDim }}>
            Tracking{' '}
            <span
              className="tabular-nums"
              style={{ color: C.text, fontFamily: FONT_DISPLAY }}
            >
              {fmtCount(category.stats.totalProducts)}
            </span>{' '}
            products across{' '}
            <span
              className="tabular-nums"
              style={{ color: C.text, fontFamily: FONT_DISPLAY }}
            >
              {category.stats.retailers.length}
            </span>{' '}
            Canadian retailers.
          </p>

          {/* Stat strip */}
          <div
            className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md md:grid-cols-4"
            style={{ background: C.border }}
          >
            <Stat
              label="Products"
              value={fmtCount(category.stats.totalProducts)}
            />
            <Stat
              label="Median price"
              value={
                category.stats.medianPrice
                  ? fmtPrice(category.stats.medianPrice)
                  : '-'
              }
            />
            <Stat
              label="Avg price"
              value={
                category.stats.avgPrice
                  ? fmtPrice(category.stats.avgPrice)
                  : '-'
              }
            />
            <Stat
              label="At all-time low"
              value={fmtCount(category.stats.atLowest)}
              tone={category.stats.atLowest > 0 ? 'good' : 'neutral'}
            />
          </div>
        </div>
      </section>

      {/* Brand filter */}
      {category.brands.length > 0 && (
        <section style={{ borderBottom: `1px solid ${C.border}` }}>
          <div className="mx-auto max-w-[1400px] px-4 py-3">
            <div
              className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider"
              style={{ color: C.textDim, fontFamily: FONT_DISPLAY }}
            >
              <span>Brand</span>
              {selectedBrands.size > 0 && (
                <button
                  onClick={() => setSelectedBrands(new Set())}
                  className="transition-opacity hover:opacity-80"
                  style={{
                    color: C.accent,
                    fontFamily: FONT_DISPLAY,
                    textTransform: 'none',
                    letterSpacing: 'normal',
                  }}
                >
                  Clear ({selectedBrands.size})
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {category.brands.slice(0, 40).map((brand) => {
                const active = selectedBrands.has(brand.name);
                return (
                  <button
                    key={brand.name}
                    onClick={() => toggleBrand(brand.name)}
                    className={`filter-pill ${active ? 'active' : ''}`}
                  >
                    <span>{brand.name}</span>
                    <span
                      className="ml-1.5 tabular-nums"
                      style={{
                        color: active ? C.accent : C.textDim,
                        opacity: 0.7,
                      }}
                    >
                      {brand.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Toolbar: filters + sort */}
      <section
        className="sticky z-20 backdrop-blur"
        style={{
          top: 'var(--site-nav-height, 64px)',
          borderBottom: `1px solid ${C.border}`,
          background: 'rgba(6, 9, 15, 0.95)',
        }}
      >
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-2">
          <div className="flex items-center gap-4">
            <label
              className="flex cursor-pointer items-center gap-1.5 text-[11px]"
              style={{ color: C.textDim, fontFamily: FONT_DISPLAY }}
            >
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(e) => setInStockOnly(e.target.checked)}
                className="h-3.5 w-3.5"
                style={{ accentColor: 'var(--accent)' }}
              />
              In stock only
            </label>
            <span
              className="text-[11px] tabular-nums"
              style={{ color: C.textDim, fontFamily: FONT_DISPLAY }}
            >
              {filteredProducts.length === 0
                ? `0 of ${fmtCount(category.products.length)}`
                : `${fmtCount(firstOnPage)}-${fmtCount(lastOnPage)} of ${fmtCount(filteredProducts.length)}`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label
              htmlFor="sort-select"
              className="text-[10px] uppercase tracking-wider"
              style={{ color: C.textDim, fontFamily: FONT_DISPLAY }}
            >
              Sort
            </label>
            <select
              id="sort-select"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="rounded-md px-2 py-1 text-[11px] outline-none transition-colors"
              style={{
                background: C.bgSecondary,
                border: `1px solid ${C.border}`,
                color: C.text,
                fontFamily: FONT_DISPLAY,
              }}
            >
              <option value="deals">Best deals</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
              <option value="name-asc">Name: A to Z</option>
              <option value="date-desc">Release: newest first</option>
              <option value="date-asc">Release: oldest first</option>
            </select>
          </div>
        </div>
      </section>

      {/* Product grid */}
      <section>
        <div className="mx-auto max-w-[1400px] px-4 py-6">
          {filteredProducts.length === 0 ? (
            <div className="py-24 text-center">
              <p className="text-sm" style={{ color: C.textDim }}>
                No products match these filters.
              </p>
              <button
                onClick={() => {
                  setSelectedBrands(new Set());
                  setInStockOnly(false);
                }}
                className="mt-3 text-[11px] transition-opacity hover:opacity-80"
                style={{ color: C.accent, fontFamily: FONT_DISPLAY }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <>
              <div className="grid-products">
                {pagedProducts.map((p) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    entityRoutePrefix={entityRoutePrefix}
                  />
                ))}
              </div>

              {totalPages > 1 && (
                <Pagination
                  page={safePage}
                  totalPages={totalPages}
                  onPrev={() => goToPage(safePage - 1)}
                  onNext={() => goToPage(safePage + 1)}
                  onFirst={() => goToPage(1)}
                  onLast={() => goToPage(totalPages)}
                />
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'good' | 'bad' | 'neutral';
}) {
  const toneColor =
    tone === 'good' ? C.accent : tone === 'bad' ? C.danger : C.text;
  return (
    <div style={{ background: C.bgSecondary }} className="px-3 py-2">
      <div
        className="text-[9px] uppercase tracking-wider"
        style={{ color: C.textDim, fontFamily: FONT_DISPLAY }}
      >
        {label}
      </div>
      <div
        className="mt-0.5 text-sm font-medium tabular-nums"
        style={{ color: toneColor, fontFamily: FONT_DISPLAY }}
      >
        {value}
      </div>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onPrev,
  onNext,
  onFirst,
  onLast,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
  onFirst: () => void;
  onLast: () => void;
}) {
  const btnBase = 'rounded-md px-3 py-1.5 text-[11px] transition-opacity disabled:cursor-not-allowed disabled:opacity-30 hover:opacity-80';
  const btnStyle: React.CSSProperties = {
    background: C.bgSecondary,
    border: `1px solid ${C.border}`,
    color: C.text,
    fontFamily: FONT_DISPLAY,
  };

  return (
    <nav
      aria-label="Pagination"
      className="mt-8 flex items-center justify-center gap-2"
    >
      <button
        type="button"
        onClick={onFirst}
        disabled={page === 1}
        className={btnBase}
        style={btnStyle}
      >
        First
      </button>
      <button
        type="button"
        onClick={onPrev}
        disabled={page === 1}
        className={btnBase}
        style={btnStyle}
      >
        Prev
      </button>
      <span
        className="px-3 text-[11px] tabular-nums"
        style={{ color: C.textDim, fontFamily: FONT_DISPLAY }}
      >
        Page <span style={{ color: C.text }}>{page}</span> of{' '}
        <span style={{ color: C.text }}>{totalPages}</span>
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={page === totalPages}
        className={btnBase}
        style={btnStyle}
      >
        Next
      </button>
      <button
        type="button"
        onClick={onLast}
        disabled={page === totalPages}
        className={btnBase}
        style={btnStyle}
      >
        Last
      </button>
    </nav>
  );
}

function ProductCard({
  product,
  entityRoutePrefix,
}: {
  product: CategoryProduct;
  entityRoutePrefix: string;
}) {
  // Per-card image-load guard. Some entities (datacenter / embedded chips
  // like "RTX 5000 Embedded Ada Generation") have a non-null TPU image URL
  // that 404s; without this state the alt text would render in the image
  // area and bleed product names into the card.
  const [imgFailed, setImgFailed] = useState(false);

  const retailer = product.bestRetailerId
    ? RETAILERS[product.bestRetailerId]
    : null;

  const dropPct =
    product.allTimeHigh &&
    product.bestPrice &&
    product.allTimeHigh > product.bestPrice
      ? Math.round(
          ((product.allTimeHigh - product.bestPrice) / product.allTimeHigh) *
            100,
        )
      : 0;

  const showImage = !!product.imageUrl && !imgFailed;

  return (
    <Link
      href={`${entityRoutePrefix}/${product.slug}`}
      className="card group flex flex-col overflow-hidden"
      style={{ textDecoration: 'none' }}
    >
      {/* Image */}
      <div
        className="relative aspect-[4/3] overflow-hidden"
        style={{
          borderBottom: `1px solid ${C.border}`,
          background: `linear-gradient(135deg, ${C.bgCard}, ${C.bg})`,
        }}
      >
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl as string}
            alt={product.name}
            onError={() => setImgFailed(true)}
            className="h-full w-full object-contain p-4 transition duration-200 group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <div
            className="flex h-full items-center justify-center text-[10px]"
            style={{ color: C.textDim }}
          >
            No image
          </div>
        )}

        {/* Badges */}
        <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
          {product.isAtl && product.inStock && (
            <span
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase backdrop-blur"
              style={{
                background: 'rgba(0, 229, 160, 0.15)',
                border: '1px solid rgba(0, 229, 160, 0.4)',
                color: C.accent,
                fontFamily: FONT_DISPLAY,
              }}
            >
              <Check className="h-2.5 w-2.5" />
              ATL
            </span>
          )}
          {!product.isAtl && dropPct >= 15 && product.inStock && (
            <span
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase backdrop-blur"
              style={{
                background: 'rgba(56, 189, 248, 0.15)',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                color: '#38bdf8',
                fontFamily: FONT_DISPLAY,
              }}
            >
              <Flame className="h-2.5 w-2.5" />
              -{dropPct}%
            </span>
          )}
          {product.isOpenBox && (
            <span
              className="rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase backdrop-blur"
              style={{
                background: 'rgba(245, 158, 11, 0.15)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                color: C.warning,
                fontFamily: FONT_DISPLAY,
              }}
            >
              Open-box
            </span>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div>
          {product.brand && (
            <div
              className="text-[9px] uppercase tracking-wider"
              style={{ color: C.textDim, fontFamily: FONT_DISPLAY }}
            >
              {product.brand}
            </div>
          )}
          <div
            className="mt-0.5 line-clamp-2 text-xs font-medium leading-snug"
            style={{ color: C.text }}
          >
            {product.name}
          </div>
        </div>

        <div className="mt-auto">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className="text-lg font-semibold tabular-nums"
              style={{
                color: product.inStock ? C.accent : C.textDim,
                fontFamily: FONT_DISPLAY,
                textDecoration: product.inStock ? 'none' : 'line-through',
              }}
            >
              {product.bestPrice != null ? fmtPrice(product.bestPrice) : '-'}
            </span>
            {product.allTimeLow != null &&
              product.bestPrice != null &&
              product.bestPrice > product.allTimeLow && (
                <span
                  className="text-[10px] tabular-nums"
                  style={{ color: C.textDim, fontFamily: FONT_DISPLAY }}
                >
                  ATL {fmtPrice(product.allTimeLow)}
                </span>
              )}
          </div>

          <div className="mt-1 flex items-center justify-between">
            <div
              className="flex items-center gap-1.5 text-[10px]"
              style={{ color: C.textDim }}
            >
              {retailer ? (
                <>
                  <span
                    className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm text-[8px] font-semibold"
                    style={{
                      background: retailer.color,
                      color: '#06090f',
                      fontFamily: FONT_DISPLAY,
                    }}
                  >
                    {retailer.short}
                  </span>
                  <span className="truncate">{retailer.name}</span>
                  {product.retailerCount > 1 && (
                    <span style={{ color: C.border }}>
                      +{product.retailerCount - 1}
                    </span>
                  )}
                </>
              ) : (
                <span style={{ color: C.border }}>No retailer</span>
              )}
            </div>
            <ArrowRight
              className="h-3 w-3 transition-colors group-hover:opacity-80"
              style={{ color: C.textDim }}
            />
          </div>
        </div>
      </div>
    </Link>
  );
}

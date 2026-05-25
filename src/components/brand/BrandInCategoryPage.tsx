'use client';

import { useState, useMemo, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Check, Flame, Tag } from 'lucide-react';
import { RETAILERS } from '@/lib/retailers';
import type { BrandInCategoryViewModel } from '@/lib/queries/brand';
import type { CategoryProduct } from '@/lib/queries/category';

/* ── Theme helpers ── */
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

type SortKey = 'deals' | 'price-asc' | 'price-desc' | 'name-asc';

/* ──────────────────────────────────────────────────────────────────────
   Page
   ────────────────────────────────────────────────────────────────────── */

export default function BrandInCategoryPage({
  vm,
  entityRoutePrefix = '/p',
}: {
  vm: BrandInCategoryViewModel;
  /**
   * Where individual product cards link. Defaults to '/p' (v0 canonical_products
   * read path). Migrated verticals pass '/chip', '/cpu', etc. via the route.
   */
  entityRoutePrefix?: string;
}) {
  // Browse state lives in URL search params so back-button, refresh, and
  // sharing all preserve position. Filter/sort changes use router.replace
  // (no history pollution); page changes use router.push (back-button
  // undoes a page click). Defaults (p=1, stock=off, sort=deals) are
  // encoded by absence — canonical URLs stay clean.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const page = Math.max(1, parseInt(searchParams.get('p') ?? '1', 10) || 1);
  const inStockOnly = searchParams.get('stock') === '1';
  const sortKey = (searchParams.get('sort') as SortKey) ?? 'deals';

  const updateUrl = useCallback(
    (
      mutate: (p: URLSearchParams) => void,
      opts: { resetPage?: boolean; push?: boolean } = {},
    ) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      if (opts.resetPage) params.delete('p');
      const qs = params.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (opts.push) router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const filteredProducts = useMemo(() => {
    let list = vm.products;
    if (inStockOnly) list = list.filter((p) => p.inStock);

    const withPriceFirst = (
      a: CategoryProduct,
      b: CategoryProduct,
    ): number | null => {
      const ap = a.bestPrice == null;
      const bp = b.bestPrice == null;
      if (ap !== bp) return ap ? 1 : -1;
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
  }, [vm.products, inStockOnly, sortKey]);

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
    updateUrl(
      (p) => {
        if (target === 1) p.delete('p');
        else p.set('p', String(target));
      },
      { push: true },
    );
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const firstOnPage = (safePage - 1) * PAGE_SIZE + 1;
  const lastOnPage = Math.min(safePage * PAGE_SIZE, filteredProducts.length);

  return (
    <div>
      {/* Breadcrumbs */}
      <div style={{ borderBottom: `1px solid ${C.border}` }}>
        <div
          className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-1.5 px-4 py-2 text-[11px]"
          style={{ color: C.textDim }}
        >
          <Link
            href="/products"
            className="transition-opacity hover:opacity-80"
            style={{ color: C.textDim }}
          >
            All products
          </Link>
          <span style={{ color: C.border }}>/</span>
          <Link
            href={`/c/${vm.categorySlug}`}
            className="transition-opacity hover:opacity-80"
            style={{ color: C.textDim }}
          >
            {vm.categoryName}
          </Link>
          <span style={{ color: C.border }}>/</span>
          <span style={{ color: C.text }}>{vm.brandName}</span>
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
            Brand · {vm.categoryName}
          </div>
          <h1
            className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl"
            style={{ color: C.text, fontFamily: FONT_DISPLAY }}
          >
            {vm.brandName}{' '}
            <span style={{ color: C.textDim, fontWeight: 400 }}>
              {vm.categoryName}
            </span>
          </h1>
          <p className="mt-2 text-sm" style={{ color: C.textDim }}>
            Live Canadian prices for{' '}
            <span
              className="tabular-nums"
              style={{ color: C.text, fontFamily: FONT_DISPLAY }}
            >
              {fmtCount(vm.stats.totalProducts)}
            </span>{' '}
            {vm.brandName} {vm.categoryName.toLowerCase()} across{' '}
            <span
              className="tabular-nums"
              style={{ color: C.text, fontFamily: FONT_DISPLAY }}
            >
              {vm.stats.retailers.length}
            </span>{' '}
            retailers.
          </p>

          {/* Stat strip */}
          <div
            className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md md:grid-cols-4"
            style={{ background: C.border }}
          >
            <Stat label="Products" value={fmtCount(vm.stats.totalProducts)} />
            <Stat
              label="Median price"
              value={vm.stats.medianPrice ? fmtPrice(vm.stats.medianPrice) : '—'}
            />
            <Stat
              label="Avg price"
              value={vm.stats.avgPrice ? fmtPrice(vm.stats.avgPrice) : '—'}
            />
            <Stat
              label="At all-time low"
              value={fmtCount(vm.stats.atLowest)}
              tone={vm.stats.atLowest > 0 ? 'good' : 'neutral'}
            />
          </div>
        </div>
      </section>

      {/* Sibling brands */}
      {vm.siblingBrands.length > 0 && (
        <section style={{ borderBottom: `1px solid ${C.border}` }}>
          <div className="mx-auto max-w-[1400px] px-4 py-3">
            <div
              className="mb-2 text-[10px] uppercase tracking-wider"
              style={{ color: C.textDim, fontFamily: FONT_DISPLAY }}
            >
              Other brands in {vm.categoryName}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Link
                href={`/c/${vm.categorySlug}`}
                className="filter-pill"
                style={{ textDecoration: 'none' }}
              >
                <span>All brands</span>
              </Link>
              {vm.siblingBrands.map((b) => (
                <Link
                  key={b.slug}
                  href={`/c/${vm.categorySlug}/b/${b.slug}`}
                  className="filter-pill"
                  style={{ textDecoration: 'none' }}
                >
                  <span>{b.name}</span>
                  <span
                    className="ml-1.5 tabular-nums"
                    style={{ color: C.textDim, opacity: 0.7 }}
                  >
                    {b.count}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Toolbar */}
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
                onChange={(e) =>
                  updateUrl(
                    (p) => {
                      if (e.target.checked) p.set('stock', '1');
                      else p.delete('stock');
                    },
                    { resetPage: true },
                  )
                }
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
                ? `0 of ${fmtCount(vm.products.length)}`
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
              onChange={(e) => {
                const v = e.target.value;
                updateUrl(
                  (p) => {
                    if (v === 'deals') p.delete('sort');
                    else p.set('sort', v);
                  },
                  { resetPage: true },
                );
              }}
              className="rounded-md px-2 py-1 text-[11px] outline-none"
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
                onClick={() =>
                  updateUrl((p) => p.delete('stock'), { resetPage: true })
                }
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

/* ── Sub-components ── */

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
  const btnBase =
    'rounded-md px-3 py-1.5 text-[11px] transition-opacity disabled:cursor-not-allowed disabled:opacity-30 hover:opacity-80';
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
  // Per-card image-load guard. Some entities have a non-null image URL
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
              <Flame className="h-2.5 w-2.5" />−{dropPct}%
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
              {product.bestPrice != null ? fmtPrice(product.bestPrice) : '—'}
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
                      · +{product.retailerCount - 1}
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

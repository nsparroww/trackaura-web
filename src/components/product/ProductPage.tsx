'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';
import {
  Bell,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  TrendingDown,
  TrendingUp,
  Minus,
  Check,
  X,
  ArrowRight,
  Activity,
} from 'lucide-react';
import type {
  ProductViewModel,
  RetailerSnapshot,
} from '@/lib/queries/product';
import type { ChipParentData } from '@/lib/queries/enrichment';
import type { RetailerKey, RetailerConfig } from '@/lib/retailers';
import PriceAlertModal from '@/components/product/PriceAlertModal';
import ChipParentSection from '@/components/product/ChipParentSection';

/* ────────────────────────────────────────────────────────────────────────
   Theme
   ──────────────────────────────────────────────────────────────────────── */

const C = {
  bg: 'var(--bg-primary)',
  bgCard: 'var(--bg-card)',
  bgSecondary: 'var(--bg-secondary)',
  border: 'var(--border)',
  text: 'var(--text-primary)',
  textDim: 'var(--text-secondary)',
  accent: 'var(--accent)',
  accentDim: 'var(--accent-dim)',
  accentGlow: 'var(--accent-glow)',
  danger: 'var(--danger)',
  warning: 'var(--warning)',
};
const FONT_DISPLAY = 'var(--font-sora)';

/* ────────────────────────────────────────────────────────────────────────
   Formatters
   ──────────────────────────────────────────────────────────────────────── */

const fmtPrice = (n: number) =>
  `$${Math.round(n).toLocaleString('en-CA', { maximumFractionDigits: 0 })}`;

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
  });

const fmtFullDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

const fmtChecked = (iso: string | null): string => {
  if (!iso) return '—';
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = 60_000,
    hr = 60 * min;
  if (diff < hr) return `${Math.max(1, Math.round(diff / min))}m ago`;
  if (diff < 24 * hr) return `${Math.round(diff / hr)}h ago`;
  return `${Math.round(diff / (24 * hr))}d ago`;
};

/* ────────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────────── */

/** Most recent retailer-side `last_updated` across all listings. */
function lastVerifiedAt(retailers: RetailerSnapshot[]): string | null {
  const ts = retailers
    .map((r) => (r.lastUpdated ? new Date(r.lastUpdated).getTime() : 0))
    .reduce((a, b) => Math.max(a, b), 0);
  return ts ? new Date(ts).toISOString() : null;
}

/* ────────────────────────────────────────────────────────────────────────
   Small components
   ──────────────────────────────────────────────────────────────────────── */

function RetailerBadge({
  retailer,
  size = 20,
}: {
  retailer: RetailerConfig;
  size?: number;
}) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-sm font-semibold"
      style={{
        background: retailer.color,
        color: '#06090f',
        width: size,
        height: size,
        fontSize: Math.max(9, size * 0.45),
        fontFamily: FONT_DISPLAY,
      }}
    >
      {retailer.short}
    </span>
  );
}

function DeltaPill({
  delta,
  pct,
  compact = false,
}: {
  delta: number;
  pct: number;
  compact?: boolean;
}) {
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.5) {
    return (
      <span
        className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] tabular-nums"
        style={{
          background: 'rgba(255,255,255,0.04)',
          color: C.textDim,
          fontFamily: FONT_DISPLAY,
        }}
      >
        <Minus className="h-3 w-3" /> 0.00%
      </span>
    );
  }
  const down = delta < 0;
  const color = down ? C.accent : C.danger;
  const bg = down ? 'rgba(0, 229, 160, 0.1)' : 'rgba(239, 68, 68, 0.1)';
  const Icon = down ? TrendingDown : TrendingUp;
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] tabular-nums"
      style={{ background: bg, color, fontFamily: FONT_DISPLAY }}
    >
      <Icon className="h-3 w-3" />
      {down ? '' : '+'}
      {fmtPrice(delta)}
      {compact
        ? ''
        : ` (${pct > 0 ? '+' : ''}${Number.isFinite(pct) ? pct.toFixed(2) : '0.00'}%)`}
    </span>
  );
}

function ProductImage({
  src,
  alt,
  size,
}: {
  src: string | null;
  alt: string;
  size: number | 'full';
}) {
  const style =
    size === 'full'
      ? undefined
      : {
          width: size,
          height: size,
          background: C.bgSecondary,
          border: `1px solid ${C.border}`,
        };
  const imgClass =
    size === 'full'
      ? 'h-full w-full object-contain'
      : 'h-full w-full rounded-md object-contain p-1';

  if (src) {
    return (
      <div
        className="flex shrink-0 items-center justify-center overflow-hidden rounded-md"
        style={style}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className={imgClass} loading="lazy" />
      </div>
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-md"
      style={{
        ...style,
        background: `linear-gradient(135deg, ${C.bgCard}, ${C.bg})`,
      }}
    >
      <svg viewBox="0 0 64 40" className="opacity-30" style={{ width: '60%' }}>
        <rect x="2" y="8" width="60" height="24" rx="2" fill={C.textDim} opacity="0.3" />
        <rect x="6" y="12" width="20" height="16" rx="1" fill={C.accent} opacity="0.5" />
        <circle cx="16" cy="20" r="4" fill={C.bg} />
      </svg>
    </div>
  );
}

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

/* ────────────────────────────────────────────────────────────────────────
   Sections
   ──────────────────────────────────────────────────────────────────────── */

function Breadcrumbs({
  crumbs,
  title,
}: {
  crumbs: ProductViewModel['breadcrumbs'];
  title: string;
}) {
  if (crumbs.length === 0) return null;
  return (
    <div style={{ borderBottom: `1px solid ${C.border}` }}>
      <div
        className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-1.5 px-4 py-2 text-[11px]"
        style={{ color: C.textDim }}
      >
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <a
              href={c.href}
              className="transition-opacity hover:opacity-80"
              style={{ color: C.textDim }}
            >
              {c.label}
            </a>
            <span style={{ color: C.border }}>/</span>
          </span>
        ))}
        <span className="truncate" style={{ color: C.text }}>
          {title}
        </span>
      </div>
    </div>
  );
}

function StickyPriceBar({
  product,
  visible,
  onOpenAlert,
}: {
  product: ProductViewModel;
  visible: boolean;
  onOpenAlert: () => void;
}) {
  const best = product.stats.current;
  const bestRetailer =
    product.retailers.find((r) => r.id === product.stats.currentRetailerId) ??
    null;
  const prev = bestRetailer?.prev24hPrice ?? null;
  const delta = prev != null && best ? best - prev : 0;
  const pct = prev ? (delta / prev) * 100 : 0;

  return (
    <div
      className={`fixed left-0 right-0 z-30 backdrop-blur-md transition-transform duration-200 ${
        visible ? 'translate-y-0' : '-translate-y-full'
      }`}
      style={{
        top: 'var(--site-nav-height, 64px)',
        background: 'rgba(6, 9, 15, 0.9)',
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-2">
        <ProductImage src={product.imageUrl} alt={product.title} size={36} />
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-xs font-medium"
            style={{ color: C.text }}
          >
            {product.title}
          </div>
          <div
            className="flex items-center gap-2 text-[10px]"
            style={{ color: C.textDim }}
          >
            <span>{product.brand}</span>
            {bestRetailer && (
              <>
                <span style={{ color: C.border }}>·</span>
                <span>{bestRetailer.name}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <span
            className="text-xl font-semibold tabular-nums"
            style={{ color: C.text, fontFamily: FONT_DISPLAY }}
          >
            {best ? fmtPrice(best) : '—'}
          </span>
          {prev != null && <DeltaPill delta={delta} pct={pct} compact />}
        </div>
        <button onClick={onOpenAlert} className="btn-primary">
          <Bell className="h-3.5 w-3.5" style={{ marginRight: 6 }} />
          Set Alert
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Hero — identity-first.

   Catalog framing changes vs the previous draft:
   - H1 is now the visual headline (text-3xl → md:text-5xl), price demoted
     from text-4xl to text-3xl/md:text-4xl
   - "Best Canadian Price" eyebrow → "Lowest listed" (fact, not verdict)
   - "All-time Low" badge removed — catalog doesn't pass deal verdicts
   - Stat grid replaced: was (MSRP, vs ATL, vs Median, ATH) — half were
     verdict tiles. Now (MSRP, Observed range, Retailers, Last verified) —
     all factual catalog signals
   - Watch / Share buttons removed — Amazon-feature noise
   - Set Price Alert is the only CTA
   ──────────────────────────────────────────────────────────────────────── */
function Hero({
  product,
  heroRef,
  onOpenAlert,
}: {
  product: ProductViewModel;
  heroRef: React.RefObject<HTMLDivElement | null>;
  onOpenAlert: () => void;
}) {
  const best = product.stats.current;
  const bestRetailer =
    product.retailers.find((r) => r.id === product.stats.currentRetailerId) ??
    null;
  const prev = bestRetailer?.prev24hPrice ?? null;
  const delta = prev != null && best ? best - prev : 0;
  const pct = prev ? (delta / prev) * 100 : 0;

  const rangeLabel =
    product.stats.atl > 0 && product.stats.ath > 0
      ? `${fmtPrice(product.stats.atl)}–${fmtPrice(product.stats.ath)}`
      : '—';
  const lastVerified = lastVerifiedAt(product.retailers);

  return (
    <section
      ref={heroRef}
      style={{ borderBottom: `1px solid ${C.border}` }}
    >
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[1fr_1.1fr]">
        {/* Image */}
        <div
          className="relative overflow-hidden rounded-xl"
          style={{
            background: `linear-gradient(135deg, ${C.bgCard}, ${C.bg})`,
            border: `1px solid ${C.border}`,
          }}
        >
          <div className="flex aspect-[4/3] items-center justify-center p-6">
            <ProductImage src={product.imageUrl} alt={product.title} size="full" />
          </div>
        </div>

        {/* Info */}
        <div className="flex flex-col gap-4">
          <div>
            <div
              className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider"
              style={{ color: C.textDim, fontFamily: FONT_DISPLAY }}
            >
              <span>{product.brand}</span>
              <span style={{ color: C.border }}>·</span>
              <span>{product.category}</span>
              {product.sku && (
                <>
                  <span style={{ color: C.border }}>·</span>
                  <span>SKU {product.sku}</span>
                </>
              )}
            </div>
            <h1
              className="mt-1 text-3xl font-semibold tracking-tight md:text-5xl"
              style={{ color: C.text, fontFamily: FONT_DISPLAY }}
            >
              {product.title}
            </h1>
            {product.blurb && (
              <p
                className="mt-3 max-w-2xl text-sm leading-relaxed"
                style={{ color: C.textDim }}
              >
                {product.blurb}
              </p>
            )}
          </div>

          {/* Price card */}
          <div className="card p-4">
            <div>
              <div
                className="flex items-center gap-2 text-[10px] uppercase tracking-wider"
                style={{ color: C.textDim, fontFamily: FONT_DISPLAY }}
              >
                <Activity className="h-3 w-3" />
                Lowest listed
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-3">
                <span
                  className="text-3xl font-semibold tabular-nums md:text-4xl"
                  style={{ color: C.accent, fontFamily: FONT_DISPLAY }}
                >
                  {best ? fmtPrice(best) : '—'}
                </span>
                <span className="text-xs" style={{ color: C.textDim }}>
                  CAD
                </span>
                {prev != null && <DeltaPill delta={delta} pct={pct} />}
              </div>
              {bestRetailer ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <RetailerBadge retailer={bestRetailer} size={16} />
                  <span style={{ color: C.text }}>{bestRetailer.name}</span>
                  <span style={{ color: C.border }}>·</span>
                  <span
                    className="inline-flex items-center gap-1"
                    style={{ color: C.accent }}
                  >
                    <Check className="h-3 w-3" /> In stock
                  </span>
                  <span style={{ color: C.border }}>·</span>
                  <span style={{ color: C.textDim }}>
                    Checked {fmtChecked(bestRetailer.lastUpdated)}
                  </span>
                </div>
              ) : (
                <div className="mt-2 text-xs" style={{ color: C.textDim }}>
                  Not currently in stock at any tracked retailer.
                </div>
              )}
            </div>

            {/* Catalog-facts tiles. Replaces vs-ATL / vs-Median verdict
                tiles with neutral observations. All four use existing
                ViewModel data — no query changes. */}
            <div
              className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md md:grid-cols-4"
              style={{ background: C.border }}
            >
              <Stat
                label="MSRP"
                value={product.msrp ? fmtPrice(product.msrp) : '—'}
              />
              <Stat label="Observed range" value={rangeLabel} />
              <Stat
                label="Retailers"
                value={String(product.retailers.length)}
              />
              <Stat
                label="Last verified"
                value={fmtChecked(lastVerified)}
              />
            </div>

            {/* CTAs — alert is the one durable user action on a catalog
                page. Watch / Share were Amazon-feature noise; cut. */}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={onOpenAlert}
                className="btn-primary flex items-center gap-2"
              >
                <Bell className="h-4 w-4" />
                Set Price Alert
              </button>
            </div>
          </div>

          {/* Retailer quick links — fast-scan zone in the hero.
              Full table is below in ComparisonTable. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {product.retailers.map((r) => (
              <a
                key={r.productId}
                href={r.url ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="card group flex items-center justify-between px-3 py-2"
                style={{ borderRadius: 8 }}
              >
                <div className="flex items-center gap-2">
                  <RetailerBadge retailer={r} size={20} />
                  <span className="text-xs" style={{ color: C.text }}>
                    {r.name}
                    {r.isOpenBox && (
                      <span
                        className="ml-1 rounded px-1 py-0.5 text-[8px] font-semibold uppercase"
                        style={{
                          background: 'rgba(245, 158, 11, 0.1)',
                          border: '1px solid rgba(245, 158, 11, 0.3)',
                          color: C.warning,
                          fontFamily: FONT_DISPLAY,
                        }}
                      >
                        Open-box
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="text-xs font-medium tabular-nums"
                    style={{
                      color: r.inStock ? C.text : C.textDim,
                      fontFamily: FONT_DISPLAY,
                      textDecoration: r.inStock ? 'none' : 'line-through',
                    }}
                  >
                    {r.price != null ? fmtPrice(r.price) : 'OOS'}
                  </span>
                  <ExternalLink
                    className="h-3.5 w-3.5 transition-colors group-hover:opacity-80"
                    style={{ color: C.textDim }}
                  />
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Specs — flat, all groups visible.

   Catalog data IS identity. The previous accordion (closed-by-default
   for groups beyond the first two) hid the very thing the page exists
   to convey. Two-column dense layout, all rows visible, no toggling.
   ──────────────────────────────────────────────────────────────────────── */
function Specs({ product }: { product: ProductViewModel }) {
  if (product.specs.length === 0) return null;

  return (
    <section style={{ borderBottom: `1px solid ${C.border}` }}>
      <div className="mx-auto max-w-[1400px] px-4 py-6">
        <div className="mb-4">
          <div
            className="text-[10px] uppercase tracking-wider"
            style={{ color: C.textDim, fontFamily: FONT_DISPLAY }}
          >
            Specifications
          </div>
          <h2
            className="text-lg font-semibold"
            style={{ color: C.text, fontFamily: FONT_DISPLAY }}
          >
            Technical details
          </h2>
        </div>
        <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
          {product.specs.map((g) => (
            <div key={g.group}>
              <h3
                className="mb-2 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: C.text, fontFamily: FONT_DISPLAY }}
              >
                {g.group}
              </h3>
              <dl
                className="overflow-hidden rounded-md"
                style={{
                  border: `1px solid ${C.border}`,
                  background: C.bgCard,
                }}
              >
                {g.items.map(([k, v], idx) => (
                  <div
                    key={k}
                    className="flex items-baseline justify-between gap-4 px-3 py-1.5 text-xs"
                    style={{
                      borderTop: idx > 0 ? `1px solid ${C.border}` : 'none',
                    }}
                  >
                    <dt style={{ color: C.textDim }}>{k}</dt>
                    <dd
                      className="text-right tabular-nums"
                      style={{
                        color: C.text,
                        fontFamily: FONT_DISPLAY,
                      }}
                    >
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Price history chart — UNCHANGED structurally.
   ──────────────────────────────────────────────────────────────────────── */
function PriceChart({ product }: { product: ProductViewModel }) {
  const [range, setRange] = useState<30 | 90 | 365>(90);
  const [focus, setFocus] = useState<'all' | RetailerKey>('all');

  // Mount gate prevents Recharts from measuring dimensions during SSR
  // (would otherwise emit `width(-1) height(-1)` warning at build time
  // and produce a first-paint glitch at runtime).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const hasHistory = product.priceHistory.length > 0;
  const data = useMemo(
    () => product.priceHistory.slice(-range),
    [product.priceHistory, range],
  );

  const activeRetailerIds = useMemo<RetailerKey[]>(
    () => (focus === 'all' ? product.retailers.map((r) => r.id) : [focus]),
    [focus, product.retailers],
  );

  const rangeMedian = useMemo(() => {
    const vals: number[] = [];
    data.forEach((row) => {
      activeRetailerIds.forEach((id) => {
        const v = (row as Record<string, unknown>)[id];
        if (typeof v === 'number') vals.push(v);
      });
    });
    if (vals.length === 0) return 0;
    const s = [...vals].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }, [data, activeRetailerIds]);

  const [yMin, yMax] = useMemo<[number, number]>(() => {
    const vals: number[] = [];
    data.forEach((row) => {
      activeRetailerIds.forEach((id) => {
        const v = (row as Record<string, unknown>)[id];
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) vals.push(v);
      });
    });
    if (vals.length === 0) return [0, 100];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = Math.max(20, (max - min) * 0.1);
    return [
      Math.max(0, Math.floor((min - pad) / 10) * 10),
      Math.ceil((max + pad) / 10) * 10,
    ];
  }, [data, activeRetailerIds]);

  const focusLabel =
    focus === 'all'
      ? `All retailers`
      : product.retailers.find((r) => r.id === focus)?.name ?? 'Retailer';

  return (
    <section style={{ borderBottom: `1px solid ${C.border}` }}>
      <div className="mx-auto max-w-[1400px] px-4 py-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div
              className="flex items-center gap-2 text-[10px] uppercase tracking-wider"
              style={{ color: C.textDim, fontFamily: FONT_DISPLAY }}
            >
              <Activity className="h-3 w-3" />
              Price History
            </div>
            <h2
              className="mt-1 text-lg font-semibold"
              style={{ color: C.text, fontFamily: FONT_DISPLAY }}
            >
              {range}-day history · {focusLabel}
            </h2>
          </div>
          <div
            className="flex rounded-md p-0.5 text-[11px]"
            style={{
              border: `1px solid ${C.border}`,
              background: C.bgSecondary,
              fontFamily: FONT_DISPLAY,
            }}
          >
            {([30, 90, 365] as const).map((d) => (
              <button
                key={d}
                onClick={() => setRange(d)}
                className="rounded px-2.5 py-1 transition"
                style={{
                  background: range === d ? C.bgCard : 'transparent',
                  color: range === d ? C.text : C.textDim,
                }}
              >
                {d}D
              </button>
            ))}
          </div>
        </div>

        {/* Focus segmented control */}
        <div
          className="mb-3 flex flex-wrap gap-1 rounded-md p-1 text-xs"
          style={{
            border: `1px solid ${C.border}`,
            background: C.bgSecondary,
          }}
        >
          <button
            onClick={() => setFocus('all')}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 transition"
            style={{
              background: focus === 'all' ? C.bgCard : 'transparent',
              color: focus === 'all' ? C.text : C.textDim,
            }}
          >
            <span className="flex gap-0.5">
              {product.retailers.map((r) => (
                <span
                  key={r.id}
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: r.color }}
                />
              ))}
            </span>
            All retailers
          </button>
          {product.retailers.length > 1 && (
            <div
              className="mx-1 my-1 w-px"
              style={{ background: C.border }}
            />
          )}
          {product.retailers.map((r) => {
            const isActive = focus === r.id;
            return (
              <button
                key={r.id}
                onClick={() => setFocus(r.id)}
                className="flex items-center gap-2 rounded px-3 py-1.5 transition"
                style={{
                  background: isActive ? C.bgCard : 'transparent',
                  color: isActive ? C.text : C.textDim,
                }}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: r.color }}
                />
                <span>{r.name}</span>
                {r.price != null && (
                  <span
                    className="text-[10px] tabular-nums"
                    style={{
                      color: C.textDim,
                      fontFamily: FONT_DISPLAY,
                    }}
                  >
                    {fmtPrice(r.price)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Chart */}
        <div
          className="rounded-lg p-2"
          style={{
            background: C.bgCard,
            border: `1px solid ${C.border}`,
          }}
        >
          <div className="h-[340px] w-full">
            {hasHistory && mounted ? (
              <ResponsiveContainer>
                <LineChart
                  data={data}
                  margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    stroke={C.border}
                    strokeDasharray="2 4"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    stroke={C.textDim}
                    fontSize={10}
                    tick={{ fill: C.textDim }}
                    tickFormatter={fmtDate}
                    tickLine={false}
                    axisLine={{ stroke: C.border }}
                    minTickGap={40}
                  />
                  <YAxis
                    stroke={C.textDim}
                    fontSize={10}
                    tick={{ fill: C.textDim }}
                    tickFormatter={(v) => `$${v}`}
                    tickLine={false}
                    axisLine={{ stroke: C.border }}
                    width={60}
                    domain={[yMin, yMax]}
                    allowDataOverflow={false}
                  />
                  <Tooltip
                    content={<ChartTooltip retailers={product.retailers} />}
                    cursor={{ stroke: C.textDim, strokeDasharray: '3 3' }}
                  />
                  {rangeMedian > 0 && (
                    <ReferenceLine
                      y={rangeMedian}
                      stroke={C.textDim}
                      strokeDasharray="2 6"
                      label={{
                        value: `Median ${fmtPrice(rangeMedian)}`,
                        position: 'insideBottomLeft',
                        fill: C.textDim,
                        fontSize: 10,
                        fontFamily: 'monospace',
                      }}
                    />
                  )}
                  {product.retailers.map(
                    (r) =>
                      activeRetailerIds.includes(r.id) && (
                        <Line
                          key={r.id}
                          type="monotone"
                          dataKey={r.id}
                          stroke={r.color}
                          strokeWidth={focus === r.id ? 2 : 1.5}
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 0 }}
                          connectNulls
                        />
                      ),
                  )}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div
                className="flex h-full items-center justify-center text-xs"
                style={{ color: C.textDim }}
              >
                No price history recorded yet. Check back soon.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  retailers,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; color: string }>;
  label?: string;
  retailers: RetailerSnapshot[];
}) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div
      className="rounded-md px-3 py-2 text-[11px] shadow-xl backdrop-blur"
      style={{
        background: 'rgba(6, 9, 15, 0.95)',
        border: `1px solid ${C.border}`,
        fontFamily: FONT_DISPLAY,
      }}
    >
      <div className="mb-1 text-[10px]" style={{ color: C.textDim }}>
        {label ? fmtDate(label) : ''}
      </div>
      {payload
        .sort((a, b) => a.value - b.value)
        .map((p) => {
          const r = retailers.find((x) => x.id === p.dataKey);
          return (
            <div
              key={p.dataKey}
              className="flex items-center justify-between gap-4"
            >
              <span
                className="flex items-center gap-1.5"
                style={{ color: C.text }}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: p.color }}
                />
                {r?.name ?? p.dataKey}
              </span>
              <span className="tabular-nums" style={{ color: C.text }}>
                {fmtPrice(p.value)}
              </span>
            </div>
          );
        })}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Comparison table — heading reframed; structure unchanged.
   "Live price comparison" was deals-y. "Retailer prices" is the
   neutral catalog statement of the same thing.
   ──────────────────────────────────────────────────────────────────────── */
function ComparisonTable({ product }: { product: ProductViewModel }) {
  type SortKey = 'price' | 'change' | 'retailer' | 'checked';
  const [sortKey, setSortKey] = useState<SortKey>('price');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const rows = useMemo(() => {
    const enriched = product.retailers.map((r) => {
      const change =
        r.price != null && r.prev24hPrice != null ? r.price - r.prev24hPrice : 0;
      return { ...r, change };
    });
    enriched.sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      if (sortKey === 'price') {
        av = a.price ?? Infinity;
        bv = b.price ?? Infinity;
      } else if (sortKey === 'change') {
        av = a.change;
        bv = b.change;
      } else if (sortKey === 'retailer') {
        av = a.name;
        bv = b.name;
      } else {
        av = a.lastUpdated ? -new Date(a.lastUpdated).getTime() : Infinity;
        bv = b.lastUpdated ? -new Date(b.lastUpdated).getTime() : Infinity;
      }
      const dir = sortDir === 'asc' ? 1 : -1;
      return av < bv ? -dir : av > bv ? dir : 0;
    });
    return enriched;
  }, [product.retailers, sortKey, sortDir]);

  const toggle = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(k);
      setSortDir(k === 'price' ? 'asc' : 'desc');
    }
  };

  const SortBtn = ({
    k,
    children,
    align = 'left',
  }: {
    k: SortKey;
    children: React.ReactNode;
    align?: 'left' | 'right';
  }) => (
    <button
      onClick={() => toggle(k)}
      className="flex w-full items-center gap-1 text-[10px] uppercase tracking-wider transition-opacity hover:opacity-80"
      style={{
        color: C.textDim,
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        fontFamily: FONT_DISPLAY,
      }}
    >
      {children}
      {sortKey === k &&
        (sortDir === 'asc' ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        ))}
    </button>
  );

  return (
    <section style={{ borderBottom: `1px solid ${C.border}` }}>
      <div className="mx-auto max-w-[1400px] px-4 py-6">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div
              className="text-[10px] uppercase tracking-wider"
              style={{ color: C.textDim, fontFamily: FONT_DISPLAY }}
            >
              Listings
            </div>
            <h2
              className="text-lg font-semibold"
              style={{ color: C.text, fontFamily: FONT_DISPLAY }}
            >
              Retailer prices
            </h2>
          </div>
          <span
            className="text-[10px]"
            style={{ color: C.textDim, fontFamily: FONT_DISPLAY }}
          >
            Prices in CAD
          </span>
        </div>
        <div
          className="overflow-hidden rounded-lg"
          style={{ border: `1px solid ${C.border}` }}
        >
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr style={{ background: C.bgSecondary, borderBottom: `1px solid ${C.border}` }}>
                <th className="px-3 py-2 text-left">
                  <SortBtn k="retailer">Retailer</SortBtn>
                </th>
                <th className="px-3 py-2 text-right">
                  <SortBtn k="price" align="right">Price</SortBtn>
                </th>
                <th className="px-3 py-2 text-right">
                  <SortBtn k="change" align="right">24h Change</SortBtn>
                </th>
                <th
                  className="px-3 py-2 text-left text-[10px] uppercase tracking-wider"
                  style={{ color: C.textDim, fontFamily: FONT_DISPLAY }}
                >
                  Stock
                </th>
                <th className="px-3 py-2 text-right">
                  <SortBtn k="checked" align="right">Checked</SortBtn>
                </th>
                <th className="w-16 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pct =
                  r.prev24hPrice && r.prev24hPrice > 0
                    ? (r.change / r.prev24hPrice) * 100
                    : 0;
                const isBest =
                  r.id === product.stats.currentRetailerId && r.inStock;
                return (
                  <tr
                    key={r.productId}
                    className="transition"
                    style={{
                      borderBottom: `1px solid ${C.border}`,
                      background: isBest ? 'rgba(0, 229, 160, 0.03)' : 'transparent',
                    }}
                  >
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <RetailerBadge retailer={r} size={24} />
                        <span
                          className="font-medium"
                          style={{ color: C.text }}
                        >
                          {r.name}
                        </span>
                        {r.isOpenBox && (
                          <span
                            className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase"
                            style={{
                              background: 'rgba(245, 158, 11, 0.1)',
                              border: '1px solid rgba(245, 158, 11, 0.3)',
                              color: C.warning,
                              fontFamily: FONT_DISPLAY,
                            }}
                          >
                            Open-box
                          </span>
                        )}
                        {isBest && (
                          <span
                            className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase"
                            style={{
                              background: 'rgba(0, 229, 160, 0.1)',
                              border: '1px solid rgba(0, 229, 160, 0.3)',
                              color: C.accent,
                              fontFamily: FONT_DISPLAY,
                            }}
                          >
                            Lowest
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span
                        className="text-base font-medium tabular-nums"
                        style={{
                          color: r.inStock ? C.text : C.textDim,
                          fontFamily: FONT_DISPLAY,
                          textDecoration: r.inStock ? 'none' : 'line-through',
                        }}
                      >
                        {r.price != null ? fmtPrice(r.price) : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex justify-end">
                        {r.prev24hPrice != null ? (
                          <DeltaPill delta={r.change} pct={pct} />
                        ) : (
                          <span
                            className="text-[10px]"
                            style={{
                              color: C.textDim,
                              fontFamily: FONT_DISPLAY,
                            }}
                          >
                            —
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {r.inStock ? (
                        <span
                          className="inline-flex items-center gap-1 text-[11px]"
                          style={{
                            color: C.accent,
                            fontFamily: FONT_DISPLAY,
                          }}
                        >
                          <Check className="h-3 w-3" /> In stock
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 text-[11px]"
                          style={{
                            color: C.danger,
                            fontFamily: FONT_DISPLAY,
                          }}
                        >
                          <X className="h-3 w-3" /> Out of stock
                        </span>
                      )}
                    </td>
                    <td
                      className="px-3 py-3 text-right text-[11px] tabular-nums"
                      style={{
                        color: C.textDim,
                        fontFamily: FONT_DISPLAY,
                      }}
                    >
                      {fmtChecked(r.lastUpdated)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {r.url && (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-secondary inline-flex items-center gap-1 !px-2 !py-1 !text-[11px]"
                        >
                          View <ArrowRight className="h-3 w-3" />
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Provenance footer — NEW.

   Catalog-trust signals derived entirely from existing ViewModel data.
   No query changes; richer provenance (entity_source_mappings, true
   first-seen pre-365d window, raw observation count) lands in the
   ViewModel pass that follows.
   ──────────────────────────────────────────────────────────────────────── */
function ProvenanceFooter({ product }: { product: ProductViewModel }) {
  const lastVerified = lastVerifiedAt(product.retailers);
  const firstObs = product.priceHistory[0]?.date ?? null;
  const obsDays = product.priceHistory.length;
  const sources = product.retailers.map((r) => r.name);

  return (
    <section style={{ borderBottom: `1px solid ${C.border}` }}>
      <div className="mx-auto max-w-[1400px] px-4 py-6">
        <div className="mb-3">
          <div
            className="text-[10px] uppercase tracking-wider"
            style={{ color: C.textDim, fontFamily: FONT_DISPLAY }}
          >
            Catalog Provenance
          </div>
          <h2
            className="text-lg font-semibold"
            style={{ color: C.text, fontFamily: FONT_DISPLAY }}
          >
            Where this data comes from
          </h2>
        </div>
        <dl
          className="grid gap-px overflow-hidden rounded-lg sm:grid-cols-2 lg:grid-cols-4"
          style={{ background: C.border }}
        >
          <ProvItem
            label="Tracked retailers"
            value={String(sources.length)}
            sub={sources.join(', ')}
          />
          <ProvItem
            label="First observation"
            value={firstObs ? fmtFullDate(firstObs) : '—'}
            sub="within last 365 days"
          />
          <ProvItem
            label="Last verified"
            value={fmtChecked(lastVerified)}
            sub={
              lastVerified
                ? new Date(lastVerified).toLocaleString('en-CA')
                : null
            }
          />
          <ProvItem
            label="Days of price data"
            value={String(obsDays)}
            sub="distinct dates with at least one observation"
          />
        </dl>
      </div>
    </section>
  );
}

function ProvItem({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string | null;
}) {
  return (
    <div className="px-4 py-3" style={{ background: C.bgCard }}>
      <div
        className="text-[9px] uppercase tracking-wider"
        style={{ color: C.textDim, fontFamily: FONT_DISPLAY }}
      >
        {label}
      </div>
      <dd
        className="mt-1 text-sm font-medium tabular-nums"
        style={{ color: C.text, fontFamily: FONT_DISPLAY }}
      >
        {value}
      </dd>
      {sub && (
        <div
          className="mt-1 text-[10px] leading-snug"
          style={{ color: C.textDim }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Page wrapper

   New section order (catalog-frame):

     StickyPriceBar
     Breadcrumbs
     Hero              — identity-first
     ChipParentSection — identity context (GPU pages only)
     Specs             — catalog data (was at bottom in an accordion)
     PriceChart        — observations
     ComparisonTable   — listings
     ProvenanceFooter  — trust signals (new)

   Diff vs previous draft, summarized:
     - Specs moved from bottom to right after identity. Catalog data IS
       identity; it does not belong below price observations.
     - ActivityFeed cut entirely. "Dropped from $X to $Y" was a deals-site
       framing of what the chart already shows.
     - Watch / Share buttons cut. Set-Alert is the single CTA.
     - Hero H1 promoted (md:text-5xl), price demoted (md:text-4xl). The
       canonical name is the headline; price is one of its observations.
     - "Best Canadian Price" eyebrow → "Lowest listed".
     - Verdict tiles (vs ATL, vs Median) → fact tiles (Observed range,
       Retailers, Last verified).
     - "All-time Low" badge removed.
     - Sticky-bar "Best at X" → just "X".
     - ComparisonTable header: "Live price comparison" → "Retailer prices".
     - "Best" cell badge → "Lowest" (descriptive, not deal-flavored).
     - ProvenanceFooter added (existing data, no query changes).
   ──────────────────────────────────────────────────────────────────────── */

export default function ProductPage({
  product,
  chipParent,
}: {
  product: ProductViewModel;
  chipParent?: ChipParentData | null;
}) {
  const heroRef = useRef<HTMLDivElement>(null);
  const [stickyVisible, setStickyVisible] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);

  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setStickyVisible(!entry.isIntersecting),
      { rootMargin: '0px 0px 0px 0px', threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const bestRetailer =
    product.retailers.find((r) => r.id === product.stats.currentRetailerId) ??
    null;

  const openAlert = () => setAlertOpen(true);

  return (
    <div>
      <StickyPriceBar
        product={product}
        visible={stickyVisible}
        onOpenAlert={openAlert}
      />
      <Breadcrumbs crumbs={product.breadcrumbs} title={product.title} />
      <Hero product={product} heroRef={heroRef} onOpenAlert={openAlert} />
      {chipParent && <ChipParentSection chip={chipParent} />}
      <Specs product={product} />
      <PriceChart product={product} />
      <ComparisonTable product={product} />
      <ProvenanceFooter product={product} />

      <PriceAlertModal
        open={alertOpen}
        onClose={() => setAlertOpen(false)}
        productSlug={product.slug}
        productName={product.title}
        currentPrice={product.stats.current}
        retailer={bestRetailer?.name ?? null}
      />
    </div>
  );
}

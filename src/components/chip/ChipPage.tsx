import Link from 'next/link';
import type { ChipViewModel } from '@/lib/queries/chip';
import { BoardTable } from './BoardTable';
import ChipSpecs from './ChipSpecs';

type Props = { chip: ChipViewModel };

const MONTH_ABBREV = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatPrice(n: number, currency: string = 'CAD'): string {
  return `${currency} $${n.toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format an ISO date for display.
 *
 * Date-only strings (YYYY-MM-DD) are formatted directly without going
 * through the Date constructor, because `new Date('2025-01-30')` is
 * parsed as UTC midnight — which is the previous day in any negative
 * UTC-offset timezone. RTX 5090's release date `2025-01-30` was rendering
 * as "Jan 29" in Eastern Time. Full datetime strings (with time) are
 * left to Date since they're already timezone-anchored.
 */
function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const dateOnly = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, year, mm, dd] = dateOnly;
    const monthIdx = parseInt(mm, 10) - 1;
    if (monthIdx < 0 || monthIdx > 11) return null;
    return `${MONTH_ABBREV[monthIdx]} ${parseInt(dd, 10)}, ${year}`;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function ChipPage({ chip }: Props) {
  const { stats } = chip;
  const hasCurrentPrices = stats.lowestPrice != null;
  const releaseDate = formatDate(chip.releaseDate);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      {/* Breadcrumbs */}
      <nav className="mb-6 text-sm text-zinc-500" aria-label="Breadcrumb">
        <Link
          href="/"
          className="hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Home
        </Link>
        <span className="mx-2">/</span>
        <Link
          href="/c/gpus"
          className="hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Graphics Cards
        </Link>
        <span className="mx-2">/</span>
        <span className="text-zinc-700 dark:text-zinc-300">{chip.name}</span>
      </nav>

      {/* Hero — text-first per Architecture Bible §10 done (chip-level
          metadata image / MSRP / description are NULL on every chip
          today; dbgpu backfill is §10 tail). */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {chip.name}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          {[chip.brand, releaseDate ? `Released ${releaseDate}` : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      {/* Stats strip — fact tiles, not verdict tiles (per the 2026-04-27
          night Product page reframe). */}
      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Boards tracked"
          value={stats.boardCount.toString()}
          sub={
            stats.boardsWithListingsCount > 0
              ? `${stats.boardsWithListingsCount} with current price`
              : undefined
          }
        />
        <Stat
          label="Active listings"
          value={stats.activeListingCount.toString()}
          sub={
            stats.inStockListingCount > 0
              ? `${stats.inStockListingCount} fresh`
              : 'all stale'
          }
        />
        <Stat
          label="Retailers"
          value={stats.retailerCount > 0 ? stats.retailerCount.toString() : '—'}
          sub={stats.retailerCount === 0 ? 'no current obs' : undefined}
        />
        <Stat
          label="Lowest current"
          value={
            hasCurrentPrices
              ? formatPrice(stats.lowestPrice!, stats.lowestPriceCurrency ?? 'CAD')
              : '—'
          }
          sub={!hasCurrentPrices ? 'no current obs' : undefined}
          highlight={hasCurrentPrices}
        />
      </section>

      {/* Specs — sourced from entity_attributes. Self-renders nothing
          when chip has no attributes (the 2 unmatched chips). */}
      <ChipSpecs attributes={chip.attributes} />

      {/* No-current-prices callout. The catalog has the chip and its
          boards, but every observation is older than the freshness
          window. Catalog-first scraping (Architecture Bible §10 #4)
          will reduce how often this state shows up. */}
      {!hasCurrentPrices && chip.boards.length > 0 && (
        <div className="mb-8 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-200">
          <p className="font-medium">No current observations.</p>
          <p className="mt-1">
            Every listing for this chip is older than 7 days. The catalog is
            being re-scraped. Boards below show last-seen times.
          </p>
        </div>
      )}

      {/* Board table or empty state */}
      {chip.boards.length > 0 ? (
        <section>
          <h2 className="mb-4 text-lg font-semibold">Boards</h2>
          <BoardTable boards={chip.boards} chipName={chip.name} />
        </section>
      ) : (
        <div className="rounded border border-zinc-200 bg-zinc-50 p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50">
          <p className="font-medium text-zinc-700 dark:text-zinc-300">
            No boards in catalog yet.
          </p>
          <p className="mt-1">
            This chip exists in the canonical catalog but has no retailer
            listings linked to it.
          </p>
        </div>
      )}

      {/* Provenance footer — earned-trust posture, no spin. Names what's
          here, where it came from, when it last changed. */}
      <footer className="mt-12 border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800">
        <p>
          Catalog data from TechPowerUp (vendored). Prices observed from
          Canadian retailers and refreshed daily. Current price = most recent
          observation per listing within the last 7 days.
        </p>
        <p className="mt-2">
          Last refreshed:{' '}
          {new Date(chip.lastRefreshed).toLocaleString('en-CA', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </p>
      </footer>
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div
        className={`mt-1 text-lg font-semibold tabular-nums sm:text-xl ${
          highlight ? 'text-emerald-700 dark:text-emerald-400' : ''
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

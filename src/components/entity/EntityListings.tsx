import ClickTracker from '@/components/ClickTracker';
import { ga4EventForRetailer } from '@/lib/affiliate';
import type { CoverageTier, EntityListing } from '@/lib/queries/entity';
import {
  getCoverageTierDisplay,
  tierBadgeClasses,
} from '@/lib/coverage-tier';

type Props = {
  listings: EntityListing[];
  entityName: string;
  entityCategory: string;
  /** Honest-labeling tier for this leaf entity. Drives the header bar.
      Bible Sec 9 / 2026-05-08. */
  coverageTier: CoverageTier;
  /** Distinct retailers fresh within 48hr - used to produce a precise
      retailer count next to the badge ("Well tracked  -  3 fresh
      retailers" vs the 7d-fresh count which can disagree). */
  freshRetailerCount: number;
};

/* ---------------------------------------------------------------------
   EntityListings

   Leaf render layer. Header bar at top with the honest-labeling tier
   badge (Bible Sec 9). Below the header, one row per active listing:
     retailer | freshness chip | price | external View link

   Used by /board/[slug] today; /cpu/[slug] in Step 4 if CPUs are
   modeled as leaves. (CPUs may end up as branches under a chip-family
   pattern - that's a Step-4 decision.)

   2026-05-08 (Bible Sec 9 honest-labeling, this commit):
     - Header bar shows the coverage-tier badge + concrete retailer
       count next to it. Replaces the implicit "if there's a Listings
       header up in EntityPage, that's the only signal" with an
       explicit trust signal next to the listings themselves.
     - Per-row UI unchanged. The honesty fix lives at the section
       level, not per-row - each row's price is genuinely current,
       so emerald price styling stays.

   Step-3 (2026-05-04): outbound View link wrapped in <ClickTracker>
   so retailer clicks fire GA4 events. ClickTracker is a server-safe
   `'use client'` boundary that handles gtag + nofollow/sponsored rel.
   ga4EventForRetailer() picks `affiliate_click` for Newegg and
   `retailer_click` for everyone else. Props (entityName,
   entityCategory) thread down from EntityPage.

   Price defaults to 0 when there is no current observation; the
   downstream View link is still rendered (l.url exists) and the click
   is still trackable, but the GA4 `price` dimension is 0 to signal
   "no fresh price at click time".
   --------------------------------------------------------------------- */

function formatPrice(n: number, currency: string = 'CAD'): string {
  return `${currency} $${n.toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return 'never';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function tierSubtext(
  tier: CoverageTier,
  freshRetailerCount: number,
  totalListings: number,
): string {
  switch (tier) {
    case 'well_tracked':
    case 'tracked':
      return `${freshRetailerCount} fresh retailer${freshRetailerCount === 1 ? '' : 's'} in last 48h`;
    case 'single_source':
      return '1 fresh retailer in last 48h - no comparison being made';
    case 'historical':
      return `${totalListings} listing${totalListings === 1 ? '' : 's'}, none observed in last 48h`;
    case 'encyclopedic_only':
      return 'no current price observations';
  }
}

export default function EntityListings({
  listings,
  entityName,
  entityCategory,
  coverageTier,
  freshRetailerCount,
}: Props) {
  const tierDisplay = getCoverageTierDisplay(coverageTier);
  const subtext = tierSubtext(coverageTier, freshRetailerCount, listings.length);

  return (
    <div className="overflow-hidden rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {/* Coverage-tier header bar - the trust signal lives here. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-zinc-200 bg-zinc-50 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900/60 sm:px-5">
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${tierBadgeClasses(tierDisplay.tone)}`}
        >
          {tierDisplay.fullLabel}
        </span>
        <span className="text-xs text-zinc-500">{subtext}</span>
      </div>

      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {listings.map((l) => {
          const freshnessLabel =
            l.currentPrice != null
              ? l.lastObservedAt
                ? `seen ${formatRelative(l.lastObservedAt)}`
                : 'current'
              : `last seen ${formatRelative(l.lastSeen)}`;

          return (
            <li
              key={l.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {l.retailerName}
                </span>
                {l.isOpenBox && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    Open box
                  </span>
                )}
                <span className="text-xs text-zinc-500">{freshnessLabel}</span>
              </div>

              <div className="flex items-baseline gap-4">
                {l.currentPrice != null ? (
                  <span className="text-base font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {formatPrice(l.currentPrice, l.currency)}
                  </span>
                ) : (
                  <span className="text-sm text-zinc-500">no current price</span>
                )}
                {l.url && (
                  <ClickTracker
                    href={l.url}
                    event={ga4EventForRetailer(l.retailerName)}
                    label={entityName}
                    retailer={l.retailerName}
                    category={entityCategory}
                    price={l.currentPrice ?? 0}
                    className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                  >
                    View &rarr;
                  </ClickTracker>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

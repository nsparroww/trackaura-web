'use client';

import { useState } from 'react';
import Link from 'next/link';
import ClickTracker from '@/components/ClickTracker';
import { ga4EventForRetailer } from '@/lib/affiliate';
import type { EntityChild, EntityListing } from '@/lib/queries/entity';
import {
  getCoverageTierDisplay,
  tierBadgeClasses,
} from '@/lib/coverage-tier';

type Props = {
  items: EntityChild[];
  entityCategory: string;
};

/* ---------------------------------------------------------------------
   EntityChildren

   Branch render layer. Renders a parent entity's children (the GPU
   boards under a gpu_chip, the CPUs under a cpu_microarch) as a
   responsive card grid - the same left-to-right shopping-grid shape as
   the chip list on /c/[slug].

   Each card:
     - hero image (canonical_entities.image_primary_url) with a "No
       image" fallback, matching the /c/[slug] card. Per-card image-load
       guard: a scraped board image URL that 404s falls back to the
       placeholder instead of a broken-image icon.
     - coverage-tier badge + listing-count subtext (the Bible Sec 9
       trust signal)
     - child name -> child entity page
     - lowest current price, emerald only when the tier allows
       comparison framing (well_tracked / tracked); neutral otherwise
       (single_source / historical / encyclopedic_only - a real price,
       but not "lowest of N")
     - one outbound retailer button to the cheapest priced listing,
       through <ClickTracker> for GA4. "Buy at" when the child has a
       fresh retailer; "View at" for a historical (stale) price so the
       button never overstates current availability (Bible Sec 9).
     - a secondary link into the child page for the full per-retailer
       comparison

   2026-05-17 (grid-card rewrite):
     - Replaced the vertical stack of wide article rows with a card
       grid; per-card listing list moved to the child /board page.
   2026-05-17 (image slot):
     - Added the hero image box. EntityChild now carries imageUrl
       (see queries/entity.ts fetchChildren). The image is the child's
       OWN image_primary_url - never inherited from the parent, since
       every sibling under one chip would otherwise render an identical
       picture. This module is now a client component for the
       image-load error guard, mirroring the /c/[slug] card.

   2026-05-18 (collapse-with-expander):
     - A chip like RTX 5090 has 59 boards; rendering all of them inline
       is an endless scroll. The grid now shows the first
       INITIAL_VISIBLE cards and folds the rest behind a "Show all N"
       button.
     - IMPORTANT - crawlability: every card is still rendered into the
       DOM. The overflow cards are present in the server HTML and only
       visually hidden (CSS), so the Bible Sec 1 machine user and search
       crawlers still see every board's link in the initial response.
       This is a VISUAL collapse, not a data truncation - the prior
       "card count is NOT truncated" rule is preserved in substance:
       nothing is hidden from HTML, only folded in the viewport.
     - The expander is client-only (useState); with JS disabled the
       page degrades to all-cards-visible, which is also fine.
   --------------------------------------------------------------------- */

/** How many board cards show before the "Show all" fold. */
const INITIAL_VISIBLE = 12;

function formatPrice(n: number, currency: string = 'CAD'): string {
  return `${currency} $${n.toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function childCountText(child: EntityChild): string {
  if (child.freshRetailerCount > 0) {
    return `${child.freshRetailerCount} retailer${child.freshRetailerCount === 1 ? '' : 's'} fresh in last 48h`;
  }
  if (child.listings.length > 0) {
    return `${child.listings.length} listing${child.listings.length === 1 ? '' : 's'}, none fresh`;
  }
  return 'no listings';
}

/** Cheapest listing carrying both a current price and a URL. Computed
    here rather than assuming child.listings arrives price-sorted. */
function cheapestListing(child: EntityChild): EntityListing | null {
  let best: EntityListing | null = null;
  let bestPrice = Infinity;
  for (const l of child.listings) {
    if (l.currentPrice == null || !l.url) continue;
    if (l.currentPrice < bestPrice) {
      best = l;
      bestPrice = l.currentPrice;
    }
  }
  return best;
}

function EntityChildCard({
  child,
  entityCategory,
}: {
  child: EntityChild;
  entityCategory: string;
}) {
  /* Per-card image-load guard. Scraped board image URLs drift and 404;
     without this the broken-image icon and alt text bleed into the card.
     Mirrors the /c/[slug] ProductCard guard. */
  const [imgFailed, setImgFailed] = useState(false);

  const href = `${child.routePrefix}/${child.cleanSlug}`;
  const tierDisplay = getCoverageTierDisplay(child.coverageTier);
  const priceClass = tierDisplay.allowsComparisonFraming
    ? 'text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400'
    : 'text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100';

  const cheapest = cheapestListing(child);
  const listingCount = child.listings.length;
  const hasFreshRetailer =
    tierDisplay.allowsComparisonFraming ||
    child.coverageTier === 'single_source';
  const buyVerb = hasFreshRetailer ? 'Buy at' : 'View at';

  const showImage = !!child.imageUrl && !imgFailed;

  return (
    <article className="flex h-full flex-col overflow-hidden rounded border border-zinc-200 bg-white transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
      <Link
        href={href}
        className="group relative block aspect-[4/3] overflow-hidden border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
      >
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={child.imageUrl as string}
            alt={child.name}
            onError={() => setImgFailed(true)}
            loading="lazy"
            className="h-full w-full object-contain p-3 transition duration-200 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-zinc-400 dark:text-zinc-600">
            No image
          </div>
        )}
      </Link>

      <div className="flex flex-1 flex-col p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tierBadgeClasses(tierDisplay.tone)}`}
          >
            {tierDisplay.shortLabel}
          </span>
          <span className="text-right text-[11px] text-zinc-500">
            {childCountText(child)}
          </span>
        </div>

        <Link
          href={href}
          className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
        >
          {child.name}
        </Link>

        <div className="mt-auto pt-3">
          {child.lowestPrice != null ? (
            <span className={priceClass}>
              {formatPrice(
                child.lowestPrice,
                child.lowestPriceCurrency ?? 'CAD',
              )}
            </span>
          ) : (
            <span className="text-sm text-zinc-500">No current price</span>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-1.5">
          {cheapest && (
            <ClickTracker
              href={cheapest.url}
              event={ga4EventForRetailer(cheapest.retailerName)}
              label={child.name}
              retailer={cheapest.retailerName}
              category={entityCategory}
              price={cheapest.currentPrice ?? 0}
              className="rounded bg-blue-600 px-3 py-1.5 text-center text-sm font-medium text-white hover:bg-blue-700"
            >
              {`${buyVerb} ${cheapest.retailerName} \u2192`}
            </ClickTracker>
          )}
          <Link
            href={href}
            className="text-center text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            {listingCount > 0
              ? `View ${listingCount} listing${listingCount === 1 ? '' : 's'} \u2192`
              : 'View details \u2192'}
          </Link>
        </div>
      </div>
    </article>
  );
}

export default function EntityChildren({ items, entityCategory }: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasOverflow = items.length > INITIAL_VISIBLE;
  const hiddenCount = items.length - INITIAL_VISIBLE;

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((child, i) => {
          /* Every card is rendered into the DOM for crawlability (Bible
             Sec 1 machine user). Overflow cards past INITIAL_VISIBLE are
             only VISUALLY hidden until expanded - the links are still in
             the server HTML. */
          const hidden = !expanded && i >= INITIAL_VISIBLE;
          return (
            <div key={child.id} className={hidden ? 'hidden' : undefined}>
              <EntityChildCard child={child} entityCategory={entityCategory} />
            </div>
          );
        })}
      </div>

      {hasOverflow && !expanded && (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
          >
            {`Show all ${items.length} \u2014 ${hiddenCount} more`}
          </button>
        </div>
      )}

      {hasOverflow && expanded && (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
          >
            Show fewer
          </button>
        </div>
      )}
    </div>
  );
}

import ClickTracker from '@/components/ClickTracker';
import { ga4EventForRetailer } from '@/lib/affiliate';
import { ENTITY_TYPES } from '@/lib/entity-config';
import type {
  EntityViewModel,
  EntityListing,
  EntityChild,
} from '@/lib/queries/entity';

/* ---------------------------------------------------------------------
   EntityPriceSummary

   Hero-area buy-intent CTA. Tier-aware per Bible Section 9:

     well_tracked / tracked  -> emerald box, "Best price at <retailer>"
                                + optional "Save $Y vs MSRP" sub-line
     single_source           -> amber  box, "Available at <retailer>"
                                (no MSRP comparison - comparison framing
                                is reserved for >=2-retailer tiers)
     historical              -> null   (the existing amber callout in
     encyclopedic_only       -> null    EntityPage already speaks)
     branch gpu_chip         -> emerald box, "Best <chip name> price"
                                + "<variant board name> at <retailer>"
     branch cpu_microarch    -> null   (children are different products
                gpu_microarch         under one architecture; a single
                                      "best across children" is a
                                      category price, not a product
                                      worth - mirrors the same gating
                                      in fetchChipPriceHistory)

   Phase 0 = NEW only (Bible Section 2). Open-box listings are filtered
   out of the best-price candidate set even when they're cheaper - the
   CTA must not point at open-box on a page that doesn't say "open box".

   Affiliate URL rewrite + GA4 event come from ClickTracker, same path
   as EntityListings. Newegg via Rakuten fires affiliate_click; other
   retailers fire retailer_click.

   Insertion point: between EntityPage's hero <header> and the
   description <section>. Highest position above the fold for buyer
   intent (Section 1 user moment 2).

   2026-05-25 (session 29):
     - Initial ship. Targets affiliate-conversion lift now that Newegg
       deep links are wired (session 26). Buyer intent is the primary
       revenue user today; this surface puts the click target above the
       fold instead of below the specs table.
     - trimVariantName(): scraper-sourced board names are routinely
       100+ chars of " - "-separated spec sprawl. The CTA subline on
       chip pages truncates at first " - " (scrapers use it as the
       brand+model | specs separator), with a 60-char hard cap as
       backstop for the no-dash case. Pure cosmetic; the proper fix
       is the ROADMAP Tail's "Board display-name cleanup" column,
       which retires this helper when it lands.
   --------------------------------------------------------------------- */

type Props = { entity: EntityViewModel };

/* USD->CAD for the MSRP savings line. Duplicated from EntityPage's
   same constant rather than extracted - one constant in two places is
   cheaper to maintain than a shared util with one user each. Revisit
   if a third caller needs it. */
const USD_TO_CAD = 1.38;

/* Variant-name display cap. Anything past 60 chars wraps to multi-line
   on mobile and visually dominates the price + retailer name. The cap
   is intentional cosmetic clamping, not a data fix - the underlying
   sprawl is a Tail item. */
const VARIANT_NAME_MAX_CHARS = 60;

type BestPriceContext = {
  listing: EntityListing;
  /** Variant name for branch entities (e.g. "Gigabyte RTX 5090 Gaming
      OC"); null for leaves where the listing IS the entity. */
  variantName: string | null;
};

function findBestPriceContext(
  entity: EntityViewModel,
): BestPriceContext | null {
  /* Branch case - gate to gpu_chip. cpu_microarch / gpu_microarch
     children are distinct products under one architecture; aggregating
     to a single "best price" reads as a category claim, not a worth
     statement (mirrors fetchChipPriceHistory's gating). */
  if (entity.children.length > 0) {
    if (entity.entityType !== 'gpu_chip') return null;
    /* Global cheapest non-openbox across all children. Children are
       pre-sorted by lowestPrice INCLUDING open-box, so children[0] is
       not safe; iterate every listing. */
    let best: { listing: EntityListing; child: EntityChild } | null = null;
    for (const child of entity.children) {
      for (const l of child.listings) {
        if (l.currentPrice == null || l.isOpenBox) continue;
        if (
          best == null ||
          l.currentPrice < (best.listing.currentPrice as number)
        ) {
          best = { listing: l, child };
        }
      }
    }
    if (!best) return null;
    return { listing: best.listing, variantName: best.child.name };
  }
  /* Leaf case - entity.listings is sorted cheapest-first but includes
     open-box rows. Find the cheapest non-openbox. */
  const cheapest = entity.listings.find(
    (l) => l.currentPrice != null && !l.isOpenBox,
  );
  if (!cheapest) return null;
  return { listing: cheapest, variantName: null };
}

function formatPrice(n: number, currency: string = 'CAD'): string {
  return `${currency} $${n.toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** MSRP expressed in CAD (the chart and listings axis). USD MSRPs from
    the Wikipedia GPU ingest convert at USD_TO_CAD; CAD MSRPs pass through.
    Returns null when the entity has no MSRP - the savings line is then
    suppressed. */
function getMsrpCad(entity: EntityViewModel): number | null {
  if (entity.msrp == null) return null;
  const cur = (entity.msrpCurrency ?? 'USD').toUpperCase();
  if (cur === 'CAD') return entity.msrp;
  return Math.round(entity.msrp * USD_TO_CAD);
}

/** Trim a scraper-sourced board name down to a CTA-suitable subline.

    Most scraped names follow "<brand> <model> <variant> - <spec>
    - <spec> - <spec> (<sku>)" where the first " - " separates the
    human-readable identity from the spec sprawl. Cutting at that
    boundary gives a clean variant identifier ~40-60 chars on typical
    Gigabyte / ASUS / MSI names.

    Backstop for the no-dash case: hard cap at VARIANT_NAME_MAX_CHARS
    at a word boundary, with ellipsis. The word-boundary fallback
    requires the cut point be past char 30 - below that the truncation
    is shorter than useful and we just hard-cut. */
function trimVariantName(name: string): string {
  let s = name;
  const dashIdx = s.indexOf(' - ');
  if (dashIdx > 0) s = s.slice(0, dashIdx);
  if (s.length <= VARIANT_NAME_MAX_CHARS) return s;
  const head = s.slice(0, VARIANT_NAME_MAX_CHARS);
  const lastSpace = head.lastIndexOf(' ');
  const cut = lastSpace > 30 ? head.slice(0, lastSpace) : head;
  return `${cut}\u2026`;
}

export default function EntityPriceSummary({ entity }: Props) {
  /* No CTA for historical / encyclopedic_only. The existing amber
     callout in EntityPage already says "no current retail availability"
     honestly; adding a "buy now" button next to it would directly
     contradict that. */
  if (
    entity.coverageTier === 'historical' ||
    entity.coverageTier === 'encyclopedic_only'
  ) {
    return null;
  }

  const best = findBestPriceContext(entity);
  if (!best) return null;
  const { listing, variantName } = best;
  if (listing.currentPrice == null || !listing.url) return null;

  const cfg = ENTITY_TYPES[entity.entityType];
  const isSingleSource = entity.coverageTier === 'single_source';
  const isBranch = entity.children.length > 0;

  /* Tier-aware visual + copy. emerald = positive trust signal; amber =
     caution (single source - we don't claim "best", we just surface the
     one available retailer). */
  const containerClasses = isSingleSource
    ? 'border-amber-300 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-950/20'
    : 'border-emerald-300 bg-emerald-50 dark:border-emerald-800/40 dark:bg-emerald-950/20';

  const labelClasses = isSingleSource
    ? 'text-amber-900 dark:text-amber-200'
    : 'text-emerald-900 dark:text-emerald-200';

  const priceClasses = isSingleSource
    ? 'text-amber-900 dark:text-amber-100'
    : 'text-emerald-800 dark:text-emerald-300';

  const ctaClasses = isSingleSource
    ? 'bg-amber-600 hover:bg-amber-700 text-white'
    : 'bg-emerald-600 hover:bg-emerald-700 text-white';

  /* Headline:
       branch gpu_chip       -> "Best <chip name> price"
       leaf well/tracked     -> "Best price at <retailer>"
       leaf single_source    -> "Available at <retailer>" */
  let headline: string;
  if (isBranch) {
    headline = `Best ${entity.name} price`;
  } else if (isSingleSource) {
    headline = `Available at ${listing.retailerName}`;
  } else {
    headline = `Best price at ${listing.retailerName}`;
  }

  /* Sub-line:
       branch                -> "<trimmed variant name> at <retailer>"
       leaf well/tracked     -> optional "Save $X vs MSRP" (only when
                                MSRP exists and price < MSRP in CAD)
       leaf single_source    -> null (no comparison claim - bible Section 9) */
  let subLine: string | null = null;
  if (isBranch && variantName) {
    subLine = `${trimVariantName(variantName)} at ${listing.retailerName}`;
  } else if (!isBranch && !isSingleSource) {
    const msrpCad = getMsrpCad(entity);
    if (msrpCad != null && listing.currentPrice < msrpCad) {
      const savings = Math.round(msrpCad - listing.currentPrice);
      subLine = `Save $${savings.toLocaleString('en-CA')} vs MSRP`;
    }
  }

  return (
    <section className={`mb-8 rounded-lg border ${containerClasses}`}>
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5 sm:py-4">
        <div className="min-w-0 flex-1">
          <p
            className={`text-xs font-medium uppercase tracking-wide ${labelClasses}`}
          >
            {headline}
          </p>
          <p
            className={`mt-1 text-2xl font-bold tabular-nums sm:text-3xl ${priceClasses}`}
          >
            {formatPrice(listing.currentPrice, listing.currency)}
          </p>
          {subLine && (
            <p className={`mt-1 text-sm ${labelClasses}`}>{subLine}</p>
          )}
        </div>
        <ClickTracker
          href={listing.url}
          event={ga4EventForRetailer(listing.retailerName)}
          label={entity.name}
          retailer={listing.retailerName}
          category={cfg.category}
          price={listing.currentPrice}
          className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md px-5 py-2.5 text-sm font-semibold transition-colors sm:px-6 sm:py-3 sm:text-base ${ctaClasses}`}
        >
          Buy at {listing.retailerName} &rarr;
        </ClickTracker>
      </div>
    </section>
  );
}

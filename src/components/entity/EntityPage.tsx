import Image from 'next/image';
import { CATEGORIES, ENTITY_TYPES } from '@/lib/entity-config';
import type { EntityViewModel } from '@/lib/queries/entity';
import { getCoverageTierDisplay } from '@/lib/coverage-tier';
import EntityBreadcrumbs from './EntityBreadcrumbs';
import EntitySpecs from './EntitySpecs';
import EntityChildren from './EntityChildren';
import EntityListings from './EntityListings';
import EntityLineage from './EntityLineage';
import EntityWorth from './EntityWorth';
import EntityPriceSummary from './EntityPriceSummary';
import PriceChart from '@/components/PriceChart';
import ChipPriceChart from '@/components/ChipPriceChart';

type Props = { entity: EntityViewModel };

/* ---------------------------------------------------------------------
   EntityPage

   Generic render layer for any canonical_entities row. Replaces ChipPage
   at Step 3 cutover. Today (Step 3b) it powers /chip/[slug] and
   /board/[slug].

   Branch vs leaf: keyed off `cfg.childEntityType != null`, NOT
   `entity.children.length`. A branch with zero children is still a
   branch and should show the "0 boards" stat tile + empty-children
   state, not collapse into a listings table.

   Stats strip:
     - Branch: 4 tiles (children count + listings + retailers + lowest)
     - Leaf:   3 tiles (listings + retailers + lowest/listed)
   Grid columns flip with isBranch so layout doesn't leave a gap.

   Provenance text comes from CategoryConfig - Phase 1+ collectibles
   surface "Catalog data from Scryfall" etc. without touching this file.

   Note on JSON-LD: Schema.org Product / BreadcrumbList JSON-LD is
   emitted by the page route files (chip/[slug]/page.tsx etc.) via
   buildEntityProductLd / buildEntityBreadcrumbLd in lib/entity-metadata.ts.
   That's the architectural single source of truth; EntityPage stays
   render-focused.

   2026-05-08 (Bible §9 honest-labeling):
     - On leaves, the price stat tile relabels by coverageTier:
       * tracked / well_tracked: "Lowest current"  (existing framing)
       * single_source:          "Listed price"    (drops comparison framing)
       * historical:             "No current price" with "last known retail" sub
       * encyclopedic_only:      "No retail data" sub
     - The amber callout's copy switches by tier so a `historical`
       leaf says "no current retail availability" rather than "all
       listings are stale" - the bible's exact phrasing.
     - Branches (chips) are unchanged - their tier is null because the
       chip itself isn't sold; per-board labels in the children grid
       carry the trust signal instead.

   2026-05-11 (description rendering + Wikipedia attribution):
     - The `description` field was always populated on the view model
       (entity.description_md -> entity.description) but never rendered
       in this component. Latent since the entity-page system shipped;
       only surfaced when the Intel CPU microarch ingest became the
       first source of catalog descriptions. Adds a prose section
       between the hero and the stats strip.
     - When description or image was inherited from a parent (via the
       new column-fallback in getEntityViewModel) AND the parent has
       a `wikipedia_url` entity_attribute (surfaced as
       entity.sourceUrl), renders a CC BY-SA attribution line below
       the prose. License compliance is non-negotiable for line-4
       procurement diligence; this is the minimum-viable attribution
       surface.

   2026-05-13 (lineage rendering):
     - <EntityLineage> renders predecessor / successor cards from the
       view model, placed between EntitySpecs and the amber callout
       so the chronological context sits adjacent to "what is this"
       (specs) and above "what does it cost" (listings).
     - Component self-gates: returns null when both predecessor and
       successor are null, so v0-scope chips (NVIDIA GeForce desktop
       only) render the section while AMD/Intel/Tesla/Quadro/Jetson
       leave the space empty.
     - Bible §7 lists "Lineage" as an EntityPage section; this commit
       satisfies that.

   2026-05-18 (chip price chart placement + MSRP line):
     - Price-history section moved up: it now sits directly after
       Lineage and ABOVE the listings / children block, so on a chip
       page the aggregated price chart is visible without scrolling
       past 59 board cards. Previously it was the last section before
       the footer (Active queue #5 feedback).
     - PriceChart now receives an `msrp` reference line. msrp_cad is
       stored in the entity's msrp_currency (USD for the Wikipedia GPU
       ingest); the chart axis is CAD, so a raw USD figure would sit
       far below the data. buildMsrpLine() converts at a single named
       constant and labels the line with BOTH currencies
       ("MSRP USD $1,999 (~CAD $2,759)") so the line is honest about
       being a converted, approximate figure. When msrp_currency is
       already CAD the value passes through unconverted and the label
       omits the approximation tilde.

   Step-3c (2026-05-04): amber-callout and empty-state copy no longer
   include `cfg.label.toLowerCase()`. The lowercase output for
   `gpus.label = "GPU Board"` was rendering "this gpu board", which
   reads as a typo. Generic phrasing is clearer for every vertical
   (future CPUs, monitors, MTG cards, etc.) and avoids needing a
   per-type `lowerLabel` field on EntityTypeConfig.

   Step-3 (2026-05-04): entity.name + cfg.category thread down to
   EntityListings/EntityChildren so the GA4 ClickTracker has the right
   event_label and product_category dimensions per click.

   Phase-0.5 polish (2026-05-04): EntitySpecs now receives
   inheritedAttributes + inheritedFromName so leaf pages (boards) can
   render parent-chip specs as a second "Inherited from X" block. View
   model populates these only for leaves with parents - branches and
   orphan leaves resolve them as []/null.

   Phase-0.5 polish (2026-05-05): Hero image renders when
   entity.imageUrl is present. Chip imagery landed at 96.4% via dbgpu
   the same day; previously this slot was deferred as "text-first per
   Architecture Bible §10" which was correct only while the field
   was universally NULL. Layout: image floats right of the title block
   on sm+ screens, stacks above on mobile. next/image with techpowerup
   allowlisted in next.config.ts; sizes constrained so a single 800px
   TPU thumb doesn't dominate the page.
   --------------------------------------------------------------------- */

const MONTH_ABBREV = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/* USD->CAD conversion for the MSRP reference line only. A single named
   constant, not a live FX feed: MSRP is a fixed encyclopedic launch-price
   attribute (Bible §6), and the line is explicitly labelled approximate
   ("~CAD") so a slightly stale rate cannot mislead. Revisit if/when CAD
   MSRPs are ingested directly, at which point conversion goes away. */
const USD_TO_CAD = 1.38;

function formatPrice(n: number, currency: string = 'CAD'): string {
  return `${currency} $${n.toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format MSRP for the hero subtitle, e.g. "MSRP USD $599".
 * MSRP is a fixed encyclopedic launch-price attribute (Bible Section 6),
 * not a live price - no decimal places, since Wikipedia MSRPs are
 * whole-dollar figures. Currency is whatever the ingest stored (USD for
 * the Wikipedia-sourced GPU MSRPs); never assume CAD.
 */
function formatMsrp(n: number, currency: string | null): string {
  const cur = currency ?? 'USD';
  return `MSRP ${cur} $${n.toLocaleString('en-CA')}`;
}

/**
 * Build the MSRP reference-line inputs for <PriceChart>: a CAD-denominated
 * value (the chart axis is CAD) plus a label that keeps the original
 * currency visible.
 *
 * - msrp_currency === 'CAD': pass through, label "MSRP CAD $X".
 * - msrp_currency === 'USD' (or null -> assume USD, the ingest default):
 *   convert at USD_TO_CAD, label "MSRP USD $1,999 (~CAD $2,759)" so the
 *   line is honestly flagged as a converted approximation.
 *
 * Returns null when the entity has no MSRP - PriceChart then draws no line.
 */
function buildMsrpLine(
  entity: EntityViewModel,
): { value: number; label: string } | null {
  if (entity.msrp == null) return null;
  const cur = entity.msrpCurrency ?? 'USD';
  if (cur.toUpperCase() === 'CAD') {
    return {
      value: entity.msrp,
      label: `MSRP CAD $${entity.msrp.toLocaleString('en-CA')}`,
    };
  }
  const cad = Math.round(entity.msrp * USD_TO_CAD);
  return {
    value: cad,
    label: `MSRP ${cur.toUpperCase()} $${entity.msrp.toLocaleString('en-CA')} (\u2248CAD $${cad.toLocaleString('en-CA')})`,
  };
}

/**
 * Format an ISO date for display.
 *
 * Date-only strings (YYYY-MM-DD) are formatted directly without going
 * through the Date constructor, because `new Date('2025-01-30')` is
 * parsed as UTC midnight - which is the previous day in any negative
 * UTC-offset timezone. RTX 5090's release date `2025-01-30` was
 * rendering as "Jan 29" in Eastern Time before this fix in ChipPage.
 * Logic preserved verbatim.
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

/**
 * Build the "Description and image from [Wikipedia](url) (CC BY-SA 4.0)"
 * attribution line. Returns null when nothing was inherited (leaf owns
 * its own image and description) or when no sourceUrl is available.
 */
function buildAttributionParts(
  entity: EntityViewModel,
): { contentNoun: string; sourceUrl: string } | null {
  if (!entity.sourceUrl) return null;
  const hasInhDesc = entity.descriptionInheritedFromName != null;
  const hasInhImg = entity.imageInheritedFromName != null;
  if (!hasInhDesc && !hasInhImg) return null;
  let noun: string;
  if (hasInhDesc && hasInhImg) noun = 'Description and image';
  else if (hasInhDesc) noun = 'Description';
  else noun = 'Image';
  return { contentNoun: noun, sourceUrl: entity.sourceUrl };
}

/**
 * Min / max / latest price across the price-history series, for
 * <PriceChart>'s minPrice / maxPrice / currentPrice props. The series is
 * oldest-first, so the last element is the most recent observation.
 * Returns zeroes for an empty series - callers gate on length >= 2 before
 * rendering the chart, so those zeroes are never displayed.
 */
function summarizePriceHistory(
  history: EntityViewModel['priceHistory'],
): { min: number; max: number; current: number } {
  if (history.length === 0) return { min: 0, max: 0, current: 0 };
  let min = history[0].price;
  let max = history[0].price;
  for (const p of history) {
    if (p.price < min) min = p.price;
    if (p.price > max) max = p.price;
  }
  return { min, max, current: history[history.length - 1].price };
}

export default function EntityPage({ entity }: Props) {
  const cfg = ENTITY_TYPES[entity.entityType];
  const category = CATEGORIES[cfg.category];
  const childCfg = cfg.childEntityType ? ENTITY_TYPES[cfg.childEntityType] : null;
  const isBranch = cfg.childEntityType != null;
  const childPlural = childCfg?.pluralLabel ?? 'Items';

  const { stats } = entity;
  const hasCurrentPrices = stats.lowestPrice != null;
  const releaseDate = formatDate(entity.releaseDate);
  const attribution = buildAttributionParts(entity);

  /* Tier-driven copy for the price stat tile + amber callout. Branches
     resolve to nulls because their tier is null. */
  const priceTileCopy = computePriceTileCopy(entity);
  const amberCalloutCopy = computeAmberCalloutCopy(entity);

  /* Price-history series summary, for <PriceChart>'s reference-line and
     change-calculation props. Empty for branches and thin leaves. */
  const priceHistorySummary = summarizePriceHistory(entity.priceHistory);
  const msrpLine = buildMsrpLine(entity);

  /* Two price-history shapes: leaves get a single-line <PriceChart> from
     priceHistory; chips (branches) get a band <ChipPriceChart> from
     priceBand. Each gates on its own series having >=2 points. */
  const showLeafChart = !isBranch && entity.priceHistory.length >= 2;
  const showChipChart = isBranch && entity.priceBand.length >= 2;
  const showPriceHistory = showLeafChart || showChipChart;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      {/* Breadcrumbs (replaces the inline nav in ChipPage today) */}
      <div className="mb-6">
        <EntityBreadcrumbs items={entity.breadcrumbs} />
      </div>

      {/* Hero - title block + optional product image. Image floats right
          on sm+ screens, stacks below on mobile. */}
      <header className="mb-8 sm:flex sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {entity.name}
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            {[
              entity.brand,
              releaseDate ? `Released ${releaseDate}` : null,
              entity.msrp != null
                ? formatMsrp(entity.msrp, entity.msrpCurrency)
                : null,
            ]
              .filter(Boolean)
              .join(' \u00b7 ')}
          </p>
        </div>

        {entity.imageUrl && (
          <div className="mt-4 flex-shrink-0 sm:mt-0">
            <div className="relative h-32 w-44 overflow-hidden rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 sm:h-36 sm:w-48">
              <Image
                src={entity.imageUrl}
                alt={entity.name}
                fill
                sizes="(max-width: 640px) 11rem, 12rem"
                className="object-contain p-2"
                unoptimized
              />
            </div>
          </div>
        )}
      </header>

      {/* Buy-intent CTA — tier-aware. Self-gates: returns null for
          historical / encyclopedic_only / category-like branches. */}
      <EntityPriceSummary entity={entity} />

      {/* Description prose + CC BY-SA attribution when inherited. */}
      {entity.description && (
        <section className="mb-8">
          <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            {entity.description}
          </p>
          {attribution && (
            <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
              {attribution.contentNoun} from{' '}
              <a
                href={attribution.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-500 dark:decoration-zinc-700 dark:hover:decoration-zinc-500"
              >
                Wikipedia
              </a>
              {' '}(CC BY-SA 4.0)
            </p>
          )}
        </section>
      )}

      {/* Stats strip. Branch: childCount + activeListings + retailers + lowest.
          Leaf: activeListings + retailers + lowest. */}
      <section
        className={`mb-8 grid gap-3 ${
          isBranch ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'
        }`}
      >
        {isBranch && (
          <Stat
            label={childPlural}
            value={String(stats.childCount)}
            sub={
              stats.childrenWithListingsCount > 0
                ? `${stats.childrenWithListingsCount} with listings`
                : 'no current listings'
            }
          />
        )}
        <Stat
          label="Active listings"
          value={String(stats.activeListingCount)}
          sub={
            stats.inStockListingCount > 0
              ? `${stats.inStockListingCount} in stock`
              : undefined
          }
        />
        <Stat
          label="Retailers"
          value={String(stats.retailerCount)}
        />
        <Stat
          label={priceTileCopy.label}
          value={
            hasCurrentPrices
              ? formatPrice(stats.lowestPrice!, stats.lowestPriceCurrency ?? 'CAD')
              : '\u2014'
          }
          sub={priceTileCopy.sub}
          highlight={hasCurrentPrices && priceTileCopy.highlight}
        />
      </section>

      {/* Estimated worth - synthesized index with explicit confidence,
          previously JSON-LD-only. Self-gates to null below the publishable
          floor. Placed after the raw-fact stats strip and before specs so
          the interpretive "what's it worth" answer sits between the facts
          and the encyclopedic detail. */}
      <EntityWorth entity={entity} />

      {/* Specs - own attributes plus inherited attributes from parent
          (leaves with parent only). Self-renders nothing when both lists
          are empty. */}
      <EntitySpecs
        attributes={entity.attributes}
        inheritedAttributes={entity.inheritedAttributes}
        inheritedFromName={entity.inheritedFromName}
      />

      {/* Lineage - predecessor / successor cards. Self-gates: renders
          nothing when both are null. */}
      <EntityLineage
        predecessor={entity.predecessor}
        successor={entity.successor}
        variants={entity.variants}
      />

      {/* Price history - moved above the listings / children block
          (2026-05-18) so the chip's aggregated price chart is visible
          without scrolling past every board card. Self-gates at >=2
          points: a single observation is a dot, not a chart. For a chip
          (branch) the series is the median-per-day aggregate across all
          child boards (getEntityViewModel.fetchChipPriceHistory); for a
          leaf it is the entity's own observations. Open-box excluded
          upstream either way. MSRP reference line drawn when the entity
          has an MSRP (buildMsrpLine handles USD->CAD + honest labelling). */}
      {showPriceHistory && (
        <section className="mb-8">
          <h2 className="mb-4 text-lg font-semibold">Price history</h2>
          <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            {showChipChart ? (
              <ChipPriceChart
                band={entity.priceBand}
                msrp={msrpLine?.value ?? null}
                msrpLabel={msrpLine?.label}
                releaseDate={entity.releaseDate}
              />
            ) : (
              <PriceChart
                data={entity.priceHistory}
                currentPrice={priceHistorySummary.current}
                minPrice={priceHistorySummary.min}
                maxPrice={priceHistorySummary.max}
                msrp={msrpLine?.value ?? null}
                msrpLabel={msrpLine?.label}
              />
            )}
          </div>
        </section>
      )}

      {/* No-current-prices callout. Tier-aware copy: a `historical`
          leaf says "no current retail availability" per Bible §9;
          everything else falls back to the existing "stale" framing. */}
      {amberCalloutCopy && (
        <div className="mb-8 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-200">
          <p className="font-medium">{amberCalloutCopy.heading}</p>
          <p className="mt-1">{amberCalloutCopy.body}</p>
        </div>
      )}

      {/* Branch: children section. Leaf: listings table. */}
      {isBranch ? (
        entity.children.length > 0 ? (
          <section>
            <h2 className="mb-4 text-lg font-semibold">{childPlural}</h2>
            <EntityChildren
              items={entity.children}
              entityCategory={cfg.category}
            />
          </section>
        ) : (
          <EmptyState
            heading={`No ${childPlural.toLowerCase()} in catalog yet.`}
            body="This entity exists in the canonical catalog but has no children linked to it."
          />
        )
      ) : entity.listings.length > 0 ? (
        <section>
          <h2 className="mb-4 text-lg font-semibold">Listings</h2>
          <EntityListings
            listings={entity.listings}
            entityName={entity.name}
            entityCategory={cfg.category}
            coverageTier={entity.coverageTier ?? 'encyclopedic_only'}
            freshRetailerCount={entity.freshRetailerCount}
          />
        </section>
      ) : (
        <EmptyState
          heading="No active listings."
          body="No Canadian retailers are tracking this yet."
        />
      )}

      {/* Provenance footer - earned-trust posture, no spin. Per-category
          text via CategoryConfig.provenance. */}
      <footer className="mt-12 border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800">
        <p>{category.provenance}</p>
        <p className="mt-2">
          Last refreshed:{' '}
          {new Date(entity.lastRefreshed).toLocaleString('en-CA', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </p>
      </footer>
    </main>
  );
}

/* Tier-driven copy helpers ------------------------------------------- */

type PriceTileCopy = {
  label: string;
  sub: string | undefined;
  highlight: boolean;
};

function computePriceTileCopy(entity: EntityViewModel): PriceTileCopy {
  const hasCurrentPrices = entity.stats.lowestPrice != null;
  /* Branch (chip) - keep existing aggregate framing. The chip's tier
     is null; per-child trust signals live in the children grid. */
  if (entity.coverageTier == null) {
    return {
      label: 'Lowest current',
      sub: hasCurrentPrices ? undefined : 'no current obs',
      highlight: true,
    };
  }
  /* Leaf - relabel by tier. */
  const display = getCoverageTierDisplay(entity.coverageTier);
  switch (entity.coverageTier) {
    case 'well_tracked':
    case 'tracked':
      return {
        label: 'Lowest current',
        sub: undefined,
        highlight: true,
      };
    case 'single_source':
      return {
        label: 'Listed price',
        sub: 'one retailer \u2014 no comparison',
        highlight: false,
      };
    case 'historical':
      return {
        label: 'No current price',
        sub: 'last known retail',
        highlight: false,
      };
    case 'encyclopedic_only':
      return {
        label: display.shortLabel,
        sub: 'no retail data',
        highlight: false,
      };
  }
}

type AmberCalloutCopy = { heading: string; body: string } | null;

function computeAmberCalloutCopy(entity: EntityViewModel): AmberCalloutCopy {
  /* Branch case - existing condition unchanged. The callout is meant
     for the chip page where every board's listings exist but none have
     fresh observations. */
  if (entity.coverageTier == null) {
    if (entity.stats.lowestPrice == null && entity.stats.activeListingCount > 0) {
      return {
        heading: 'No current observations.',
        body: 'Every active listing here is older than 7 days. The catalog is being re-scraped.',
      };
    }
    return null;
  }
  /* Leaf - tier-aware copy per Bible §9. */
  switch (entity.coverageTier) {
    case 'historical':
      return {
        heading: 'No current retail availability.',
        body: 'No Canadian retailers we track have a fresh price for this in the last 48 hours. Listings shown reflect the most recent observations we have on record.',
      };
    case 'encyclopedic_only':
      /* No listings to caveat - the EmptyState already covers this. */
      return null;
    case 'single_source':
      /* Only one retailer carries this. Not stale; just narrow. The
         tier badge in EntityListings already signals this; no callout. */
      return null;
    case 'tracked':
    case 'well_tracked':
      return null;
  }
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

function EmptyState({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="rounded border border-zinc-200 bg-zinc-50 p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50">
      <p className="font-medium text-zinc-700 dark:text-zinc-300">{heading}</p>
      <p className="mt-1">{body}</p>
    </div>
  );
}

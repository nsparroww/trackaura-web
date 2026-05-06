import Image from 'next/image';
import { CATEGORIES, ENTITY_TYPES } from '@/lib/entity-config';
import type { EntityViewModel } from '@/lib/queries/entity';
import EntityBreadcrumbs from './EntityBreadcrumbs';
import EntitySpecs from './EntitySpecs';
import EntityChildren from './EntityChildren';
import EntityListings from './EntityListings';

type Props = { entity: EntityViewModel };

/* ─────────────────────────────────────────────────────────────────────
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
     - Leaf:   3 tiles (listings + retailers + lowest)
   Grid columns flip with isBranch so layout doesn't leave a gap.

   Provenance text comes from CategoryConfig — Phase 1+ collectibles
   surface "Catalog data from Scryfall" etc. without touching this file.

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
   model populates these only for leaves with parents — branches and
   orphan leaves resolve them as []/null.

   Phase-0.5 polish (2026-05-05): Hero image now renders when
   entity.imageUrl is present. Chip imagery landed at 96.4% via dbgpu
   the same day; previously this slot was deferred as "text-first per
   Architecture Bible §10" which was correct only while the field was
   universally NULL. Layout: image floats right of the title block on
   sm+ screens, stacks above on mobile. next/image with techpowerup
   allowlisted in next.config.ts; sizes constrained so a single 800px
   TPU thumb doesn't dominate the page.
   ───────────────────────────────────────────────────────────────────── */

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

export default function EntityPage({ entity }: Props) {
  const cfg = ENTITY_TYPES[entity.entityType];
  const category = CATEGORIES[cfg.category];
  const childCfg = cfg.childEntityType ? ENTITY_TYPES[cfg.childEntityType] : null;
  const isBranch = cfg.childEntityType != null;
  const childPlural = childCfg?.pluralLabel ?? 'Items';

  const { stats } = entity;
  const hasCurrentPrices = stats.lowestPrice != null;
  const releaseDate = formatDate(entity.releaseDate);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      {/* Breadcrumbs (replaces the inline nav in ChipPage today) */}
      <div className="mb-6">
        <EntityBreadcrumbs items={entity.breadcrumbs} />
      </div>

      {/* Hero — title block + optional product image. Image floats right
          on sm+ screens, stacks below on mobile. */}
      <header className="mb-8 sm:flex sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {entity.name}
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            {[entity.brand, releaseDate ? `Released ${releaseDate}` : null]
              .filter(Boolean)
              .join(' · ')}
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

      {/* Stats strip — fact tiles, not verdict tiles. */}
      <section
        className={
          isBranch
            ? 'mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4'
            : 'mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3'
        }
      >
        {isBranch && (
          <Stat
            label={`${childPlural} tracked`}
            value={stats.childCount.toString()}
            sub={
              stats.childrenWithListingsCount > 0
                ? `${stats.childrenWithListingsCount} with current price`
                : undefined
            }
          />
        )}
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

      {/* Specs — own attributes plus inherited attributes from parent
          (leaves with parent only). Self-renders nothing when both lists
          are empty. */}
      <EntitySpecs
        attributes={entity.attributes}
        inheritedAttributes={entity.inheritedAttributes}
        inheritedFromName={entity.inheritedFromName}
      />

      {/* No-current-prices callout. Same condition as ChipPage but
          generalized: any active listing exists yet none have a current
          price = catalog has the entity but observations are stale. */}
      {!hasCurrentPrices && stats.activeListingCount > 0 && (
        <div className="mb-8 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-200">
          <p className="font-medium">No current observations.</p>
          <p className="mt-1">
            Every active listing here is older than 7 days. The catalog is
            being re-scraped.
          </p>
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
          />
        </section>
      ) : (
        <EmptyState
          heading="No active listings."
          body="No Canadian retailers are tracking this yet."
        />
      )}

      {/* Provenance footer — earned-trust posture, no spin. Per-category
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

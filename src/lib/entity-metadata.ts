import type { Metadata } from 'next';
import {
  CATEGORIES,
  getEntityTypeConfig,
  type EntityType,
} from './entity-config';
import type { EntityViewModel, EntityListing } from './queries/entity';

/* ---------------------------------------------------------------------
   entity-metadata.ts

   Shared Metadata + JSON-LD generators for any entity-page route.
   Mirrors the chip-page handcrafted template structure so the chip
   cutover (Step 3) doesn't regress existing search-result snippets.

   Why this lives outside the route file:
     - Phase 0 ships /board/[slug] now and /cpu/[slug] in Step 4.
     - The Bible's promise (Sec 7) is "adding a new vertical = config
       entry + entity_type rows + scraper. No new frontend code per
       vertical."
     - Inlining metadata in each route file would force re-writing
       generateMetadata for every new vertical. This module makes the
       route file a thin shell.
   --------------------------------------------------------------------- */

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trackaura.com';

/** Tier classification window (Bible Sec 9). Matches FRESHNESS_HOURS_FOR_TIER
    in queries/entity.ts. JSON-LD offer emission uses this window so
    schema.org claims align with the visible page's tier badge. */
const TIER_FRESHNESS_MS = 48 * 3_600_000;

/** Brand suffix is included only when:
    1. brand is set
    2. brand is short (<=8 chars) - keeps title under search-result truncation
    3. the entity name doesn't already contain the brand
   Boards have brand baked into the name ("ASUS TUF GeForce RTX 5090 OC")
   so #3 strips the redundant suffix automatically. Chips don't ("GeForce
   RTX 5090") so the suffix shows up. */
function brandSuffixFor(entity: EntityViewModel): string {
  const b = entity.brand;
  if (!b || b.length > 8) return '';
  if (entity.name.toLowerCase().includes(b.toLowerCase())) return '';
  // Use the type's last word as the noun ("Card", "Board", "CPU")
  const cfg = getEntityTypeConfig(entity.entityType);
  const noun = cfg.label.split(' ').pop() ?? '';
  return ` \u00b7 ${b} ${noun}`.trimEnd();
}

export function buildEntityMetadata(entity: EntityViewModel): Metadata {
  const cfg = getEntityTypeConfig(entity.entityType);
  const url = `${SITE}${cfg.routePrefix}/${entity.cleanSlug}`;
  const suffix = brandSuffixFor(entity);
  const titleStr = `${entity.name} Price in Canada${suffix} \u00b7 TrackAura`;

  const { stats } = entity;
  let description: string;
  if (stats.retailerCount >= 2 && stats.activeListingCount > 0) {
    description = `Compare ${entity.name} prices across ${stats.retailerCount} Canadian retailers \u2014 ${stats.activeListingCount} active listings. Live price history, stock status, and price drop alerts. Updated every few hours.`;
  } else if (stats.retailerCount === 1) {
    description = `Live ${entity.name} price tracking in Canada. Price history, stock status, and price drop alerts. Updated every few hours.`;
  } else {
    description = `Canadian price tracking for ${entity.name}. Compare prices, view price history, and get alerts when stock returns at major Canadian retailers.`;
  }

  return {
    title: { absolute: titleStr },
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `${entity.name} Price in Canada${suffix}`,
      description,
      type: 'website',
      url,
    },
  };
}

/* --- JSON-LD --------------------------------------------------------
   Schema.org Product. Tier-aware offer emission per Bible Sec 9
   honest-labeling (2026-05-08, Active Item 3):
     - Branches (chips, tier=null): Product only, no offers field.
       The chip itself isn't sold; aggregating offers across child
       boards into a chip-level AggregateOffer is structurally
       dishonest - the chip and its boards are different products.
     - Leaves tracked / well_tracked: AggregateOffer across listings
       fresh within 48 hours (the same window the visible tier badge
       is computed against).
     - Leaves single_source: single Offer, not Aggregate. There's
       nothing to aggregate when N=1.
     - Leaves historical / encyclopedic_only: Product only, no offers.
       The visible page says "no current retail availability"; the
       schema agrees.

   ProductGroup renders poorly in Google's rich results so we emit
   Product even for branch entities - same play as before. The change
   is offer emission, not the Product wrapper.

   Now also includes image, description, releaseDate when present -
   richer payload for LLM grounding pipelines (Bible Sec 1 user 5).
   ------------------------------------------------------------------- */

function listingsFreshForTier(entity: EntityViewModel): EntityListing[] {
  const now = Date.now();
  return entity.listings.filter((l) => {
    if (l.currentPrice == null) return false;
    if (!l.lastObservedAt) return false;
    const ageMs = now - new Date(l.lastObservedAt).getTime();
    if (Number.isNaN(ageMs)) return false;
    return ageMs <= TIER_FRESHNESS_MS;
  });
}

export function buildEntityProductLd(entity: EntityViewModel) {
  const cfg = getEntityTypeConfig(entity.entityType);
  const url = `${SITE}${cfg.routePrefix}/${entity.cleanSlug}`;
  const categoryLabel = CATEGORIES[cfg.category].label;

  /* Base Product. Optional fields added only when present so the
     payload stays compact and absent fields don't get serialized
     as empty strings or nulls. */
  const product: Record<string, unknown> = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: entity.name,
    url,
    category: categoryLabel,
  };
  if (entity.brand) {
    product.brand = { '@type': 'Brand', name: entity.brand };
  }
  if (entity.imageUrl) {
    product.image = entity.imageUrl;
  }
  if (entity.description) {
    product.description = entity.description;
  }
  if (entity.releaseDate) {
    product.releaseDate = entity.releaseDate;
  }

  const tier = entity.coverageTier;

  /* Branches and historical/encyclopedic leaves: no offers. Product
     stands alone as a reference/encyclopedic record. */
  if (tier == null || tier === 'historical' || tier === 'encyclopedic_only') {
    return product;
  }

  /* Leaves with at least one fresh retailer. Pull the within-48hr
     listings directly - tier was already classified against the same
     window upstream, but defending here keeps the schema honest if
     the view model is ever stale or if a listing fell out of the
     window between classification and render. */
  const fresh = listingsFreshForTier(entity);
  if (fresh.length === 0) {
    return product;
  }

  const currency = fresh[0].currency || 'CAD';

  if (tier === 'single_source') {
    const sole = fresh[0];
    const offer: Record<string, unknown> = {
      '@type': 'Offer',
      url: sole.url || url,
      price: sole.currentPrice as number,
      priceCurrency: currency,
      availability: 'https://schema.org/InStock',
      seller: { '@type': 'Organization', name: sole.retailerName },
    };
    if (sole.isOpenBox) {
      offer.itemCondition = 'https://schema.org/UsedCondition';
    }
    product.offers = offer;
    return product;
  }

  /* tracked / well_tracked: AggregateOffer across 48hr-fresh listings. */
  const prices = fresh.map((l) => l.currentPrice as number).sort((a, b) => a - b);
  product.offers = {
    '@type': 'AggregateOffer',
    priceCurrency: currency,
    lowPrice: prices[0],
    highPrice: prices[prices.length - 1],
    offerCount: fresh.length,
    availability: 'https://schema.org/InStock',
  };
  return product;
}

export function buildEntityBreadcrumbLd(entity: EntityViewModel) {
  const cfg = getEntityTypeConfig(entity.entityType);
  const selfHref = `${cfg.routePrefix}/${entity.cleanSlug}`;

  // entity.breadcrumbs has href=null for the current (last) item only.
  // Google needs a real URL on every item, so fall back to selfHref for
  // the terminal entry.
  const items = entity.breadcrumbs.map((b, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: b.label,
    item: `${SITE}${b.href ?? selfHref}`,
  }));

  return {
    '@context': 'https://schema.org/',
    '@type': 'BreadcrumbList',
    itemListElement: items,
  };
}

/* Re-export EntityType for convenience so route files only import from
   one place. */
export type { EntityType };

import type { Metadata } from 'next';
import {
  CATEGORIES,
  getEntityTypeConfig,
  type EntityType,
} from './entity-config';
import type { EntityViewModel, EntityListing } from './queries/entity';

/* ─────────────────────────────────────────────────────────────────────
   entity-metadata.ts

   Shared Metadata + JSON-LD generators for any entity-page route.
   Mirrors the chip-page handcrafted template structure so the chip
   cutover (Step 3) doesn't regress existing search-result snippets.

   Why this lives outside the route file:
     - Phase 0 ships /board/[slug] now and /cpu/[slug] in Step 4.
     - The Bible's promise (§7) is "adding a new vertical = config entry
       + entity_type rows + scraper. No new frontend code per vertical."
     - Inlining metadata in each route file would force re-writing
       generateMetadata for every new vertical. This module makes the
       route file a thin shell.
   ───────────────────────────────────────────────────────────────────── */

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trackaura.com';

/** Brand suffix is included only when:
    1. brand is set
    2. brand is short (≤8 chars) — keeps title under search-result truncation
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
  return ` · ${b} ${noun}`.trimEnd();
}

export function buildEntityMetadata(entity: EntityViewModel): Metadata {
  const cfg = getEntityTypeConfig(entity.entityType);
  const url = `${SITE}${cfg.routePrefix}/${entity.cleanSlug}`;
  const suffix = brandSuffixFor(entity);
  const titleStr = `${entity.name} Price in Canada${suffix} · TrackAura`;

  const { stats } = entity;
  let description: string;
  if (stats.retailerCount >= 2 && stats.activeListingCount > 0) {
    description = `Compare ${entity.name} prices across ${stats.retailerCount} Canadian retailers — ${stats.activeListingCount} active listings. Live price history, stock status, and price drop alerts. Updated every few hours.`;
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

/* ─── JSON-LD ──────────────────────────────────────────────────────────
   Schema.org Product with AggregateOffer summarizing all in-stock
   listings (children's listings for branches, own listings for leaves).
   ProductGroup renders poorly in Google's rich results so we emit
   Product even for branch entities — same play as chip page today.
   ───────────────────────────────────────────────────────────────────── */

function gatherInStockListings(entity: EntityViewModel): EntityListing[] {
  const all =
    entity.children.length > 0
      ? entity.children.flatMap((c) => c.listings)
      : entity.listings;
  return all.filter((l) => l.currentPrice != null);
}

export function buildEntityProductLd(entity: EntityViewModel) {
  const cfg = getEntityTypeConfig(entity.entityType);
  const url = `${SITE}${cfg.routePrefix}/${entity.cleanSlug}`;
  const inStock = gatherInStockListings(entity);
  const categoryLabel = CATEGORIES[cfg.category].label;

  const offers =
    inStock.length > 0
      ? {
          '@type': 'AggregateOffer',
          priceCurrency: 'CAD',
          lowPrice: Math.min(...inStock.map((l) => l.currentPrice as number)),
          highPrice: Math.max(...inStock.map((l) => l.currentPrice as number)),
          offerCount: inStock.length,
          availability: 'https://schema.org/InStock',
        }
      : {
          '@type': 'Offer',
          priceCurrency: 'CAD',
          availability: 'https://schema.org/OutOfStock',
          url,
        };

  return {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: entity.name,
    brand: entity.brand ? { '@type': 'Brand', name: entity.brand } : undefined,
    category: categoryLabel,
    url,
    offers,
  };
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

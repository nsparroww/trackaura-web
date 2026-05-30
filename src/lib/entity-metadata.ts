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

   Title + description rewrite (2026-05-24, session 23):
     The previous template ("X Price in Canada · TrackAura" + generic
     "Compare X across N Canadian retailers" description) ranked at
     pos 5-10 on 'X price canada' queries and earned 0% CTR over 90
     days. The GSC audit found the competing snippets (bestvaluegpu.com,
     trackalacker) all carry concrete dollar amounts: "MSRP $749",
     "Used $780.66", "$1409 new". A searcher who typed 'rtx 5070 price
     canada' sees their numbers in 24 words and decides whether to
     click. Ours showed marketing copy.

     New template injects:
       - lowest current price in the title (tracked / single_source)
       - retailer names + low price + MSRP in the description
       - tier-aware fallback when no current price exists (historical /
         encyclopedic_only)
       - branch (chip) handling — branches have coverageTier=null but
         stats.lowestPrice rolled up from children, so chip pages get
         "from $X" using the cheapest-board price

     The brandSuffix the old template added ("· NVIDIA Card") was
     dropped — brand is implicit in chip names ("GeForce" = NVIDIA) and
     explicit in board names ("ASUS TUF GeForce RTX 5090"), so the
     suffix added clutter without click value.

   GeForce-prefix strip (2026-05-26, session 34):
     GSC per-page diagnostic on /chip/rtx-5070 found pos 8.4 / 28 imp,
     while /blog/rtx-5070-canada-price-tracking ranks pos 6.4 / 1330 imp
     for the same chip on the same money query ("rtx 5070 price canada
     2026"). Same site, same chip, 2-position gap, 47x impression gap.
     The cheapest hypothesis: title token-frontness. The blog leads with
     "RTX 5070" (the query tokens); the entity leads with "GeForce RTX
     5070" (an extra family-brand token that searchers drop colloquially
     — nobody types "GeForce RTX 5070 price canada", they type "RTX
     5070 price canada"). Stripping "GeForce " from SERP-visible surfaces
     (title, meta description, OG title/desc) isolates the variable
     against the in-flight blog measurement window. JSON-LD Product.name
     stays canonical (machine-citability — bible §1 user moment 5).
     Page body, H1, breadcrumbs all untouched (landed users see full
     canonical names; "GeForce" is informative once they're on the page).

     NVIDIA-only by design. "Radeon" is shorter and more search-active
     ("radeon rx 9070" is a common query); "Arc" is Intel's load-bearing
     brand token. If GeForce strip moves position, the test generalizes;
     until then, one variable.
   --------------------------------------------------------------------- */

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trackaura.com';

/** Tier classification window (Bible §9). Matches FRESHNESS_HOURS_FOR_TIER
    in queries/entity.ts. JSON-LD offer emission uses this window so
    schema.org claims align with the visible page's tier badge. */
const TIER_FRESHNESS_MS = 48 * 3_600_000;

/** SERP-optimized display of entity.name. Strips the "GeForce " family-
    brand prefix wherever it appears so titles + descriptions lead with
    the tokens users actually type. Leaves entity.name untouched on the
    view model — only SERP-visible string fields call this. See header
    block (s34) for rationale. */
function seoName(name: string): string {
  return name.replace(/\bGeForce\s+/gi, '').replace(/\s{2,}/g, ' ').trim();
}

/** Compact price label for titles + descriptions. No decimals — SERP
    space is precious and "from $1,599" reads cleaner than "from $1,599.00". */
function priceLabel(amount: number | null | undefined): string | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  return `$${Math.round(amount).toLocaleString('en-CA')}`;
}

/** Up to three distinct retailer names from a listing set, in the order
    they first appear. Used in the description to name who has the item
    ("at Newegg, Canada Computers, Vuugo") — concrete signal that the
    snippet isn't templated boilerplate. */
function retailerSample(listings: EntityListing[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const l of listings) {
    if (l.currentPrice == null) continue;
    if (seen.has(l.retailerName)) continue;
    seen.add(l.retailerName);
    names.push(l.retailerName);
    if (names.length >= 3) break;
  }
  return names;
}

/** Listings driving the snippet — branches roll up from children, leaves
    use their own. Sorted cheapest-first (already done upstream in the
    view model) so the first retailer named is the lowest price. */
function snippetListings(entity: EntityViewModel): EntityListing[] {
  if (entity.coverageTier == null) {
    // Branch (chip): roll up child listings.
    return entity.children.flatMap((c) => c.listings);
  }
  return entity.listings;
}

export function buildEntityMetadata(entity: EntityViewModel): Metadata {
  const cfg = getEntityTypeConfig(entity.entityType);
  const url = `${SITE}${cfg.routePrefix}/${entity.cleanSlug}`;

  const tier = entity.coverageTier;
  const isBranch = tier == null;
  const { stats } = entity;

  /* SERP-visible name. Used in title + description + OG (via title
     replace). JSON-LD and page body keep entity.name. */
  const dispName = seoName(entity.name);

  const lowPrice = priceLabel(stats.lowestPrice);
  const msrpStr = priceLabel(entity.msrp);
  const retailers = retailerSample(snippetListings(entity));
  const retailerStr = retailers.join(', ');
  const retailerCount = stats.retailerCount;

  /* ----- Title -------------------------------------------------------
     Lead with the entity name (the searcher's query terms) then "Price
     in Canada" (intent match) then the lowest dollar amount (the
     click-winning concrete number). Branch and tracked-leaf paths
     converge — both have a real "from $X" to show. Single-source drops
     "from" since there's nothing to compare. Historical leaves shift to
     "Price History" framing (no current claim made). Encyclopedic-only
     and zero-retailer branches fall to a specs-and-tracking title that
     doesn't promise prices the page can't deliver. */
  let titleStr: string;
  if (lowPrice && (isBranch || tier === 'well_tracked' || tier === 'tracked')) {
    titleStr = `${dispName} Price in Canada — from ${lowPrice} | TrackAura`;
  } else if (lowPrice && tier === 'single_source') {
    titleStr = `${dispName} — ${lowPrice} in Canada | TrackAura`;
  } else if (tier === 'historical') {
    titleStr = `${dispName} Price History in Canada | TrackAura`;
  } else if (tier === 'encyclopedic_only' || isBranch) {
    // Encyclopedic-only leaf, or a branch with no in-stock children.
    titleStr = `${dispName} — Specs & Canadian Retailers | TrackAura`;
  } else {
    // Leaf with retailers but no current price (rare; defensive fallback).
    titleStr = `${dispName} Price in Canada | TrackAura`;
  }

  /* ----- Description ------------------------------------------------
     Concrete numbers + retailer names + MSRP. The competing snippets
     that earn clicks ("MSRP $749", "Used $780.66") all share this
     shape: the price you searched for, named retailers, and an
     anchor (MSRP). Length budget ~155 chars before SERP truncation. */
  const msrpClause = msrpStr
  ? ` MSRP ${msrpStr} ${entity.msrpCurrency ?? 'CAD'}.`
  : '';

  let description: string;
  if (lowPrice && retailerCount >= 2) {
    const at = retailerStr ? ` at ${retailerStr}` : '';
    description = `${dispName} in Canada from ${lowPrice} CAD across ${retailerCount} retailers${at}. Live price history and drop alerts.${msrpClause}`;
  } else if (lowPrice && retailerCount === 1) {
    const at = retailerStr ? ` at ${retailerStr}` : '';
    description = `${dispName} listed${at}: ${lowPrice} CAD. Live price history and drop alerts.${msrpClause}`;
  } else if (tier === 'historical') {
    const lastSeen = lowPrice ? ` Last tracked at ${lowPrice} CAD.` : '';
    description = `${dispName} price history in Canada.${lastSeen} No current retail availability — we'll notify you when stock returns.${msrpClause}`;
  } else if (isBranch || tier === 'encyclopedic_only') {
    description = `${dispName} specs and Canadian retailer tracking. We monitor major Canadian electronics retailers and notify you when listings appear.${msrpClause}`;
  } else {
    description = `Track ${dispName} prices across Canadian retailers. Price history charts and drop alerts.${msrpClause}`;
  }

  /* Defensive truncation. Google rewrites overlong descriptions anyway,
     but a clean cut at 160 chars beats a midword ellipsis from the
     SERP engine. */
  if (description.length > 160) {
    description = description.slice(0, 157).trimEnd() + '…';
  }

  return {
    title: { absolute: titleStr },
    description,
    alternates: { canonical: url },
    openGraph: {
      // OG title drops the " | TrackAura" — the site name shows up in
      // OG metadata fields instead, and social previews look cleaner
      // without the suffix.
      title: titleStr.replace(/ \| TrackAura$/, ''),
      description,
      type: 'website',
      url,
    },
  };
}

/* --- JSON-LD --------------------------------------------------------
   Schema.org Product. Tier-aware offer emission per Bible §9
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
   richer payload for LLM grounding pipelines (Bible §1 user 5).

   NOTE (s34, 2026-05-26): JSON-LD Product.name uses entity.name
   (canonical, includes "GeForce" prefix) by design. SERP titles strip
   the prefix via seoName(); machine-citation surfaces keep the full
   canonical for unambiguous grounding.
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
  if (entity.variants.length > 0) {
    /* schema.org/isSimilarTo: functionally similar products. For
       variant_of edges (same generation / architecture, different
       SKU) this is more accurate than isRelatedTo, which schema.org
       reserves for "related but not necessarily similar". Minimal
       payload (name + url) lets grounding pipelines fan out to each
       variant's own Product LD if more detail is needed (Bible
       §1 user moment 5). */
    product.isSimilarTo = entity.variants.map((v) => ({
      '@type': 'Product',
      name: v.name,
      url: `${SITE}${v.routePrefix}/${v.cleanSlug}`,
    }));
  }

  /* Worth estimate (WORTH_ENGINE_SPEC) as schema.org additionalProperty --
     the machine-citable worth tuple /for-llms advertises. Emitted only when
     a publishable estimate exists; absent (not null/empty) otherwise, so a
     grounding pipeline never reads a worth claim the engine declined to make.
     Independent of offers: worth is a synthesized index (median over recent
     observations), offers are live retail listings -- different claims, kept
     distinct. PropertyValue is schema.org's standard named-value container,
     parsed natively by grounding consumers. worthAsOf carries the freshest
     observation date so the as-of honesty (bible Section 6) survives caching. */
  if (entity.worth) {
    product.additionalProperty = [
      {
        '@type': 'PropertyValue',
        propertyID: 'worth-estimate-cad',
        name: 'Worth estimate (CAD)',
        value: entity.worth.estimate,
        unitText: 'CAD',
      },
      {
        '@type': 'PropertyValue',
        propertyID: 'worth-confidence',
        name: 'Worth confidence (0-1)',
        value: entity.worth.confidence,
      },
      {
        '@type': 'PropertyValue',
        propertyID: 'worth-source-tier',
        name: 'Worth source tier',
        value: entity.worth.sourceTier,
      },
      {
        '@type': 'PropertyValue',
        propertyID: 'worth-as-of',
        name: 'Worth as-of date',
        value: entity.worth.asOf,
      },
    ];
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

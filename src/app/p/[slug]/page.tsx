import { notFound, permanentRedirect } from 'next/navigation';
import type { Metadata } from 'next';
import ProductPage from '@/components/product/ProductPage';
import {
  getProductViewModel,
  type ProductViewModel,
} from '@/lib/queries/product';
import { getChipParent } from '@/lib/queries/enrichment';

type Params = { slug: string };

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trackaura.com';

/* ────────────────────────────────────────────────────────────────────
   Slug resolution

   Background: 80.5% of canonical_products rows have a duplicated brand
   prefix in their slug (e.g. `asus-asus-rog-...`) due to an old
   slug-generation function that prepended `brand` even when `name`
   already started with brand. Modern slugify (utils/slug.py) is correct,
   but legacy slugs are preserved by nr_to_slug.

   Sitemap, JSON-LD, and internal links all emit the modern (clean) form.
   External traffic — Google index, AI citations, RFD/Reddit links — uses
   the clean form. So clean-form requests 404 against the legacy DB rows.

   Resolver behaviour:
     1. Look up requested slug as-is. Covers clean DB rows (4%), no-brand
        rows (15%), and legacy-form requests where DB matches.
     2. On miss, prepend first segment ("asus-rog-..." → "asus-asus-rog-...")
        and try again. Covers the 80.5% legacy-DB / clean-URL case.
     3. If the requested slug was itself the legacy duplicated form, return
        a redirect flag so the page issues a 308 to the clean URL.
     4. In all hit cases, override product.slug to the clean form so
        canonical URLs, JSON-LD, and internal links emit the clean URL.

   DB stays untouched. Slug rebuild (per §12 TBD) is deferred.
   ──────────────────────────────────────────────────────────────────── */

/**
 * Strip a duplicated first-segment prefix (e.g. `asus-asus-rog-x` → `asus-rog-x`).
 * Only matches when segment 1 literally equals segment 2; everything else passes through.
 */
function dedupeFirstSegment(slug: string): string {
  const idx = slug.indexOf('-');
  if (idx <= 0) return slug;
  const first = slug.slice(0, idx);
  const rest = slug.slice(idx + 1);
  if (rest.startsWith(first + '-')) return rest;
  return slug;
}

type Resolution = {
  product: ProductViewModel | null;
  needsRedirect: boolean;
  canonicalSlug: string | null;
};

async function resolveProduct(requestedSlug: string): Promise<Resolution> {
  // 1. Try the slug exactly as requested.
  let product = await getProductViewModel(requestedSlug);
  if (product) {
    const cleaned = dedupeFirstSegment(requestedSlug);
    if (cleaned !== requestedSlug) {
      // Legacy duplicated-prefix request hit a legacy DB row → redirect to clean.
      return {
        product: { ...product, slug: cleaned },
        needsRedirect: true,
        canonicalSlug: cleaned,
      };
    }
    // Clean request, clean DB row (the 4% case) or no-brand-prefix case.
    return {
      product,
      needsRedirect: false,
      canonicalSlug: requestedSlug,
    };
  }

  // 2. Miss. Try the legacy duplicated form (the 80.5% case).
  const idx = requestedSlug.indexOf('-');
  if (idx > 0) {
    const first = requestedSlug.slice(0, idx);
    const legacyAttempt = `${first}-${requestedSlug}`;
    product = await getProductViewModel(legacyAttempt);
    if (product) {
      // Render at the clean URL. Override product.slug to clean.
      return {
        product: { ...product, slug: requestedSlug },
        needsRedirect: false,
        canonicalSlug: requestedSlug,
      };
    }
  }

  // 3. Genuine miss.
  return { product: null, needsRedirect: false, canonicalSlug: null };
}

/* ────────────────────────────────────────────────────────────────────
   Metadata (SEO)

   Targets identified from GSC top queries (2026-05-02 baseline, 0.6% CTR
   against 38.8K impressions over 3 months):
     - `canada computers price history`
     - `electronics price tracker`
     - `newegg vs canada computers`
     - `intel b70 canada`, `armoury a08` (specific-product, lower volume)

   Decisions:
     - Title leads with product name (matches specific-product searches)
     - "Price in Canada" hook second (matches Canadian-intent searches)
     - No "· TrackAura" suffix — product names are already long, brand is
       in URL/OG/JSON-LD, no need to spend chars
     - No dynamic price in title — Google's SERP snapshot lags actual price
       by days/weeks; stale numbers in the SERP are a credibility hit
     - Description leads with `Compare X at {retailer1} and {retailer2}`
       (matches comparison-intent queries directly)
     - Description includes `price history` + `price drop alerts` language
       (matches `canada computers price history` and intent-to-track queries)
   ──────────────────────────────────────────────────────────────────── */

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { product } = await resolveProduct(slug);
  if (!product) return { title: 'Product not found · TrackAura' };

  const title = `${product.title} — Price in Canada`;

  // Build description from retailer count + names. Falls back gracefully
  // when retailer data is sparse.
  const activeRetailers = product.retailers.filter((r) => r.price != null);
  const retailerCount = activeRetailers.length;

  let description: string;
  if (retailerCount >= 2) {
    const [first, second, ...rest] = activeRetailers.map((r) => r.name);
    const retailerList =
      rest.length > 0
        ? `${first}, ${second}, and ${rest.length} more`
        : `${first} and ${second}`;
    description = `Compare ${product.title} prices at ${retailerList}. Canadian price history, stock status, and price drop alerts. Updated every few hours.`;
  } else if (retailerCount === 1) {
    description = `Track ${product.title} at ${activeRetailers[0].name} in Canada. Price history, stock status, and price drop alerts. Updated every few hours.`;
  } else {
    description = `Canadian price history for ${product.title}. Get notified when it returns to stock at major Canadian retailers including Canada Computers, Newegg Canada, Vuugo, and Visions.`;
  }

  return {
    title,
    description,
    alternates: { canonical: `${SITE}/p/${product.slug}` },
    openGraph: product.imageUrl
      ? {
          title,
          description,
          images: [product.imageUrl],
          type: 'website',
          url: `${SITE}/p/${product.slug}`,
        }
      : undefined,
  };
}

/* ────────────────────────────────────────────────────────────────────
   JSON-LD builders

   Google reads these as structured data and uses them to render rich
   product snippets in search results (price, availability, brand,
   breadcrumbs). See:
   https://developers.google.com/search/docs/appearance/structured-data/product
   ──────────────────────────────────────────────────────────────────── */

function buildProductJsonLd(product: ProductViewModel) {
  const url = `${SITE}/p/${product.slug}`;
  const inStockRetailers = product.retailers.filter(
    (r) => r.inStock && r.price != null,
  );

  // Each retailer becomes an Offer. If none are in stock, mark as OutOfStock
  // on a single placeholder offer (Google requires at least one offer node).
  const offers =
    inStockRetailers.length > 0
      ? inStockRetailers.map((r) => ({
          '@type': 'Offer',
          price: r.price,
          priceCurrency: 'CAD',
          availability: 'https://schema.org/InStock',
          url: r.url ?? url,
          seller: { '@type': 'Organization', name: r.name },
          itemCondition: r.isOpenBox
            ? 'https://schema.org/UsedCondition'
            : 'https://schema.org/NewCondition',
        }))
      : [
          {
            '@type': 'Offer',
            priceCurrency: 'CAD',
            availability: 'https://schema.org/OutOfStock',
            url,
          },
        ];

  // AggregateOffer gives Google the price range at a glance; helpful when
  // multiple retailers are present.
  const aggregateOffer =
    inStockRetailers.length > 1
      ? {
          '@type': 'AggregateOffer',
          priceCurrency: 'CAD',
          lowPrice: Math.min(...inStockRetailers.map((r) => r.price as number)),
          highPrice: Math.max(...inStockRetailers.map((r) => r.price as number)),
          offerCount: inStockRetailers.length,
          availability: 'https://schema.org/InStock',
        }
      : null;

  return {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: product.title,
    description: product.blurb ?? undefined,
    image: product.imageUrl ?? undefined,
    brand: product.brand
      ? { '@type': 'Brand', name: product.brand }
      : undefined,
    sku: product.sku ?? undefined,
    category: product.category,
    url,
    ...(aggregateOffer ? { offers: aggregateOffer } : { offers }),
  };
}

function buildBreadcrumbJsonLd(product: ProductViewModel) {
  const items = [
    { label: 'Home', href: '/' },
    ...product.breadcrumbs,
    { label: product.title, href: `/p/${product.slug}` },
  ].map((c, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: c.label,
    item: `${SITE}${c.href}`,
  }));

  return {
    '@context': 'https://schema.org/',
    '@type': 'BreadcrumbList',
    itemListElement: items,
  };
}

/* ──────────────────────────────────────────────────────────────────── */

export default async function Page({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const { product, needsRedirect, canonicalSlug } = await resolveProduct(slug);
  if (!product) notFound();

  // Legacy duplicated-prefix URL → 308 to the clean form. permanentRedirect
  // throws a control-flow exception that Next catches; nothing below this
  // line runs on the redirect path.
  if (needsRedirect && canonicalSlug) {
    permanentRedirect(`/p/${canonicalSlug}`);
  }

  // Best-effort chip-parent enrichment. Joins via listing URLs, which
  // are stable across the canonical_products → canonical_entities
  // migration. Returns null for non-GPU pages, for GPU pages whose
  // listings haven't been ingested into the new schema yet, or for
  // entities without a chip parent. The page just doesn't render the
  // chip section in those cases.
  const retailerUrls = product.retailers
    .map((r) => r.url)
    .filter((u): u is string => !!u);
  const chipParent = retailerUrls.length
    ? await getChipParent(retailerUrls).catch((err) => {
        console.error('[product] chip parent enrichment failed:', err);
        return null;
      })
    : null;

  const productLd = buildProductJsonLd(product);
  const breadcrumbLd = buildBreadcrumbJsonLd(product);

  return (
    <>
      {/*
        JSON-LD emitted inline. Next.js streams this with the rest of the
        HTML — Google reads it directly, no client JS required.
      */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <ProductPage product={product} chipParent={chipParent} />
    </>
  );
}

// Revalidate every hour. Bumped from 5min on 2026-05-09 in response to
// AI-bot crawl wave (76K edge requests / 12hr from ClaudeBot, GPTBot,
// Amazonbot, AppleBot et al.) saturating Supabase Nano-tier connections.
// 5-min ISR was being missed on every unique slug because bots crawl
// breadth-first; 60-min window means the first bot to hit a slug
// populates the cache for the next hour of bot traffic on that slug.
// Browser users still get fresh data via ISR — 1hr lag on canonical
// product info is well within acceptable freshness for a price tracker
// (scraper cadence is hourly, retailer pricing rarely changes faster
// than once per day in practice).
export const revalidate = 3600;

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import CategoryPage from '@/components/category/CategoryPage';
import {
  getCategoryViewModel,
  type CategoryViewModel,
} from '@/lib/queries/category';
import { getCategoryEntityViewModel } from '@/lib/queries/category-entity';
import { getCategoryEntityConfig } from '@/lib/category-entity-map';
import { Suspense } from 'react';

type Params = { slug: string };

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trackaura.com';

type LoadedCategory = {
  cat: CategoryViewModel;
  routePrefix: string;
};

async function loadCategory(slug: string): Promise<LoadedCategory | null> {
  // Migrated verticals: try the canonical_entities RPC first.
  const entityConfig = getCategoryEntityConfig(slug);
  if (entityConfig) {
    const cat = await getCategoryEntityViewModel(
      slug,
      entityConfig.entityType,
    );
    if (cat) return { cat, routePrefix: entityConfig.routePrefix };
    // Fall through to v0 if the RPC errors or returns nothing. Protects
    // the live site during the migration window.
  }
  // Unmigrated verticals (and migration fallback): canonical_products path.
  const cat = await getCategoryViewModel(slug);
  if (!cat) return null;
  return { cat, routePrefix: '/p' };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await loadCategory(slug);
  if (!loaded) return { title: 'Category not found - TrackAura' };
  const { cat } = loaded;

  return {
    title: `${cat.name} - Live Prices in Canada - TrackAura`,
    description: `Compare live prices for ${cat.stats.totalProducts.toLocaleString()} ${cat.name.toLowerCase()} across Canadian retailers. Price history, deal alerts, and all-time-low tracking.`,
    alternates: { canonical: `${SITE}/c/${slug}` },
    openGraph: {
      title: `${cat.name} - Live Prices in Canada`,
      description: `${cat.stats.totalProducts.toLocaleString()} products. ${cat.stats.atLowest} at all-time low.`,
      type: 'website',
      url: `${SITE}/c/${slug}`,
    },
  };
}

function buildCollectionJsonLd(
  cat: CategoryViewModel,
  routePrefix: string,
) {
  // Top 20 in-stock priced products go into the ItemList for crawler hints.
  const topProducts = cat.products
    .filter((p) => p.inStock && p.bestPrice != null)
    .slice(0, 20);

  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${cat.name} Prices in Canada`,
    url: `${SITE}/c/${cat.slug}`,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: cat.stats.totalProducts,
      itemListElement: topProducts.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE}${routePrefix}/${p.slug}`,
        name: p.name,
      })),
    },
  };
}

function buildBreadcrumbJsonLd(cat: CategoryViewModel) {
  // Matches ARCHITECTURE Â§7 spec: Home / Category at the list level.
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: `${SITE}/`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: cat.name,
        item: `${SITE}/c/${cat.slug}`,
      },
    ],
  };
}

export default async function Page({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const loaded = await loadCategory(slug);
  if (!loaded) notFound();

  const { cat, routePrefix } = loaded;
  const collectionLd = buildCollectionJsonLd(cat, routePrefix);
  const breadcrumbLd = buildBreadcrumbJsonLd(cat);

  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionLd) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <Suspense fallback={null}>
        <CategoryPage category={cat} entityRoutePrefix={routePrefix} />
      </Suspense>
    </>
  );
}

// Revalidate every 10 minutes. Categories change less often than individual
// product prices, and a heavier query benefits from longer caching.
export const revalidate = 600;
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ISR co-requisites (Bible Protocol #37, 2026-05-09 next-session). The
// `export const revalidate` above is silently ignored on dynamic-segment
// routes without these two: generateStaticParams() returning [] = no
// paths prerendered at build, dynamicParams=true = generate-and-cache
// on first visit, serve from edge cache thereafter. Prerequisite:
// queries/category.ts and queries/brand.ts now use createCatalogClient()
// (cookie-free) â€” was hidden render-graph blocker analogous to
// entity-slug.ts in Group A.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function generateStaticParams() {
  return [];
}

export const dynamicParams = true;
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import BrandInCategoryPage from '@/components/brand/BrandInCategoryPage';
import {
  getBrandInCategoryViewModel,
  type BrandInCategoryViewModel,
} from '@/lib/queries/brand';

type Params = { slug: string; brand: string };

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trackaura.com';

// Pages with fewer than this many products are sparse / dilutive in
// Google's eyes and harm domain-wide rankings. They still render to
// humans (someone may link directly) and PageRank still flows through
// the in-stock product links — we hide them from Search only.
const SPARSE_PAGE_THRESHOLD = 50;

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug, brand } = await params;
  const vm = await getBrandInCategoryViewModel(slug, brand);
  if (!vm) return { title: 'Not found · TrackAura' };

  const isSparse = vm.stats.totalProducts < SPARSE_PAGE_THRESHOLD;

  return {
    title: `${vm.brandName} ${vm.categoryName} — Live Prices in Canada · TrackAura`,
    description: `Compare live Canadian prices for ${vm.stats.totalProducts.toLocaleString()} ${vm.brandName} ${vm.categoryName.toLowerCase()}. Price history, deal alerts, and all-time-low tracking.`,
    alternates: { canonical: `${SITE}/c/${slug}/b/${brand}` },
    robots: isSparse ? { index: false, follow: true } : undefined,
    openGraph: {
      title: `${vm.brandName} ${vm.categoryName} — Live Prices in Canada`,
      description: `${vm.stats.totalProducts.toLocaleString()} products · ${vm.stats.atLowest} at all-time low`,
      type: 'website',
      url: `${SITE}/c/${slug}/b/${brand}`,
    },
  };
}

function buildCollectionJsonLd(vm: BrandInCategoryViewModel) {
  const topProducts = vm.products
    .filter((p) => p.inStock && p.bestPrice != null)
    .slice(0, 20);

  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${vm.brandName} ${vm.categoryName} Prices in Canada`,
    url: `${SITE}/c/${vm.categorySlug}/b/${vm.brandSlug}`,
    about: { '@type': 'Brand', name: vm.brandName },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: vm.stats.totalProducts,
      itemListElement: topProducts.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE}/p/${p.slug}`,
        name: p.name,
      })),
    },
  };
}

function buildBreadcrumbJsonLd(vm: BrandInCategoryViewModel) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Products',
        item: `${SITE}/products`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: vm.categoryName,
        item: `${SITE}/c/${vm.categorySlug}`,
      },
      {
        '@type': 'ListItem',
        position: 4,
        name: vm.brandName,
        item: `${SITE}/c/${vm.categorySlug}/b/${vm.brandSlug}`,
      },
    ],
  };
}

export default async function Page({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug, brand } = await params;
  const vm = await getBrandInCategoryViewModel(slug, brand);
  if (!vm) notFound();

  const collectionLd = buildCollectionJsonLd(vm);
  const breadcrumbLd = buildBreadcrumbJsonLd(vm);

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
      <BrandInCategoryPage vm={vm} />
    </>
  );
}

export const revalidate = 600;

// ────────────────────────────────────────────────────────────────────
// ISR co-requisites (Bible Protocol #37, 2026-05-09 next-session). The
// `export const revalidate` above is silently ignored on dynamic-segment
// routes without these two: generateStaticParams() returning [] = no
// paths prerendered at build, dynamicParams=true = generate-and-cache
// on first visit, serve from edge cache thereafter. Prerequisite:
// queries/category.ts and queries/brand.ts now use createCatalogClient()
// (cookie-free) — was hidden render-graph blocker analogous to
// entity-slug.ts in Group A.
// ────────────────────────────────────────────────────────────────────
export async function generateStaticParams() {
  return [];
}

export const dynamicParams = true;

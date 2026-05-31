import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';
import type { Metadata } from 'next';
import EntityPage from '@/components/entity/EntityPage';
import {
  resolveEntitySlug,
  type EntitySlugResolution,
} from '@/lib/entity-slug';
import {
  getEntityViewModel,
  type EntityViewModel,
} from '@/lib/queries/entity';
import {
  buildEntityMetadata,
  buildEntityProductLd,
  buildEntityBreadcrumbLd,
} from '@/lib/entity-metadata';
type Params = { slug: string };
const ENTITY_TYPE = 'ssd' as const;
/* ---------------------------------------------------------------------------
   /ssd/[slug]
   VERTICALBACKLOG #5 route. Renders any entity_type='ssd'
   canonical_entities row with EntityPage. 1-level leaf vertical
   (no parent, no children) -- Home / SSDs / Item. Direct copy of
   /ram/[slug] with ENTITY_TYPE swapped.
   cleanSlugBrandPrefixes is [] (SSD slugs lead with brand by design;
   URL = DB slug, RAM/motherboard precedent), so
   resolution.needsRedirect never fires here -- the redirect block is kept
   for parity, harmless.
   Catalog seeded from existing retailer scrapes (580 drives, 2026-05-31),
   not a new catalog source. The /c/ssds category alias in
   category-entity-map.ts ships separately, after this route verifies
   (Bible Protocol #35: route file can lead, category alias follows).
   Bible Protocol #16: src/proxy.ts and next.config.ts redirects() intercept
   BEFORE this route handler. Confirm /ssd/* isn't matched by either
   before testing --
     git grep '/ssd' next.config.ts src/proxy.ts src/lib/bot-policy.ts
   from the trackaura-web repo root.
   --------------------------------------------------------------------------- */
const resolveSsdPage = cache(
  async (
    slug: string,
  ): Promise<{
    resolution: EntitySlugResolution;
    entity: EntityViewModel | null;
  }> => {
    const resolution = await resolveEntitySlug(slug, ENTITY_TYPE);
    if (resolution.entityId == null) return { resolution, entity: null };
    const entity = await getEntityViewModel(resolution.entityId, ENTITY_TYPE);
    return { resolution, entity };
  },
);
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { entity } = await resolveSsdPage(slug);
  if (!entity) return { title: { absolute: 'SSD not found \u00B7 TrackAura' } };
  return buildEntityMetadata(entity);
}
export default async function Page({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const { resolution, entity } = await resolveSsdPage(slug);
  if (resolution.entityId == null) notFound();
  // cleanSlugBrandPrefixes [] -> needsRedirect never true; kept for parity.
  if (resolution.needsRedirect) {
    permanentRedirect(`/ssd/${resolution.cleanSlug}`);
  }
  if (!entity) notFound();
  const productLd = buildEntityProductLd(entity);
  const breadcrumbLd = buildEntityBreadcrumbLd(entity);
  return (
    <>
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
      <EntityPage entity={entity} />
    </>
  );
}
// Match /p, /chip, /board, /cpu, /monitor, /motherboard, /ram cadence: scraper
// runs are slower than 5min so don't hit the DB on every pageview.
export const revalidate = 300;
/* ISR opt-in (Bible Protocol #37) -- see /chip/[slug]/page.tsx for full context. */
export async function generateStaticParams(): Promise<Array<Params>> {
  return [];
}
export const dynamicParams = true;

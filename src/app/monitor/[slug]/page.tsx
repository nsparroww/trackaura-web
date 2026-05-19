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

const ENTITY_TYPE = 'monitor' as const;

/* ---------------------------------------------------------------------------
   /monitor/[slug]

   Active queue Item 7 route. Renders any entity_type='monitor'
   canonical_entities row with EntityPage. 1-level leaf vertical
   (no parent, no children) -- Home / Monitors / Item. Direct copy of
   /cpu/[slug] with ENTITY_TYPE swapped; the only behavioural difference
   is that the brand-prefix redirect genuinely fires here (monitor has
   cleanSlugBrandPrefixes ['lg-', 'asus-'], CPU had []).

   Catalog is fed: LG ingest (462 rows, 2026-05-11) + ASUS ingest
   (296 rows, 2026-05-18). The /c/monitors category alias in
   category-entity-map.ts ships separately, after this route verifies
   (Bible Protocol #35: route file can lead, category alias follows).

   Bible Protocol #16: src/proxy.ts and next.config.ts redirects()
   intercept BEFORE this route handler. Confirm /monitor/* isn't matched
   by either before testing --
     git grep '/monitor' next.config.ts src/proxy.ts src/lib/bot-policy.ts
   from the trackaura-web repo root.
   --------------------------------------------------------------------------- */

const resolveMonitorPage = cache(
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
  const { entity } = await resolveMonitorPage(slug);
  if (!entity) return { title: { absolute: 'Monitor not found Â· TrackAura' } };
  return buildEntityMetadata(entity);
}

export default async function Page({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const { resolution, entity } = await resolveMonitorPage(slug);

  if (resolution.entityId == null) notFound();

  // monitor has cleanSlugBrandPrefixes ['lg-', 'asus-'] -- legacy
  // brand-prefixed URLs (/monitor/lg-27gl850-b) 308 to the
  // brand-stripped canonical form (/monitor/27gl850-b).
  if (resolution.needsRedirect) {
    permanentRedirect(`/monitor/${resolution.cleanSlug}`);
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

// Match /p/[slug], /chip/[slug], /board/[slug], /cpu/[slug] cadence:
// scraper runs are slower than 5min so don't hit the DB on every pageview.
export const revalidate = 300;

/* ISR opt-in (Bible Protocol #37, 2026-05-15) -- see /chip/[slug]/page.tsx for full context. */
export async function generateStaticParams(): Promise<Array<Params>> {
  return [];
}

export const dynamicParams = true;

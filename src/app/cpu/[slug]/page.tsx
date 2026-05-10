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

const ENTITY_TYPE = 'cpu' as const;

/* ────────────────────────────────────────────────────────────────────────
   /cpu/[slug]

   Step-4 route. Renders any entity_type='cpu' canonical_entities row
   with EntityPage. Direct copy of /board/[slug] with ENTITY_TYPE
   swapped — proves the EntityPage abstraction works for a non-GPU
   vertical with zero new render code.

   CPU catalog ingested 2026-05-09 (Intel ARK; 783 SKUs). AMD CPU
   catalog queued in ROADMAP active queue. No scrapers know about CPUs
   yet — every CPU page renders honest-labeling encyclopedic_only tier
   until ROADMAP active queue Item 5 (CPU retailer linkage) ships.

   Bible Protocol #16: src/proxy.ts and next.config.ts redirects()
   intercept BEFORE this route handler. Confirm /cpu/* isn't matched
   by either before testing —
     git grep '/cpu' next.config.ts src/proxy.ts src/lib/bot-policy.ts
   from the trackaura-web repo root.
   ──────────────────────────────────────────────────────────────────── */

const resolveCpuPage = cache(
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
  const { entity } = await resolveCpuPage(slug);
  if (!entity) return { title: { absolute: 'CPU not found · TrackAura' } };
  return buildEntityMetadata(entity);
}

export default async function Page({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const { resolution, entity } = await resolveCpuPage(slug);

  if (resolution.entityId == null) notFound();

  // cpu has cleanSlugBrandPrefixes=[] so needsRedirect is structurally
  // always false today. Check stays for symmetry with /chip and any
  // future leaf vertical that registers brand prefixes.
  if (resolution.needsRedirect) {
    permanentRedirect(`/cpu/${resolution.cleanSlug}`);
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

// Match /p/[slug], /chip/[slug], /board/[slug] cadence: scraper runs
// are slower than 5min so don't hit the DB on every pageview.
export const revalidate = 300;

// ISR co-requisites (Bible Protocol #37, 2026-05-09 next-session). With
// revalidate above, these engage on-demand-cached ISR: empty array = no
// paths prerendered at build, dynamicParams=true = generate-and-cache
// on first visit, serve from edge cache thereafter. Prerequisite: every
// Supabase callsite in the render graph (entity-slug.ts, entity.ts)
// uses createCatalogClient(). Verified pattern: /chip/[slug] flipped to
// ● after the same patch landed.
export async function generateStaticParams() {
  return [];
}

export const dynamicParams = true;

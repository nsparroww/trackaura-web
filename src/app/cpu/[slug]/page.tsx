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

/* ─────────────────────────────────────────────────────────────────────
   /cpu/[slug]

   Step-4 route. Renders any entity_type='cpu' canonical_entities row
   with EntityPage. Direct copy of /board/[slug] with ENTITY_TYPE
   swapped — proves the EntityPage abstraction works for a non-GPU
   vertical with zero new render code.

   No CPU catalog yet (pending Item 4 — catalog source + scraper).
   Until then resolveEntitySlug returns entityId=null for every /cpu/*
   request because no rows of entity_type='cpu' exist, and the page
   notFound()s. /c/cpus and /c/processors are wired in
   category-entity-map.ts and will render an empty CategoryPage grid
   via the new canonical_entities read path until rows land.

   Bible Protocol #16: src/proxy.ts and next.config.ts redirects()
   intercept BEFORE this route handler. Confirm /cpu/* isn't matched
   by either before testing —
     git grep '/cpu' next.config.ts src/proxy.ts src/lib/bot-policy.ts
   from the trackaura-web repo root.
   ───────────────────────────────────────────────────────────────────── */

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

/* ISR opt-in (Bible Protocol #37, 2026-05-15) -- see /chip/[slug]/page.tsx for full context. */
export async function generateStaticParams(): Promise<Array<Params>> {
  return [];
}

export const dynamicParams = true;
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

const ENTITY_TYPE = 'cpu_microarch' as const;

/* ─────────────────────────────────────────────────────────────────────────────
   /cpu-microarch/[slug]

   Phase 3 of microarch migration (Active queue Item 4, 2026-05-11).
   Renders any entity_type='cpu_microarch' canonical_entities row with
   EntityPage. Branch entity — children section (CPUs) but no own
   listings section (microarchs aren't sold).

   40 microarch entities live today: 36 Intel codenames (Tiger Lake,
   Meteor Lake, etc) + 4 AMD architectures (Zen 2/3/4/5). Parent grain
   differs by vendor per Bible §5; this route renders both uniformly.

   Inherits encyclopedic content (image + description) from Wikipedia
   REST page/summary, loaded at ingest time. Leaf CPUs already inherit
   this via getEntityViewModel parent-column fallback — this route makes
   the parent itself directly browseable.

   Bible Protocol #16: src/proxy.ts and next.config.ts redirects()
   intercept BEFORE this route handler. Confirm /cpu-microarch/* isn't
   matched by either before testing —
     git grep '/cpu-microarch' next.config.ts src/proxy.ts src/lib/bot-policy.ts
   from the trackaura-web repo root.
   ───────────────────────────────────────────────────────────────────────── */

const resolveMicroarchPage = cache(
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
  const { entity } = await resolveMicroarchPage(slug);
  if (!entity) {
    return { title: { absolute: 'Microarchitecture not found · TrackAura' } };
  }
  return buildEntityMetadata(entity);
}

export default async function Page({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const { resolution, entity } = await resolveMicroarchPage(slug);

  if (resolution.entityId == null) notFound();

  // cpu_microarch has cleanSlugBrandPrefixes=[] so needsRedirect is
  // structurally always false today. Check stays for symmetry.
  if (resolution.needsRedirect) {
    permanentRedirect(`/cpu-microarch/${resolution.cleanSlug}`);
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

// Match /chip /board /cpu cadence: scraper runs are slower than 5min
// so don't hit the DB on every pageview.
export const revalidate = 300;

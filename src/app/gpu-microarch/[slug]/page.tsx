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

const ENTITY_TYPE = 'gpu_microarch' as const;

/* ──────────────────────────────────────────────────────────────────────
   /gpu-microarch/[slug]

   Mirror of /cpu-microarch/[slug]. Renders any entity_type='gpu_microarch'
   canonical_entities row with EntityPage. Branch entity — children
   section (GPU chips) but no own listings (microarchs aren't sold).

   57 microarch entities live: 19 NVIDIA architectures (Ada Lovelace,
   Ampere, Blackwell, ...), 19 AMD (CDNA, GCN, RDNA, Terascale, VLIW),
   19 Intel (Generation, Knights, PowerVR, Xe). All slugs are
   brand-prefixed in DB; cleanSlugBrandPrefixes in entity-config.ts
   strips them for canonical /gpu-microarch/ada-lovelace shape.

   Closes the session 23 smoke log warning:
     "[entity] breadcrumb walk hit unregistered entity_type='gpu_microarch'"
   The walk was already reaching microarch rows via chip.parent_entity_id;
   it just had no registered config to render them. Now it does, plus
   this route makes them directly browseable.

   Bible Protocol #16: src/proxy.ts and next.config.ts redirects()
   intercept BEFORE this route handler. Confirm /gpu-microarch/* isn't
   matched by either before testing —
     git grep '/gpu-microarch' next.config.ts src/proxy.ts src/lib/bot-policy.ts
   from the trackaura-web repo root.
   ────────────────────────────────────────────────────────────────────── */

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

  // gpu_microarch has cleanSlugBrandPrefixes=['nvidia-', 'amd-', 'intel-'].
  // A request for /gpu-microarch/nvidia-ada-lovelace 308s to the
  // brand-stripped /gpu-microarch/ada-lovelace form.
  if (resolution.needsRedirect) {
    permanentRedirect(`/gpu-microarch/${resolution.cleanSlug}`);
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

/* ISR opt-in (Bible Protocol #37, 2026-05-15) -- see /chip/[slug]/page.tsx for full context. */
export async function generateStaticParams(): Promise<Array<Params>> {
  return [];
}

export const dynamicParams = true;

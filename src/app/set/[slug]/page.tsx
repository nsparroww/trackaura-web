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

const ENTITY_TYPE = 'lego_set' as const;

/* -------------------------------------------------------------------------
   /set/[slug]

   Phase 1 LEGO collectibles vertical (2026-05-19). Mirrors /chip/[slug]
   and /cpu/[slug] cadence -- shared EntityPage + entity resolver +
   metadata builders, no per-vertical custom code.

   lego_set has no brand-prefix slug normalization -- set slugs are
   '<name>-<set_num>' by construction (Rebrickable's set_num is the
   universal LEGO catalog identifier). The needsRedirect branch is
   kept for parity with the other route files but is structurally
   inert until/unless aliases are added.

   Bible Protocol #16: src/proxy.ts and next.config.ts redirects()
   intercept BEFORE this route handler. /set/* prefix is new; no
   existing redirects target it.
   ------------------------------------------------------------------------- */

const resolveSetPage = cache(
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
  const { entity } = await resolveSetPage(slug);
  if (!entity) return { title: { absolute: 'LEGO set not found · TrackAura' } };
  return buildEntityMetadata(entity);
}

export default async function Page({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const { resolution, entity } = await resolveSetPage(slug);

  if (resolution.entityId == null) notFound();

  if (resolution.needsRedirect) {
    permanentRedirect(`/set/${resolution.cleanSlug}`);
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

/* -------------------------------------------------------------------------
   ISR opt-in (Bible Protocol #37)
   ------------------------------------------------------------------------- */

export async function generateStaticParams(): Promise<Array<Params>> {
  return [];
}

export const dynamicParams = true;
export const revalidate = 300;

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

const ENTITY_TYPE = 'lego_theme' as const;

/* -------------------------------------------------------------------------
   /theme/[slug]

   Phase 1 LEGO collectibles vertical (2026-05-19). Branch entity --
   the children grid renders the lego_sets parented to this theme.

   Theme slugs are 'theme-<id>-<name>' by construction (e.g.,
   'theme-158-star-wars'). No brand-prefix normalization, no aliases.

   Three-level tree: a lego_theme can itself parent another lego_theme
   (e.g., Star Wars > UCS), and the leaf lego_set parents under the
   deepest theme. EntityPage's breadcrumb walks parent_entity_id
   recursively per Bible Section 7; no per-level code.
   ------------------------------------------------------------------------- */

const resolveThemePage = cache(
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
  const { entity } = await resolveThemePage(slug);
  if (!entity) return { title: { absolute: 'LEGO theme not found · TrackAura' } };
  return buildEntityMetadata(entity);
}

export default async function Page({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const { resolution, entity } = await resolveThemePage(slug);

  if (resolution.entityId == null) notFound();

  if (resolution.needsRedirect) {
    permanentRedirect(`/theme/${resolution.cleanSlug}`);
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

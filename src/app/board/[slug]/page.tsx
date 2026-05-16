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

const ENTITY_TYPE = 'gpus' as const;

/* ─────────────────────────────────────────────────────────────────────
   /board/[slug]

   Step-2 proof route. Renders any entity_type='gpus' (i.e. board)
   canonical_entities row with EntityPage. Mirrors /chip/[slug]
   structurally — single React.cache()'d resolver, generateMetadata via
   the shared builder, JSON-LD Product + BreadcrumbList, page revalidate
   set to match scraper cadence.

   Adding /cpu/[slug] in Step 4 = copy this file, change ENTITY_TYPE,
   change one notFound message. No new module-scope code.

   Bible Protocol #16: src/proxy.ts and next.config.ts redirects()
   intercept BEFORE this route handler. Confirm /board/* isn't matched
   by either before testing — `git grep '/board' next.config.ts
   src/proxy.ts src/lib/bot-policy.ts`.
   ───────────────────────────────────────────────────────────────────── */

const resolveBoardPage = cache(
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
  const { entity } = await resolveBoardPage(slug);
  if (!entity) return { title: { absolute: 'Board not found · TrackAura' } };
  return buildEntityMetadata(entity);
}

export default async function Page({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const { resolution, entity } = await resolveBoardPage(slug);

  if (resolution.entityId == null) notFound();

  // gpus has cleanSlugBrandPrefixes=[] so needsRedirect is structurally
  // always false today. Check stays for symmetry with /chip and any
  // future leaf vertical that registers brand prefixes.
  if (resolution.needsRedirect) {
    permanentRedirect(`/board/${resolution.cleanSlug}`);
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

// Match /p/[slug] and /chip/[slug] cadence: scraper runs are slower
// than 5min so don't hit the DB on every pageview.
export const revalidate = 300;

/* ISR opt-in (Bible Protocol #37, 2026-05-15) -- see /chip/[slug]/page.tsx for full context. */
export async function generateStaticParams(): Promise<Array<Params>> {
  return [];
}

export const dynamicParams = true;
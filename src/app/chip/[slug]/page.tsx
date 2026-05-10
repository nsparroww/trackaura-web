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

const ENTITY_TYPE = 'gpu_chip' as const;

/* ────────────────────────────────────────────────────────────────────────
   /chip/[slug]

   Step-3b cutover (2026-05-04). Was previously rendered by
   src/components/chip/ChipPage with a chip-specific data fetcher and
   inline metadata logic. Now uses the shared EntityPage + entity
   resolver/metadata builders, mirroring /board/[slug].

   gpu_chip is the only entity_type today with brand-prefix slug
   normalization (e.g. /chip/nvidia-geforce-rtx-5090 → /chip/rtx-5090),
   driven by cleanSlugBrandPrefixes in entity-config.ts. The
   needsRedirect branch below handles that.

   Bible Protocol #16: src/proxy.ts and next.config.ts redirects()
   intercept BEFORE this route handler. Confirmed clean for /chip/* at
   Step 2 ship.
   ──────────────────────────────────────────────────────────────────── */

const resolveChipPage = cache(
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
  const { entity } = await resolveChipPage(slug);
  if (!entity) return { title: { absolute: 'Chip not found · TrackAura' } };
  return buildEntityMetadata(entity);
}

export default async function Page({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const { resolution, entity } = await resolveChipPage(slug);

  if (resolution.entityId == null) notFound();

  // Brand-prefix URL (e.g. /chip/nvidia-geforce-rtx-5090) → 308 to clean.
  if (resolution.needsRedirect) {
    permanentRedirect(`/chip/${resolution.cleanSlug}`);
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

/* ────────────────────────────────────────────────────────────────────────
   ISR configuration (Bible Protocol #37, 2026-05-09 next-session).

   Three co-requisite exports engage on-demand-cached ISR for a
   dynamic-segment route:

     1. revalidate = N           — TTL after which the cached HTML is
                                    refreshed in the background.
     2. generateStaticParams() returning []
                                  — opts into "no paths prerendered at
                                    build, generate-and-cache on first
                                    visit, serve from edge cache after".
     3. dynamicParams = true     — allow params not pre-listed by
                                    generateStaticParams() to render and
                                    be cached on demand (the actual mode
                                    we want; without it Next.js 404s any
                                    slug not in the empty array).

   Prerequisite: every Supabase callsite in the render graph (page body,
   generateMetadata, helpers transitively reached by either) must use
   createCatalogClient(), not createClient(). Any cookies() call upstream
   forces dynamic rendering regardless of the exports above.

   Verify via `npm run build` route table: this route should show ●
   (SSG), not ƒ (Dynamic). Production smoke via two-curl pass — first
   pass MISS, second pass HIT, Cache-Control flips from
   `private, no-cache, no-store` to `public`.
   ──────────────────────────────────────────────────────────────────── */

// Match /p/[slug] and /board/[slug] cadence: scraper runs are slower
// than 5min so don't hit the DB on every pageview.
export const revalidate = 300;

export async function generateStaticParams() {
  return [];
}

export const dynamicParams = true;

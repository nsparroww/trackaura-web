import type { MetadataRoute } from 'next';
import { createAnonSupabaseClient } from '@/lib/supabase/anon';
import {
  ENTITY_TYPES,
  isRegisteredEntityType,
  type EntityType,
} from '@/lib/entity-config';

type EntityRow = {
  slug: string;
  entity_type: string;
  updated_at: string | null;
};

// PostgREST default max-rows cap is 1000 (Architecture Bible §13 #18).
// Paginate explicitly to fetch the full canonical_entities table.
const PAGE_SIZE = 1_000;

/**
 * Strip brand prefix from slug to produce the clean URL form.
 *
 * Mirrors the runtime logic in src/lib/entity-slug.ts. Kept inline here
 * so the sitemap doesn't pull in the resolver (which depends on the
 * server Supabase client). If the two drift, the runtime resolver wins
 * — fix this file to match.
 *
 * Architecture Bible §3: "~80.5% of canonical_products slugs are
 * brand-brand-name-... Pattern inherited by canonical_entities boards.
 * Frontend middleware handles runtime mismatch." Emitting clean URLs
 * here avoids burning Googlebot crawl budget on 308s.
 */
function cleanSlugFor(slug: string, type: EntityType): string {
  const prefixes = ENTITY_TYPES[type].cleanSlugBrandPrefixes;
  for (const prefix of prefixes) {
    const withDash = `${prefix}-`;
    if (slug.startsWith(withDash)) {
      return slug.slice(withDash.length);
    }
  }
  return slug;
}

/**
 * /entities-sitemap/sitemap.xml
 *
 * Step-3d (2026-05-04). Emits canonical_entities URLs across all
 * registered entity_types — today /chip/[slug] (gpu_chip) and
 * /board/[slug] (gpus). Future CPUs, monitors, mobos, etc. light up
 * automatically as their entity_type is registered in entity-config.ts.
 *
 * Single-file output: 3,008 entities today, projected <20K through
 * Phase 0. Google's hard cap is 50,000 URLs per file. If/when total
 * approaches 40K, split into chunks via generateSitemaps() the same
 * way products-sitemap does.
 *
 * Uses the anon client (no cookies) to match the products-sitemap
 * pattern — sitemap routes run in a context where cookies() may not
 * be available.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = createAnonSupabaseClient();
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trackaura.com';

  const allRows: EntityRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('canonical_entities')
      .select('slug, entity_type, updated_at')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error('[entities-sitemap] page query failed', { offset, error });
      break;
    }
    if (!data || data.length === 0) break;

    allRows.push(...data);

    // Short read = end of result set.
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows
    .filter((row) => isRegisteredEntityType(row.entity_type))
    .map((row) => {
      const type = row.entity_type as EntityType;
      const cfg = ENTITY_TYPES[type];
      const cleanSlug = cleanSlugFor(row.slug, type);
      return {
        url: `${base}${cfg.routePrefix}/${cleanSlug}`,
        lastModified: row.updated_at ? new Date(row.updated_at) : new Date(),
        changeFrequency: 'daily' as const,
        priority: 0.8,
      };
    });
}

/* Route segment config.

   This sitemap queries canonical_entities via the Supabase client,
   whose fetches are no-store. That makes the route inherently dynamic
   — Next.js cannot statically prerender it. Declaring force-dynamic
   explicitly tells the build to skip the doomed static-generation
   attempt; without it, every `npm run build` logged a Dynamic-server-
   usage error for this route before falling back to dynamic anyway.
   Runtime behaviour is unchanged — the route was already `ƒ` Dynamic
   and served fine; this only quiets the build log (2026-05-15).

   `revalidate` is intentionally omitted: it has no effect on a
   force-dynamic route (the page renders fresh per request). The
   previous `revalidate = 86_400` was dead code — a route forced
   dynamic by a no-store fetch can't ISR-cache regardless. If sitemap
   DB load ever needs throttling, the fix is a cacheable fetch layer,
   not a revalidate value — that's a separate change if it becomes
   real. */
export const dynamic = 'force-dynamic';

import type { MetadataRoute } from 'next';
import { createAnonSupabaseClient } from '@/lib/supabase/anon';

const URLS_PER_CHUNK = 40_000;

// PostgREST's default `max-rows` is 1000. A single supabase-js
// `.range(0, 39999)` request is silently capped at 1000 rows. We
// paginate explicitly within each chunk to fetch everything.
const SUPABASE_PAGE_SIZE = 1_000;

type ProductRow = {
  slug: string;
  updated_at: string | null;
};

/**
 * Generates one sitemap file per chunk of ~40k products.
 * Accessed at /products-sitemap/sitemap/0.xml, /products-sitemap/sitemap/1.xml, etc.
 *
 * Uses the anon client (no cookies) because sitemaps run in a context
 * where cookies() may not be available.
 */
export async function generateSitemaps() {
  const supabase = createAnonSupabaseClient();
  const { count, error } = await supabase
    .from('canonical_products')
    .select('id', { count: 'exact', head: true })
    .not('image_url', 'is', null);
  if (error) {
    console.error('[sitemap] generateSitemaps count query failed:', error);
  }
  const productCount = count ?? 0;
  const chunkCount = Math.max(1, Math.ceil(productCount / URLS_PER_CHUNK));
  return Array.from({ length: chunkCount }, (_, i) => ({ id: i }));
}

/**
 * Renders one chunk's URLs.
 *
 * IMPORTANT (Next.js 15+): the `id` argument is a Promise, not a plain number.
 * It must be awaited before use — passing it to arithmetic operators silently
 * coerces to NaN and produces an empty sitemap. This was the bug 2026-05-02.
 */
export default async function sitemap({
  id,
}: {
  id: number;
}): Promise<MetadataRoute.Sitemap> {
  // Next.js 15+ makes dynamic-route params async. Await defensively even when
  // the type signature claims `id: number` — at runtime it can be a Promise.
  const resolvedId = (await Promise.resolve(id)) as number;
  const supabase = createAnonSupabaseClient();
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trackaura.com';
  const chunkStart = resolvedId * URLS_PER_CHUNK;
  const chunkEnd = chunkStart + URLS_PER_CHUNK - 1;
  // Paginate within the chunk to bypass PostgREST's max-rows cap.
  const allRows: ProductRow[] = [];
  let pageStart = chunkStart;
  while (pageStart <= chunkEnd) {
    const pageEnd = Math.min(pageStart + SUPABASE_PAGE_SIZE - 1, chunkEnd);
    const { data: rows, error } = await supabase
      .from('canonical_products')
      .select('slug, updated_at')
      .not('image_url', 'is', null)
      .order('id', { ascending: true })
      .range(pageStart, pageEnd);
    if (error) {
      console.error('[sitemap] page query failed', {
        chunkId: resolvedId,
        pageStart,
        pageEnd,
        error,
      });
      break;
    }
    if (!rows || rows.length === 0) {
      break;
    }
    allRows.push(...rows);
    // Short read = end of result set
    if (rows.length < pageEnd - pageStart + 1) {
      break;
    }
    pageStart += SUPABASE_PAGE_SIZE;
  }
  return allRows.map((r) => ({
    url: `${base}/p/${r.slug}`,
    lastModified: r.updated_at ? new Date(r.updated_at) : new Date(),
    changeFrequency: 'daily' as const,
    priority: 0.7,
  }));
}

/* Route segment config.

   Both generateSitemaps() and the per-chunk renderer query
   canonical_products via the Supabase client, whose fetches are
   no-store. That makes the route inherently dynamic — Next.js cannot
   statically prerender it. Declaring force-dynamic explicitly tells
   the build to skip the doomed static-generation attempt; without it,
   every `npm run build` logged Dynamic-server-usage errors for this
   route (both the count query and the per-chunk page query) before
   falling back to dynamic anyway. Runtime behaviour is unchanged —
   the route was already `ƒ` Dynamic and served fine; this only quiets
   the build log (2026-05-15).

   `revalidate` is intentionally omitted: it has no effect on a
   force-dynamic route. The previous `revalidate = 86_400` was dead
   code — a route forced dynamic by a no-store fetch can't ISR-cache
   regardless. If sitemap DB load ever needs throttling, the fix is a
   cacheable fetch layer, not a revalidate value. */
export const dynamic = 'force-dynamic';

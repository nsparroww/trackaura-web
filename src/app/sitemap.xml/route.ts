import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/* ────────────────────────────────────────────────────────────────────────
   /sitemap.xml — true sitemap index

   The previous implementation lived in src/app/sitemap.ts and exported a
   MetadataRoute.Sitemap. That always renders as <urlset>, never as
   <sitemapindex>. The three child-sitemap URLs were therefore being
   treated by Google as PAGES to index, not as sitemaps to fetch, so the
   entities-sitemap was never discovered. Months of /chip /board /cpu
   /monitor /set /theme URLs invisible to Search (GSC top 1000 contained
   zero entity-native routes as of 2026-05-24).

   Fix (2026-05-25): convert to a route.ts handler that emits proper
   <sitemapindex> XML. Same URL (/sitemap.xml), referenced from
   robots.txt unchanged.

   Next.js has no native sitemap-index support — see vercel/next.js
   discussion #61448. The official guidance for this case is exactly
   what's done here: a route.ts that writes the index XML by hand.
   ──────────────────────────────────────────────────────────────────── */

// Google's hard cap is 50,000 URLs per sitemap.
// 40k keeps headroom for growth without a redeploy.
const URLS_PER_CHILD = 40_000;

// One day at the browser and the Vercel edge. The chunk count changes
// rarely (only when canonical_products grows past the next 40k boundary),
// so daily refresh is plenty.
const CACHE_ONE_DAY = 'public, max-age=86400, s-maxage=86400';

export async function GET() {
  const supabase = await createClient();
  const { count } = await supabase
    .from('canonical_products')
    .select('id', { count: 'exact', head: true })
    .not('image_url', 'is', null);

  const productCount = count ?? 0;
  const chunkCount = Math.max(1, Math.ceil(productCount / URLS_PER_CHILD));

  // Default to www (canonical host per ARCHITECTURE §7). Apex 307s to www
  // anyway, but a sitemap index pointing at apex makes Google work harder
  // than it needs to.
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.trackaura.com';
  const now = new Date().toISOString();

  const entries: string[] = [
    `  <sitemap>\n    <loc>${base}/static-sitemap/sitemap.xml</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>`,
    `  <sitemap>\n    <loc>${base}/entities-sitemap/sitemap.xml</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>`,
    ...Array.from(
      { length: chunkCount },
      (_, i) =>
        `  <sitemap>\n    <loc>${base}/products-sitemap/sitemap/${i}.xml</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>`,
    ),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</sitemapindex>`;

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': CACHE_ONE_DAY,
    },
  });
}

// Route segment config: the underlying canonical_products count query
// uses a no-store Supabase fetch, which makes the route inherently
// dynamic. Declaring force-dynamic explicitly silences the build-time
// dynamic-server-usage error (same pattern as entities-sitemap and
// products-sitemap, 2026-05-15).
export const dynamic = 'force-dynamic';

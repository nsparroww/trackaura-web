import type { MetadataRoute } from 'next';
import { createClient } from '@/lib/supabase/server';

// Google's hard cap is 50,000 URLs per sitemap.
// Using 40k keeps headroom for growth without a redeploy.
const URLS_PER_CHILD = 40_000;

/**
 * Sitemap index at /sitemap.xml.
 *
 * Points to the three child sitemaps. URLs MUST match Next.js's actual
 * sitemap routing convention, not the natural-looking shorter form:
 *
 *   src/app/static-sitemap/sitemap.ts        → /static-sitemap/sitemap.xml
 *   src/app/entities-sitemap/sitemap.ts      → /entities-sitemap/sitemap.xml
 *   src/app/products-sitemap/sitemap.ts      → /products-sitemap/sitemap/<id>.xml
 *                                              (the /sitemap/ segment is added
 *                                               by Next when generateSitemaps()
 *                                               is used for chunking)
 *
 * Earlier versions of this file emitted /static-sitemap.xml and
 * /products-sitemap/<id>.xml. Both 404'd silently. Google fetched the
 * index, followed the URLs, hit dead routes, and never crawled product
 * pages via the sitemap path. Fixed 2026-05-02.
 *
 * Step-3d (2026-05-04): added entities-sitemap for canonical_entities
 * (chips and boards today, future CPUs/monitors/etc auto-included as
 * their entity_type registers in entity-config.ts). The legacy
 * products-sitemap (canonical_products → /p/[slug]) stays in parallel
 * during the v0 → canonical_entities migration.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createClient();

  const { count } = await supabase
    .from('canonical_products')
    .select('id', { count: 'exact', head: true })
    .not('image_url', 'is', null);

  const productCount = count ?? 0;
  const chunkCount = Math.max(1, Math.ceil(productCount / URLS_PER_CHILD));
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trackaura.com';

  return [
    {
      url: `${base}/static-sitemap/sitemap.xml`,
      lastModified: new Date(),
    },
    {
      url: `${base}/entities-sitemap/sitemap.xml`,
      lastModified: new Date(),
    },
    ...Array.from({ length: chunkCount }, (_, i) => ({
      url: `${base}/products-sitemap/sitemap/${i}.xml`,
      lastModified: new Date(),
    })),
  ];
}

// Refresh the index once a day — child sitemaps have their own revalidation.
export const revalidate = 86_400;

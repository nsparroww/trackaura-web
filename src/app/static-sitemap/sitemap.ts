import type { MetadataRoute } from 'next';

/**
 * Static, evergreen URLs (homepage, browse pages, marketing).
 * Served at /static-sitemap.xml via the sitemap.ts convention using a route segment.
 */

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trackaura.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${BASE}/`,         lastModified: now, changeFrequency: 'daily',   priority: 1.0 },
    { url: `${BASE}/products`, lastModified: now, changeFrequency: 'daily',   priority: 0.9 },
    { url: `${BASE}/brands`,   lastModified: now, changeFrequency: 'weekly',  priority: 0.7 },
    { url: `${BASE}/blog`,     lastModified: now, changeFrequency: 'weekly',  priority: 0.6 },
    { url: `${BASE}/about`,    lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
  ];
}

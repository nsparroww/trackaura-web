import type { MetadataRoute } from 'next';
import fs from 'fs';
import path from 'path';

/**
 * Static, evergreen URLs (homepage, browse pages, marketing) plus the
 * full blog-post index read from public/data/blog-posts.json.
 *
 * Served at /static-sitemap.xml via the sitemap.ts convention using a
 * route segment. Per-post entries use each post's own date as
 * lastModified so Google can prioritise re-crawl of newer essays.
 */

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trackaura.com';

interface BlogPostMeta {
  slug: string;
  date: string;
}

function getBlogPosts(): BlogPostMeta[] {
  try {
    const filePath = path.join(process.cwd(), 'public', 'data', 'blog-posts.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const posts = getBlogPosts();

  return [
    { url: `${BASE}/`,         lastModified: now, changeFrequency: 'daily',   priority: 1.0 },
    { url: `${BASE}/products`, lastModified: now, changeFrequency: 'daily',   priority: 0.9 },
    { url: `${BASE}/brands`,   lastModified: now, changeFrequency: 'weekly',  priority: 0.7 },
    { url: `${BASE}/blog`,     lastModified: now, changeFrequency: 'weekly',  priority: 0.6 },
    { url: `${BASE}/trends`,   lastModified: now, changeFrequency: 'daily',   priority: 0.7 },
    { url: `${BASE}/for-llms`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/about`,    lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    ...posts.map((post) => ({
      url: `${BASE}/blog/${post.slug}`,
      lastModified: new Date(post.date),
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    })),
  ];
}

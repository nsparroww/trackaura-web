import { NextResponse } from "next/server";
import { getAllProducts } from "@/lib/data";
import { CATEGORY_LABELS } from "@/types";

// Cache each child sitemap for 24 hours.
// Product data only updates every 4 hours anyway, and Google doesn't need
// hour-level freshness on sitemaps â€” daily is standard practice.
export const revalidate = 86400;

const BASE_URL = "https://www.trackaura.com";
const PRODUCTS_PER_SITEMAP = 1000;
const STATIC_PAGE_DATE = "2026-04-01";

type SitemapEntry = {
  url: string;
  lastmod: string;
  changefreq?: string;
  priority?: number;
};

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return new Date().toISOString().split("T")[0];
    return d.toISOString().split("T")[0];
  } catch {
    return new Date().toISOString().split("T")[0];
  }
}

function extractBrand(name: string): string {
  return name.split(/\s+/)[0]?.toUpperCase() || "";
}

function brandSlug(brand: string): string {
  return brand
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function entriesToXml(entries: SitemapEntry[]): string {
  const urlTags = entries
    .map((e) => {
      const parts = [`    <loc>${e.url}</loc>`, `    <lastmod>${e.lastmod}</lastmod>`];
      if (e.changefreq) parts.push(`    <changefreq>${e.changefreq}</changefreq>`);
      if (e.priority !== undefined) parts.push(`    <priority>${e.priority.toFixed(1)}</priority>`);
      return `  <url>\n${parts.join("\n")}\n  </url>`;
    })
    .join("\n");

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urlTags +
    "\n</urlset>\n"
  );
}

async function buildStaticSitemap(): Promise<SitemapEntry[]> {
  const today = new Date().toISOString().split("T")[0];
  const products = await getAllProducts();

  const staticPages: SitemapEntry[] = [
    { url: BASE_URL, lastmod: today, changefreq: "daily", priority: 1.0 },
    { url: `${BASE_URL}/products`, lastmod: today, changefreq: "daily", priority: 0.9 },
    { url: `${BASE_URL}/compare`, lastmod: STATIC_PAGE_DATE, changefreq: "weekly", priority: 0.8 },
    { url: `${BASE_URL}/categories`, lastmod: STATIC_PAGE_DATE, changefreq: "monthly", priority: 0.7 },
    { url: `${BASE_URL}/about`, lastmod: STATIC_PAGE_DATE, changefreq: "yearly", priority: 0.5 },
    { url: `${BASE_URL}/how-it-works`, lastmod: STATIC_PAGE_DATE, changefreq: "yearly", priority: 0.5 },
    { url: `${BASE_URL}/privacy`, lastmod: STATIC_PAGE_DATE, changefreq: "yearly", priority: 0.3 },
    { url: `${BASE_URL}/terms`, lastmod: STATIC_PAGE_DATE, changefreq: "yearly", priority: 0.3 },
    { url: `${BASE_URL}/trends`, lastmod: today, changefreq: "daily", priority: 0.8 },
    { url: `${BASE_URL}/brands`, lastmod: STATIC_PAGE_DATE, changefreq: "weekly", priority: 0.6 },
    { url: `${BASE_URL}/blog`, lastmod: STATIC_PAGE_DATE, changefreq: "weekly", priority: 0.6 },
  ];

  const categoryPages: SitemapEntry[] = Object.keys(CATEGORY_LABELS)
    .filter((k) => k !== "other")
    .map((cat) => ({
      url: `${BASE_URL}/category/${cat}`,
      lastmod: today,
      changefreq: "daily",
      priority: 0.8,
    }));

  const bestPages: SitemapEntry[] = Object.keys(CATEGORY_LABELS)
    .filter((k) => k !== "other")
    .map((cat) => ({
      url: `${BASE_URL}/best/${cat}`,
      lastmod: today,
      changefreq: "weekly",
      priority: 0.75,
    }));

  const brandCounts: Record<string, number> = {};
  for (const p of products) {
    const brand = extractBrand(p.name);
    if (brand.length >= 2) brandCounts[brand] = (brandCounts[brand] || 0) + 1;
  }
  const brandPages: SitemapEntry[] = Object.entries(brandCounts)
    .filter(([_, count]) => count >= 3)
    .map(([brand]) => ({
      url: `${BASE_URL}/brand/${brandSlug(brand)}`,
      lastmod: today,
      changefreq: "weekly",
      priority: 0.65,
    }));

  const blogSlugs = [
    "when-to-buy-gpu-canada",
    "canada-computers-vs-newegg-prices",
    "how-to-save-money-pc-build-canada",
    "rtx-5070-canada-price-tracking",
    "is-now-good-time-buy-electronics-canada",
    "best-budget-gaming-monitor-canada-2026",
    "ddr5-vs-ddr4-ram-prices-canada",
    "how-to-use-price-alerts-trackaura",
    "gaming-pc-build-cost-canada-2026",
    "best-ssd-deals-canada-2026",
    "are-electronics-prices-going-up-canada-2026",
    "cross-retailer-price-matching-canada",
  ];
  const blogPages: SitemapEntry[] = blogSlugs.map((slug) => ({
    url: `${BASE_URL}/blog/${slug}`,
    lastmod: STATIC_PAGE_DATE,
    changefreq: "monthly",
    priority: 0.6,
  }));

  return [...staticPages, ...categoryPages, ...bestPages, ...brandPages, ...blogPages];
}

async function buildProductSitemap(chunkIndex: number): Promise<SitemapEntry[]> {
  const products = await getAllProducts();
  const start = chunkIndex * PRODUCTS_PER_SITEMAP;
  const end = start + PRODUCTS_PER_SITEMAP;
  const chunk = products.slice(start, end);

  return chunk.map((product) => ({
    url: `${BASE_URL}/product/${product.slug}`,
    lastmod: formatDate(product.lastUpdated),
    changefreq: "weekly",
    priority: 0.6,
  }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ type: string }> }
) {
  const { type } = await params;

  // Strip .xml extension if present
  const typeName = type.replace(/\.xml$/, "");

  let entries: SitemapEntry[];

  if (typeName === "static") {
    entries = await buildStaticSitemap();
  } else if (typeName.startsWith("products-")) {
    const indexStr = typeName.replace("products-", "");
    const index = parseInt(indexStr, 10);
    if (isNaN(index) || index < 0) {
      return new NextResponse("Not found", { status: 404 });
    }
    entries = await buildProductSitemap(index);
    if (entries.length === 0) {
      return new NextResponse("Not found", { status: 404 });
    }
  } else {
    return new NextResponse("Not found", { status: 404 });
  }

  const xml = entriesToXml(entries);

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=172800",
    },
  });
}

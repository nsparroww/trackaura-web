import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAllProducts } from "@/lib/data";
import { formatPrice, getAmazonSearchUrl } from "@/lib/utils";
import { CATEGORY_LABELS, Product } from "@/types";

// CRITICAL: was force-dynamic, which re-scanned the entire 37K-row products
// table on EVERY visit to a brand page. Now caches for 4 hours per region
// (matches scrape cycle). Cuts reads from this page by ~95%+.
export const revalidate = 14400;

function extractBrand(name: string): string {
  const words = name.split(/\s+/);
  return words[0] || "";
}

// Reject obvious junk "brands" — numeric tokens, capacities, sizes, refurb prefixes, etc.
function isLikelyRealBrand(token: string): boolean {
  if (token.length < 3) return false;
  // purely numeric, or starts with a digit (e.g. "850w", "64gb", "16gb", "2000w", "4pcs")
  if (/^\d/.test(token)) return false;
  // generic descriptors that appear as first-word
  const junk = new Set([
    "REFURBISHED", "NEW", "HOT", "ALL", "ONE", "HUB", "CABLE", "BLACK", "BLUE",
    "SILVER", "WHITE", "MICRO", "MINI", "COMPACT", "FULL", "SMALL", "LARGE",
    "LAPTOP", "DESKTOP", "GAMING", "PURE", "COMPATIBLE", "ERGONOMIC",
    "MECHANICAL", "STEREO", "WIRELESS", "WIRED", "RETRO", "HANDHELD",
    "UNLOCKED", "CLOTH", "SSD", "DDR5", "DDR4", "AC",
  ]);
  if (junk.has(token)) return false;
  return true;
}

type BrandMap = Record<string, Product[]>;

// REMOVED: _brandDataCache module-level cache. With React.cache wrapping
// getAllProducts in data.ts, per-request dedupe is automatic. The module
// cache could serve stale data after revalidation in warm Lambdas.
async function getBrandData(): Promise<BrandMap> {
  const products = await getAllProducts();
  const brands: BrandMap = {};

  for (const p of products) {
    const brand = extractBrand(p.name).toUpperCase();
    if (!isLikelyRealBrand(brand)) continue;
    if (!brands[brand]) brands[brand] = [];
    brands[brand].push(p);
  }

  // Only include brands with 10+ products (raised from 3 to cut junk further)
  const filtered: BrandMap = {};
  for (const [brand, items] of Object.entries(brands)) {
    if (items.length >= 10) filtered[brand] = items;
  }
  return filtered;
}

function brandSlug(brand: string): string {
  return brand.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

type PageProps = { params: Promise<{ brand: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { brand: slug } = await params;
  const brands = await getBrandData();
  const brandName = Object.keys(brands).find((b) => brandSlug(b) === slug);
  if (!brandName) return { title: "Brand Not Found" };

  const count = brands[brandName].length;
  return {
    title: brandName + " Prices in Canada - " + count + " Products Tracked",
    description: "Track " + brandName + " prices across Canadian retailers. Compare " + count + " products at Canada Computers and Newegg Canada. Price history, deals, and alerts.",
    alternates: { canonical: "https://www.trackaura.com/brand/" + slug },
  };
}

export default async function BrandPage({ params }: PageProps) {
  const { brand: slug } = await params;
  // React.cache dedupes this with the call in generateMetadata above.
  const brands = await getBrandData();
  const brandName = Object.keys(brands).find((b) => brandSlug(b) === slug);
  if (!brandName) notFound();

  const products = brands[brandName];
  const cheapest = [...products].sort((a, b) => a.currentPrice - b.currentPrice).slice(0, 10);
  const mostExpensive = [...products].sort((a, b) => b.currentPrice - a.currentPrice).slice(0, 5);
  const atLowest = products.filter((p) => p.currentPrice <= p.minPrice && p.priceCount > 1).slice(0, 5);

  const categoryCounts: Record<string, number> = {};
  const retailerCounts: Record<string, number> = {};
  for (const p of products) {
    categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
    retailerCounts[p.retailer] = (retailerCounts[p.retailer] || 0) + 1;
  }

  const avgPrice = products.reduce((sum, p) => sum + p.currentPrice, 0) / products.length;
  const minPrice = Math.min(...products.map((p) => p.currentPrice));
  const maxPrice = Math.max(...products.map((p) => p.currentPrice));

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem 1.5rem" }}>
      <nav style={{ display: "flex", gap: "0.5rem", fontSize: "0.8125rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <Link href="/" className="accent-link">Home</Link>
        <span style={{ color: "var(--text-secondary)" }}>/</span>
        <Link href="/products" className="accent-link">Products</Link>
        <span style={{ color: "var(--text-secondary)" }}>/</span>
        <span style={{ color: "var(--text-secondary)" }}>{brandName}</span>
      </nav>

      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontFamily: "'Sora', sans-serif", fontWeight: 800, fontSize: "1.75rem", marginBottom: "0.75rem" }}>
          {brandName + " Prices in Canada"}
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9375rem", lineHeight: 1.7 }}>
          {"Tracking " + products.length + " " + brandName + " products across " + Object.keys(retailerCounts).join(" and ") + ". Prices range from " + formatPrice(minPrice) + " to " + formatPrice(maxPrice) + " CAD, updated every 4 hours."}
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1px", background: "var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: "2rem" }}>
        {[
          { label: "Products", value: products.length.toString() },
          { label: "Avg Price", value: formatPrice(avgPrice) },
          { label: "Lowest", value: formatPrice(minPrice) },
          { label: "Highest", value: formatPrice(maxPrice) },
        ].map((s) => (
          <div key={s.label} style={{ background: "var(--bg-card)", padding: "1rem", textAlign: "center" }}>
            <p className="gradient-text" style={{ fontFamily: "'Sora', sans-serif", fontWeight: 800, fontSize: "1.25rem" }}>{s.value}</p>
            <p style={{ fontSize: "0.6875rem", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600, marginTop: "0.25rem" }}>{s.label}</p>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap", marginBottom: "2rem" }}>
        {Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
          <Link key={cat} href={"/category/" + cat} className="filter-pill" style={{ textDecoration: "none" }}>
            {(CATEGORY_LABELS[cat] || cat) + " (" + count + ")"}
          </Link>
        ))}
      </div>

      {atLowest.length > 0 && (
        <Section title={brandName + " Products at Lowest Price"}>
          {atLowest.map((p) => (<ProductRow key={p.id} product={p} badge={"\u25CF Lowest"} badgeColor="var(--accent)" />))}
        </Section>
      )}

      <Section title={"Most Affordable " + brandName + " Products"}>
        {cheapest.map((p) => (<ProductRow key={p.id} product={p} />))}
      </Section>

      {mostExpensive.length > 0 && (
        <Section title={"Premium " + brandName + " Products"}>
          {mostExpensive.map((p) => (<ProductRow key={p.id} product={p} />))}
        </Section>
      )}

      <div style={{ marginTop: "2rem", textAlign: "center" }}>
        <Link href={"/products"} className="btn-primary" style={{ textDecoration: "none", display: "inline-block" }}>
          Browse All Products
        </Link>
      </div>

      <div style={{ marginTop: "1.5rem", padding: "1rem", fontSize: "0.75rem", color: "var(--text-secondary)", textAlign: "center", lineHeight: 1.6 }}>
        {"Prices are in Canadian dollars (CAD). " + brandName + " is a trademark of its respective owner. TrackAura is not affiliated with " + brandName + "."}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "2rem" }}>
      <h2 style={{ fontFamily: "'Sora', sans-serif", fontWeight: 700, fontSize: "1.125rem", marginBottom: "0.75rem" }}>{title}</h2>
      <div className="card" style={{ padding: "0.5rem" }}>{children}</div>
    </div>
  );
}

function ProductRow({ product, badge, badgeColor }: { product: Product; badge?: string; badgeColor?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)", gap: "0.75rem", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <Link href={"/product/" + product.slug} style={{ fontSize: "0.875rem", color: "var(--text-primary)", textDecoration: "none", fontWeight: 500 }}>
          {product.name}
        </Link>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: 3 }}>
          <span className={product.retailer === "Canada Computers" ? "badge-cc" : "badge-newegg"} style={{ padding: "0.125rem 0.375rem", borderRadius: 999, fontSize: "0.625rem", fontWeight: 600 }}>
            {product.retailer}
          </span>
          <span style={{ fontSize: "0.6875rem", color: "var(--text-secondary)" }}>
            {CATEGORY_LABELS[product.category] || product.category}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        {badge && (
          <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: badgeColor || "var(--accent)" }}>{badge}</span>
        )}
        <span className="price-tag" style={{ fontSize: "1rem" }}>{formatPrice(product.currentPrice)}</span>
        <a href={getAmazonSearchUrl(product.name)} target="_blank" rel="noopener noreferrer nofollow" className="btn-amazon" style={{ textDecoration: "none", fontSize: "0.75rem", padding: "0.375rem 0.625rem" }}>Amazon</a>
      </div>
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ISR co-requisites (Bible Protocol #37, 2026-05-09 next-session). The
// `export const revalidate` above is silently ignored on dynamic-segment
// routes without these two: generateStaticParams() returning [] = no
// paths prerendered at build, dynamicParams=true = generate-and-cache
// on first visit, serve from edge cache thereafter. This route uses
// pg.Pool (no Supabase cookies in the render graph), so the export
// pair is the only fix needed.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function generateStaticParams() {
  return [];
}

export const dynamicParams = true;
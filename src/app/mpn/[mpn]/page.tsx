import { Metadata } from "next";
import Link from "next/link";
import { getAllProducts } from "@/lib/data";
import { CATEGORY_LABELS } from "@/types";
import { formatPrice, getAmazonSearchUrl, getRetailerAffiliateUrl } from "@/lib/utils";

export const revalidate = 14400;

type PageProps = { params: Promise<{ mpn: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { mpn } = await params;
  const decoded = decodeURIComponent(mpn).toUpperCase();
  const allProducts = await getAllProducts();
  const matches = allProducts.filter((p) => p.mpn && p.mpn.toUpperCase() === decoded);
  const product = matches[0];

  const title = product
    ? `${decoded} — ${product.brand || ""} ${product.shortName || product.name} Price in Canada`.trim()
    : `${decoded} — Price in Canada | TrackAura`;
  const description = product
    ? `Track the price of ${product.name} (MPN: ${decoded}) across Canadian retailers. Current price: $${product.currentPrice.toFixed(2)} CAD.`
    : `Find prices for MPN ${decoded} across Canadian electronics retailers.`;

  return {
    title,
    description,
    alternates: { canonical: `https://www.trackaura.com/mpn/${encodeURIComponent(decoded)}` },
  };
}

export default async function MpnPage({ params }: PageProps) {
  const { mpn } = await params;
  const decoded = decodeURIComponent(mpn).toUpperCase();
  const allProducts = await getAllProducts();

  // Find all products with this MPN
  const matches = allProducts.filter((p) => p.mpn && p.mpn.toUpperCase() === decoded);

  // Also find products where MPN appears in the name (broader match)
  const nameMatches = decoded.length >= 6
    ? allProducts.filter((p) =>
        !matches.includes(p) &&
        p.name.toUpperCase().includes(decoded)
      ).slice(0, 5)
    : [];

  const allMatches = [...matches, ...nameMatches];
  const primary = matches[0];

  if (allMatches.length === 0) {
    return (
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "2rem 1.5rem", textAlign: "center" }}>
        <nav style={{ display: "flex", gap: "0.5rem", fontSize: "0.8125rem", marginBottom: "1.5rem", justifyContent: "center" }}>
          <Link href="/" className="accent-link">Home</Link>
          <span style={{ color: "var(--text-secondary)" }}>/</span>
          <span style={{ color: "var(--text-secondary)" }}>MPN Lookup</span>
        </nav>
        <h1 style={{ fontFamily: "'Sora', sans-serif", fontWeight: 800, fontSize: "1.5rem", marginBottom: "1rem" }}>
          {"MPN: " + decoded}
        </h1>
        <p style={{ color: "var(--text-secondary)", marginBottom: "2rem" }}>
          {"No products found for this manufacturer part number. It may not be tracked yet."}
        </p>
        <Link href="/products" className="btn-primary" style={{ textDecoration: "none" }}>
          Browse All Products
        </Link>
      </div>
    );
  }

  // Structured data
  const structuredData = primary ? {
    "@context": "https://schema.org",
    "@type": "Product",
    name: primary.name,
    mpn: decoded,
    ...(primary.upc ? { gtin12: primary.upc } : {}),
    ...(primary.brand ? { brand: { "@type": "Brand", name: primary.brand } } : {}),
    offers: matches.map((p) => ({
      "@type": "Offer",
      price: p.currentPrice,
      priceCurrency: "CAD",
      availability: "https://schema.org/InStock",
      url: p.url,
      seller: { "@type": "Organization", name: p.retailer },
    })),
  } : null;

  // Price range across all retailers
  const prices = matches.map((p) => p.currentPrice);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const cheapest = matches.find((p) => p.currentPrice === minPrice)!;

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "2rem 1.5rem" }}>
      {structuredData && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      )}

      <nav style={{ display: "flex", gap: "0.5rem", fontSize: "0.8125rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <Link href="/" className="accent-link">Home</Link>
        <span style={{ color: "var(--text-secondary)" }}>/</span>
        <Link href="/products" className="accent-link">Products</Link>
        {primary && (
          <>
            <span style={{ color: "var(--text-secondary)" }}>/</span>
            <Link href={"/category/" + primary.category} className="accent-link">
              {CATEGORY_LABELS[primary.category] || primary.category}
            </Link>
          </>
        )}
        <span style={{ color: "var(--text-secondary)" }}>/</span>
        <span style={{ color: "var(--text-secondary)" }}>{decoded}</span>
      </nav>

      {/* Header */}
      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "2rem" }}>
        {primary?.imageUrl && (
          <div style={{
            width: 120, height: 120, background: "#fff", borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0,
          }}>
            <img src={primary.imageUrl} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          </div>
        )}
        <div>
          <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
            {"Manufacturer Part Number"}
          </p>
          <h1 style={{ fontFamily: "'Sora', sans-serif", fontWeight: 800, fontSize: "1.5rem", marginBottom: "0.5rem" }}>
            {decoded}
          </h1>
          {primary && (
            <p style={{ fontSize: "0.9375rem", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: "0.5rem" }}>
              {primary.name}
            </p>
          )}
          {primary?.brand && (
            <Link href={"/brand/" + primary.brand.toLowerCase()} className="accent-link" style={{ fontSize: "0.8125rem" }}>
              {"View all " + primary.brand + " products →"}
            </Link>
          )}
        </div>
      </div>

      {/* Price comparison across retailers */}
      {matches.length > 0 && (
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ fontFamily: "'Sora', sans-serif", fontWeight: 600, fontSize: "1rem", marginBottom: "1rem" }}>
            {"Price Across Retailers"}
            {matches.length > 1 && (
              <span style={{ fontSize: "0.8125rem", color: "var(--accent)", fontWeight: 400, marginLeft: "0.5rem" }}>
                {"Save up to $" + (maxPrice - minPrice).toFixed(2)}
              </span>
            )}
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {matches
              .sort((a, b) => a.currentPrice - b.currentPrice)
              .map((p) => {
                const isCheapest = p.currentPrice === minPrice && matches.length > 1;
                const retailerUrl = getRetailerAffiliateUrl(p);
                return (
                  <div key={p.id} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "0.75rem 1rem", borderRadius: 8,
                    border: isCheapest ? "1px solid var(--accent)" : "1px solid var(--border)",
                    background: isCheapest ? "var(--accent-glow)" : "transparent",
                  }}>
                    <div>
                      <span className={p.retailer === "Canada Computers" ? "badge-cc" : "badge-newegg"} style={{
                        padding: "0.125rem 0.375rem", borderRadius: 999, fontSize: "0.6875rem", fontWeight: 600,
                      }}>
                        {p.retailer}
                      </span>
                      {isCheapest && (
                        <span style={{ fontSize: "0.6875rem", color: "var(--accent)", fontWeight: 600, marginLeft: "0.5rem" }}>
                          {"✓ BEST PRICE"}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <span className="price-tag" style={{ fontSize: "1.125rem" }}>
                        {formatPrice(p.currentPrice)}
                      </span>
                      <a href={retailerUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary" style={{
                        textDecoration: "none", fontSize: "0.75rem", padding: "0.375rem 0.75rem",
                      }}>
                        Buy
                      </a>
                      <Link href={"/product/" + p.slug} className="accent-link" style={{ fontSize: "0.75rem" }}>
                        History
                      </Link>
                    </div>
                  </div>
                );
              })}
          </div>

          {/* Amazon comparison */}
          {primary && (
            <div style={{ marginTop: "0.75rem", textAlign: "center" }}>
              <a
                href={getAmazonSearchUrl(primary.name)}
                target="_blank"
                rel="noopener noreferrer nofollow sponsored"
                className="btn-amazon"
                style={{ textDecoration: "none", fontSize: "0.8125rem" }}
              >
                Compare on Amazon.ca
              </a>
            </div>
          )}
        </div>
      )}

      {/* Product details links */}
      {matches.length > 0 && (
        <div className="card" style={{ padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ fontFamily: "'Sora', sans-serif", fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.75rem" }}>
            {"Price History & Details"}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {matches.map((p) => (
              <Link key={p.id} href={"/product/" + p.slug} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "0.5rem 0", textDecoration: "none", borderBottom: "1px solid var(--border)",
              }}>
                <span style={{ fontSize: "0.8125rem", color: "var(--text-primary)" }}>
                  {p.shortName || p.name}
                </span>
                <span style={{ fontSize: "0.75rem", color: "var(--accent)" }}>
                  {"View history →"}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Name matches (related products) */}
      {nameMatches.length > 0 && (
        <div className="card" style={{ padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ fontFamily: "'Sora', sans-serif", fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.75rem" }}>
            {"Related Products"}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {nameMatches.map((p) => (
              <Link key={p.id} href={"/product/" + p.slug} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "0.5rem 0", textDecoration: "none", borderBottom: "1px solid var(--border)",
              }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: "0.8125rem", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.shortName || p.name}
                  </p>
                  <p style={{ fontSize: "0.6875rem", color: "var(--text-secondary)" }}>{p.retailer}</p>
                </div>
                <span className="price-tag" style={{ fontSize: "0.875rem", marginLeft: "0.75rem", flexShrink: 0 }}>
                  {formatPrice(p.currentPrice)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* UPC info */}
      {primary?.upc && (
        <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", textAlign: "center", marginBottom: "1.5rem" }}>
          {"UPC: " + primary.upc}
        </p>
      )}
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
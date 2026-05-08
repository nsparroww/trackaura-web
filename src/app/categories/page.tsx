import { Metadata } from "next";
import Link from "next/link";
import { getAllProducts } from "@/lib/data";
import { CATEGORY_LABELS, CATEGORY_ICONS } from "@/types";

export const dynamic = "force-dynamic";


export const metadata: Metadata = {
  title: "All Categories â€” TrackAura Canadian Electronics Price Tracker",
  description:
    "Browse all electronics categories tracked by TrackAura. Compare prices on GPUs, CPUs, laptops, monitors, RAM, SSDs, and more across Canadian retailers.",
  alternates: { canonical: "https://www.trackaura.com/categories" },
};

export default async function CategoriesPage() {
  const allProducts = await getAllProducts();

  const categoryCounts: Record<string, number> = {};
  const categoryAtLowest: Record<string, number> = {};
  for (const p of allProducts) {
    categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
    if (p.currentPrice <= p.minPrice && p.priceCount > 1) {
      categoryAtLowest[p.category] = (categoryAtLowest[p.category] || 0) + 1;
    }
  }

  const categories = Object.entries(categoryCounts)
    .filter(([key, count]) => key !== "other" && count >= 50)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({
      key,
      label: CATEGORY_LABELS[key] || key,
      icon: CATEGORY_ICONS[key] || "ðŸ“¦",
      count,
      atLowest: categoryAtLowest[key] || 0,
    }));

  const totalProducts = allProducts.length;

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "All Electronics Categories â€” TrackAura",
    description:
      "Browse all " +
      categories.length +
      " electronics categories tracked across Canadian retailers.",
    url: "https://www.trackaura.com/categories",
    publisher: {
      "@type": "Organization",
      name: "TrackAura",
      url: "https://www.trackaura.com",
    },
  };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "2rem 1.5rem" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <nav
        style={{
          display: "flex",
          gap: "0.5rem",
          fontSize: "0.8125rem",
          marginBottom: "1.5rem",
        }}
      >
        <Link href="/" className="accent-link">
          Home
        </Link>
        <span style={{ color: "var(--text-secondary)" }}>/</span>
        <span style={{ color: "var(--text-secondary)" }}>Categories</span>
      </nav>

      <h1
        style={{
          fontFamily: "'Sora', sans-serif",
          fontWeight: 800,
          fontSize: "1.75rem",
          marginBottom: "0.75rem",
        }}
      >
        All Categories
      </h1>
      <p
        style={{
          color: "var(--text-secondary)",
          fontSize: "0.9375rem",
          lineHeight: 1.7,
          marginBottom: "2rem",
        }}
      >
        {"Tracking " +
          totalProducts.toLocaleString() +
          " products across " +
          categories.length +
          " categories from Canada Computers, Newegg Canada, and Vuugo. Click any category to browse products, filter by brand, or check our buying guide for deals."}
      </p>

      {/* Category grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: "1rem",
          marginBottom: "3rem",
        }}
      >
        {categories.map((cat) => (
          <div
            key={cat.key}
            className="card"
            style={{
              padding: "1.25rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
              }}
            >
              <span style={{ fontSize: "1.75rem" }}>{cat.icon}</span>
              <div>
                <p
                  style={{
                    fontFamily: "'Sora', sans-serif",
                    fontWeight: 700,
                    fontSize: "1rem",
                    color: "var(--text-primary)",
                    marginBottom: "0.125rem",
                  }}
                >
                  {cat.label}
                </p>
                <p
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-secondary)",
                  }}
                >
                  {cat.count.toLocaleString() + " products tracked"}
                  {cat.atLowest > 0 && (
                    <span style={{ color: "var(--accent)", fontWeight: 600 }}>
                      {" Â· " + cat.atLowest + " at lowest"}
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                fontSize: "0.8125rem",
              }}
            >
              <Link
                href={"/category/" + cat.key}
                className="accent-link"
                style={{ textDecoration: "none" }}
              >
                Browse Products
              </Link>
              <span style={{ color: "var(--border)" }}>|</span>
              <Link
                href={"/best/" + cat.key}
                className="accent-link"
                style={{ textDecoration: "none" }}
              >
                Buying Guide
              </Link>
            </div>
          </div>
        ))}
      </div>

      {/* SEO content */}
      <div
        style={{
          fontSize: "0.9375rem",
          color: "var(--text-secondary)",
          lineHeight: 1.8,
          marginBottom: "2rem",
        }}
      >
        <h2
          style={{
            fontFamily: "'Sora', sans-serif",
            fontWeight: 700,
            fontSize: "1.125rem",
            color: "var(--text-primary)",
            marginBottom: "0.75rem",
          }}
        >
          Track Electronics Prices Across Canada
        </h2>
        <p style={{ marginBottom: "1rem" }}>
          {
            "TrackAura monitors prices from Canada Computers, Newegg Canada, and Vuugo every 4 hours. Each category page shows live prices, price history charts, and highlights products currently at their lowest tracked price."
          }
        </p>
        <p style={{ marginBottom: "1rem" }}>
          {
            "Our buying guides use real scraped data to recommend the best deals in each category. Unlike editorial roundups, our recommendations are based on actual price movements \u2014 we show you which products have dropped the most, which are at historical lows, and which to wait on."
          }
        </p>
        <p>
          {"Looking for something specific? Use the "}
          <Link href="/products" className="accent-link">
            search on the products page
          </Link>
          {" to find any product across all categories, or check the "}
          <Link href="/trends" className="accent-link">
            Price Index
          </Link>
          {" to see how prices are moving across the Canadian electronics market."}
        </p>
      </div>
    </div>
  );
}

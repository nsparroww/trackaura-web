import { Metadata } from "next";
import Link from "next/link";
import { getCategoryStats, getPriceIndex } from "@/lib/data";
import { formatPrice } from "@/lib/utils";
import { CATEGORY_LABELS, CATEGORY_ICONS } from "@/types";
import PriceIndexChart from "@/components/PriceIndexChart";
import CategoryCharts from "@/components/CategoryCharts";

export const revalidate = 14400;

export const metadata: Metadata = {
  title: "Canadian Electronics Price Index — TrackAura",
  description:
    "An independent price index tracking how electronics prices move across Canada. Built from raw scraped data — not estimates. Updated daily.",
  alternates: { canonical: "https://www.trackaura.com/trends" },
};

const CATEGORY_COLORS: Record<string, string> = {
  gpus: "#e74c3c",
  cpus: "#3498db",
  ram: "#f39c12",
  ssds: "#2ecc71",
  motherboards: "#9b59b6",
  monitors: "#1abc9c",
  laptops: "#e67e22",
  keyboards: "#00b894",
  mice: "#fd79a8",
  headphones: "#a29bfe",
  cases: "#6c5ce7",
  coolers: "#00cec9",
  "power-supplies": "#fdcb6e",
  routers: "#74b9ff",
  "hard-drives": "#fab1a0",
  "gaming-consoles": "#ff7675",
  tvs: "#dfe6e9",
  tablets: "#b2bec3",
  speakers: "#ffeaa7",
  "external-storage": "#55efc4",
  printers: "#81ecec",
  "smart-home": "#a0e7e5",
  webcams: "#636e72",
  "ups-power": "#d63031",
  "network-switches": "#0984e3",
  "case-fans": "#00b4d8",
  desktops: "#e17055",
  nas: "#78e08f",
};

// Synthetic category key for the site-wide grand-total row returned by
// getCategoryStats() (see data.ts — GROUPING SETS produces this).
const OVERALL_KEY = "__overall__";

export default async function TrendsPage() {
  // Per-category + grand-total stats, aggregated in SQL. Replaces the
  // old getAllProducts() full-catalog fetch (~40K rows, ~41MB) that
  // blew the unstable_cache 2MB cap.
  const categoryStatsRaw = await getCategoryStats();
  const priceIndex = await getPriceIndex();
  const month = new Date().toLocaleString("en-CA", { month: "long" });
  const year = new Date().getFullYear();

  // Split the grand-total row out from the per-category rows.
  const overallStat = categoryStatsRaw.find((s) => s.category === OVERALL_KEY);
  const perCategory = categoryStatsRaw.filter((s) => s.category !== OVERALL_KEY);

  // Build the category table, ordered like the old page (count desc),
  // and only for categories that have a known label and at least one
  // product — same filter the old getAllProducts() version applied.
  const categoryStats = perCategory
    .filter((s) => s.category !== "other" && CATEGORY_LABELS[s.category] && s.count > 0)
    .map((s) => ({
      key: s.category,
      label: CATEGORY_LABELS[s.category] || s.category,
      icon: CATEGORY_ICONS[s.category] || "\uD83D\uDCE6",
      count: s.count,
      avg: s.avg,
      median: s.median,
      atLowest: s.atLowest,
      withDrops: s.withDrops,
      dropPercent: s.dropPercent,
      avgAboveLow: isNaN(s.avgAboveLow) ? 0 : s.avgAboveLow,
    }))
    .sort((a, b) => b.count - a.count);

  // Overall stats — straight from the grand-total row.
  const totalProducts = overallStat?.count ?? 0;
  const overallAvg = overallStat?.avg ?? 0;
  const totalAtLowest = overallStat?.atLowest ?? 0;
  const totalWithDrops = overallStat?.withDrops ?? 0;
  const overallAboveLow = overallStat && !isNaN(overallStat.avgAboveLow)
    ? overallStat.avgAboveLow
    : 0;

  // Build category chart data from the price index JSON
  // IMPORTANT: use pctChange from the JSON (fixed basket) instead of recalculating
  const categoryChartData: {
    key: string;
    label: string;
    icon: string;
    color: string;
    data: { date: string; avg: number; count: number }[];
    latestAvg: number;
    change: number | null;
  }[] = [];

  if (priceIndex && priceIndex.categories) {
    for (const [key, rawData] of Object.entries(priceIndex.categories) as [string, any][]) {
      const data = rawData.trend || rawData;
      if (!Array.isArray(data) || data.length < 2) continue;

      const label = CATEGORY_LABELS[key] || key;
      const icon = CATEGORY_ICONS[key] || "\uD83D\uDCE6";
      const color = CATEGORY_COLORS[key] || "#6c5ce7";
      const latestAvg = data[data.length - 1].avg;

      // Use the pre-calculated pctChange from the fixed basket — NOT a recalculation
      const change = typeof rawData.pctChange === "number" ? rawData.pctChange : null;

      categoryChartData.push({ key, label, icon, color, data, latestAvg, change });
    }
    categoryChartData.sort((a, b) => {
      const aCount = a.data[a.data.length - 1]?.count || 0;
      const bCount = b.data[b.data.length - 1]?.count || 0;
      return bCount - aCount;
    });
  }

  const overallChange = priceIndex?.overallPctChange ?? null;
  const basketSize = priceIndex?.basketSize ?? 0;
  // S28: derive anchor date from the first (oldest) point in the overall trend array.
  // The JSON's own `basketDate` field is unreliable — the snapshot pipeline rewrites it
  // to today's date on every run. Assumes `priceIndex.overall` is ordered oldest-first
  // (same assumption used by getCategoryTrendSignal in src/app/category/[slug]/page.tsx).
  const basketDate = priceIndex?.overall?.[0]?.date ?? "";

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Canadian Electronics Price Index \u2014 " + month + " " + year,
    description: "Independent electronics price index tracking " + totalProducts + " products across Canadian retailers. Updated daily.",
    dateModified: new Date().toISOString(),
    author: { "@type": "Organization", name: "TrackAura" },
    publisher: { "@type": "Organization", name: "TrackAura", url: "https://www.trackaura.com" },
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem 1.5rem" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />

      <nav style={{ display: "flex", gap: "0.5rem", fontSize: "0.8125rem", marginBottom: "1.5rem" }}>
        <Link href="/" className="accent-link">Home</Link>
        <span style={{ color: "var(--text-secondary)" }}>/</span>
        <span style={{ color: "var(--text-secondary)" }}>Price Index</span>
      </nav>

      <h1 style={{ fontFamily: "'Sora', sans-serif", fontWeight: 800, fontSize: "1.75rem", marginBottom: "0.75rem" }}>
        Canadian Electronics Price Index
      </h1>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "2rem" }}>
        {"An independent price index built from raw scraped data \u2014 not estimates or third-party feeds. " +
        "Tracking " + totalProducts.toLocaleString() + " products daily from Canada Computers, Newegg Canada, and Vuugo."}
      </p>

      {/* Overall market summary */}
      <div className="card" style={{ padding: "1.5rem", marginBottom: "2rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ fontFamily: "'Sora', sans-serif", fontWeight: 700, fontSize: "1.125rem" }}>
            {"Market Overview \u2014 " + month + " " + year}
          </h2>
          {overallChange !== null && (
            <span
              style={{
                fontFamily: "'Sora', sans-serif",
                fontWeight: 700,
                fontSize: "1.25rem",
                color: overallChange <= 0 ? "var(--accent)" : "var(--danger, #ff6b6b)",
              }}
            >
              {(overallChange > 0 ? "+" : "") + overallChange.toFixed(1) + "%"}
            </span>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "1rem" }}>
          <StatBox label="Products Tracked" value={totalProducts.toLocaleString()} />
          <StatBox label="Avg Price" value={formatPrice(overallAvg)} />
          <StatBox label="At Historical Low" value={totalAtLowest.toLocaleString()} accent />
          <StatBox label="Price Drops" value={totalWithDrops.toLocaleString()} />
          <StatBox
            label="Avg Above Low"
            value={overallAboveLow.toFixed(1) + "%"}
            accent={overallAboveLow < 5}
          />
        </div>
      </div>

      {/* Overall price trend chart */}
      {priceIndex && priceIndex.overall.length > 1 && (
        <div className="card" style={{ padding: "1.5rem", marginBottom: "2rem" }}>
          <h2 style={{ fontFamily: "'Sora', sans-serif", fontWeight: 700, fontSize: "1.125rem", marginBottom: "0.5rem" }}>
            Overall Price Trend
          </h2>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
            {"Average price across a fixed basket of " + basketSize.toLocaleString() + " products" +
              (basketDate ? " since " + new Date(basketDate + "T00:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : "") +
              ". Updated daily."}
          </p>
          <PriceIndexChart data={priceIndex.overall} chartId="overall" />
        </div>
      )}

      {/* Per-category price trend charts */}
      {categoryChartData.length > 0 && (
        <div style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontFamily: "'Sora', sans-serif", fontWeight: 700, fontSize: "1.125rem", marginBottom: "0.5rem" }}>
            Price Trends by Category
          </h2>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
            Click any category to see its price trend over time. Percentages are based on a fixed product basket to avoid distortion from new products.
          </p>
          <CategoryCharts categories={categoryChartData} />
        </div>
      )}

      {/* SEO content */}
      <div style={{ marginBottom: "2rem", fontSize: "0.9375rem", color: "var(--text-secondary)", lineHeight: 1.8 }}>
        <h2 style={{ fontFamily: "'Sora', sans-serif", fontWeight: 700, fontSize: "1.125rem", color: "var(--text-primary)", marginBottom: "0.75rem" }}>
          How Electronics Prices Are Moving in Canada
        </h2>
        <p style={{ marginBottom: "1rem" }}>
          {"As of " + month + " " + year + ", the average electronics price across all categories we track is " +
          formatPrice(overallAvg) + " CAD. Out of " + totalProducts.toLocaleString() + " products, " +
          totalAtLowest.toLocaleString() + " are currently sitting at the lowest price we\u2019ve ever recorded \u2014 " +
          "that\u2019s " + (totalProducts > 0 ? Math.round((totalAtLowest / totalProducts) * 100) : 0) + "% of all tracked products."}
        </p>
        {overallAboveLow > 0 && (
          <p style={{ marginBottom: "1rem" }}>
            {"On average, products are currently " + overallAboveLow.toFixed(1) + "% above their historical low. " +
            (overallAboveLow < 3
              ? "This suggests it\u2019s a good time to buy \u2014 most products are near their cheapest recorded prices."
              : overallAboveLow < 10
              ? "There\u2019s still some room for prices to drop in many categories."
              : "Prices are elevated in several categories \u2014 consider waiting for sales on big-ticket items.")}
          </p>
        )}
      </div>

      {/* Category breakdown table */}
      <h2 style={{ fontFamily: "'Sora', sans-serif", fontWeight: 700, fontSize: "1.125rem", marginBottom: "1rem" }}>
        Price Index by Category
      </h2>

      <div style={{ overflowX: "auto", marginBottom: "2rem" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)" }}>
              <th style={{ ...thStyle, textAlign: "left" }}>Category</th>
              <th style={thStyle}>Products</th>
              <th style={thStyle}>Avg Price</th>
              <th style={thStyle}>Median</th>
              <th style={thStyle}>At Lowest</th>
              <th style={thStyle}>Above Low</th>
              <th style={thStyle}>Activity</th>
            </tr>
          </thead>
          <tbody>
            {categoryStats.map((cat) => (
              <tr key={cat.key} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ ...tdStyle, textAlign: "left" }}>
                  <Link
                    href={"/best/" + cat.key}
                    style={{ textDecoration: "none", color: "var(--text-primary)", fontWeight: 600 }}
                  >
                    {cat.icon + " " + cat.label}
                  </Link>
                </td>
                <td style={tdStyle}>{cat.count}</td>
                <td style={tdStyle}>{formatPrice(cat.avg)}</td>
                <td style={tdStyle}>{formatPrice(cat.median)}</td>
                <td style={tdStyle}>
                  {cat.atLowest > 0 ? (
                    <span style={{ color: "var(--accent)", fontWeight: 600 }}>{cat.atLowest}</span>
                  ) : (
                    <span style={{ color: "var(--text-secondary)" }}>0</span>
                  )}
                </td>
                <td style={tdStyle}>
                  <span
                    style={{
                      fontWeight: 600,
                      color: cat.avgAboveLow < 3 ? "var(--accent)" : cat.avgAboveLow < 10 ? "var(--text-primary)" : "var(--danger)",
                    }}
                  >
                    {cat.avgAboveLow.toFixed(1) + "%"}
                  </span>
                </td>
                <td style={tdStyle}>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      padding: "0.125rem 0.5rem",
                      borderRadius: 4,
                      background: cat.dropPercent > 30 ? "var(--accent-glow)" : "rgba(255,255,255,0.05)",
                      color: cat.dropPercent > 30 ? "var(--accent)" : "var(--text-secondary)",
                    }}
                  >
                    {cat.dropPercent + "%"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Methodology */}
      <div className="card" style={{ padding: "1.5rem", marginBottom: "2rem" }}>
        <h2 style={{ fontFamily: "'Sora', sans-serif", fontWeight: 700, fontSize: "1rem", marginBottom: "0.75rem" }}>
          How We Calculate This
        </h2>
        <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.8 }}>
          <p style={{ marginBottom: "0.75rem" }}>
            {"The TrackAura Price Index is built from raw scraped prices \u2014 no estimates, no third-party feeds. " +
            "We check every product at Canada Computers, Newegg Canada, and Vuugo daily and record the actual listed price."}
          </p>
          <p style={{ marginBottom: "0.75rem" }}>
            {"The trend chart uses a fixed basket of " + basketSize.toLocaleString() + " products" +
              (basketDate ? " first tracked on " + new Date(basketDate + "T00:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : "") +
              ". This means the same products are compared each day, so changes reflect actual price movements \u2014 not new products entering the dataset."}
          </p>
          <p style={{ marginBottom: "0.75rem" }}>
            {"\u201CAvg Above Low\u201D shows how far current prices are from the cheapest we\u2019ve ever recorded for each product. " +
            "A low percentage means most products are near their best prices. " +
            "\u201CActivity\u201D shows what percentage of products have seen at least one price change."}
          </p>
          <p>
            {"As our dataset grows, this page will add month-over-month comparisons and seasonal pattern analysis " +
            "\u2014 building toward an independent Canadian consumer electronics price index."}
          </p>
        </div>
      </div>

      <div style={{ textAlign: "center" }}>
        <Link href="/products" className="btn-primary" style={{ textDecoration: "none", display: "inline-block" }}>
          Browse All Products
        </Link>
      </div>
    </div>
  );
}

function StatBox({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ textAlign: "center", padding: "0.75rem" }}>
      <p style={{ fontFamily: "'Sora', sans-serif", fontWeight: 700, fontSize: "1.25rem", color: accent ? "var(--accent)" : "var(--text-primary)", marginBottom: "0.25rem" }}>
        {value}
      </p>
      <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{label}</p>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "0.75rem 0.5rem",
  textAlign: "right" as const,
  fontFamily: "'Sora', sans-serif",
  fontWeight: 600,
  fontSize: "0.75rem",
  color: "var(--text-secondary)",
  textTransform: "uppercase" as const,
  letterSpacing: "0.03em",
};

const tdStyle: React.CSSProperties = {
  padding: "0.75rem 0.5rem",
  textAlign: "right" as const,
  color: "var(--text-primary)",
};

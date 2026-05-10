import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductsByCategory } from "@/lib/data";
import { formatPrice, getAmazonSearchUrl, getRetailerAffiliateUrl } from "@/lib/utils";
import { CATEGORY_LABELS, CATEGORY_ICONS } from "@/types";
import { Product } from "@/types";
import ClickTracker from "@/components/ClickTracker";
export const revalidate = 14400; // 4 hours, matches scrape cycle

// Price tiers per category: [budget_max, midrange_max] — everything above is high-end
const TIER_THRESHOLDS: Record<string, [number, number]> = {
  gpus: [400, 900],
  headphones: [50, 150],
  ssds: [100, 250],
  monitors: [300, 700],
  keyboards: [60, 150],
  mice: [40, 100],
  laptops: [800, 1500],
  ram: [75, 175],
  cpus: [200, 500],
  "power-supplies": [80, 150],
  cases: [80, 160],
  motherboards: [150, 350],
  coolers: [50, 120],
  routers: [80, 200],
  webcams: [50, 120],
  speakers: [40, 120],
  "external-storage": [80, 200],
};

// Editorial advice per category — genuine, helpful buying tips
const EDITORIAL_ADVICE: Record<string, { intro: string; bestValue: string; tip: string }> = {
  gpus: {
    intro: "The GPU market in Canada has stabilized compared to the mining-era chaos. NVIDIA\u2019s RTX 40-series and AMD\u2019s RX 7000-series offer strong options at every price point. For 1080p gaming, a budget card will handle everything. For 1440p, the mid-range tier is the sweet spot. 4K gaming still demands a high-end card.",
    bestValue: "Mid-range cards from both AMD and NVIDIA offer the best performance-per-dollar for most gamers right now.",
    tip: "Don\u2019t just look at MSRP \u2014 Canadian retail prices vary significantly between Newegg and Canada Computers, especially on AMD cards.",
  },
  cpus: {
    intro: "AMD\u2019s Ryzen lineup and Intel\u2019s latest offerings both deliver excellent value in Canada. For pure gaming, even a mid-range chip is more than enough. For productivity and multitasking, look at the higher core-count options in the mid and high-end tiers.",
    bestValue: "Mid-range 6-core processors are the sweet spot for most Canadian builders \u2014 great for gaming and everyday productivity.",
    tip: "Watch for bundle deals \u2014 some retailers discount CPUs when paired with compatible motherboards.",
  },
  monitors: {
    intro: "Monitor prices in Canada have dropped significantly, especially for 1440p IPS panels. 1080p 144Hz monitors are now very affordable for budget setups. If you\u2019re after the best gaming experience, look at 1440p 165Hz+ panels in the mid-range tier. High-end gets you 4K or ultrawide OLED.",
    bestValue: "27\u201D 1440p 165Hz IPS monitors offer the best balance of resolution, refresh rate, and price right now.",
    tip: "Check if the monitor supports your GPU\u2019s sync technology (G-Sync or FreeSync) before buying.",
  },
  ssds: {
    intro: "SSD prices have been falling steadily, making it a great time to upgrade. For most users, a PCIe Gen 3 or Gen 4 NVMe drive is plenty fast. Gen 5 drives offer bleeding-edge speeds but at a premium that\u2019s hard to justify unless you have specific workloads.",
    bestValue: "1TB PCIe Gen 4 NVMe drives hit the sweet spot between price, speed, and capacity for most builds.",
    tip: "Check if your motherboard has a heatsink for the M.2 slot \u2014 some SSDs throttle without proper cooling.",
  },
  ram: {
    intro: "DDR5 is now mainstream for new builds, while DDR4 remains the choice for older platforms and budget builders. 32GB is becoming the new standard for gaming and productivity. Speeds matter less than capacity for most use cases.",
    bestValue: "32GB DDR5 kits in the 5600\u20136000MHz range offer the best value for new AMD and Intel platforms.",
    tip: "Always buy RAM in matched kits (2x16GB rather than 2 separate sticks) for guaranteed dual-channel compatibility.",
  },
  laptops: {
    intro: "Canadian laptop prices are typically higher than US pricing, so tracking deals matters more here. Budget laptops are fine for schoolwork and browsing. For gaming or creative work, look at the mid-range tier with dedicated GPUs. High-end gets you premium build quality and top specs.",
    bestValue: "Mid-range gaming laptops with RTX 4060/5060 GPUs offer excellent portable gaming without breaking the bank.",
    tip: "Pay attention to the display \u2014 a great GPU in a laptop with a dim, low-resolution screen is a wasted opportunity.",
  },
  keyboards: {
    intro: "The mechanical keyboard market has exploded with affordable options from both established brands and newcomers. Budget options now include genuine mechanical switches. Mid-range gets you hot-swappable switches and better build quality.",
    bestValue: "Budget mechanical keyboards with hot-swap capability give you the best upgrade path without spending big upfront.",
    tip: "If you\u2019re unsure about switch preferences, get a hot-swap board so you can try different switches later.",
  },
  mice: {
    intro: "Modern gaming mice offer exceptional sensors even at budget prices. The main differentiators are shape, weight, and wireless vs wired. Wireless has caught up to wired in latency and is worth the premium for desk freedom.",
    bestValue: "Lightweight wireless gaming mice in the mid-range tier offer the best combination of performance and freedom.",
    tip: "Mouse shape is personal \u2014 check grip style compatibility before buying based on specs alone.",
  },
  headphones: {
    intro: "Canada has good options across wired and wireless headphones. Budget options handle casual listening well. For gaming, a decent headset with a built-in mic saves you from buying a separate microphone. Audiophile options start in the mid-range tier.",
    bestValue: "Wireless headsets in the mid-range offer good audio quality, comfort for long sessions, and a built-in mic.",
    tip: "For gaming, prioritize comfort and microphone quality over flashy RGB features.",
  },
  motherboards: {
    intro: "Your motherboard choice is dictated by your CPU \u2014 make sure you match the right socket (AM5 for Ryzen 7000+, LGA 1700/1851 for Intel). Budget boards cover the basics. Mid-range adds better VRMs, more M.2 slots, and WiFi.",
    bestValue: "Mid-range B-series boards (B650/B850 for AMD, B760 for Intel) offer the best feature-to-price ratio for most builds.",
    tip: "Check VRM quality reviews if you\u2019re pairing with a high-TDP processor \u2014 cheap boards can throttle expensive CPUs.",
  },
  coolers: {
    intro: "Aftermarket cooling is essential for getting the most out of modern CPUs. Tower coolers offer the best value. AIOs look clean and cool well but cost more. Budget options handle mid-range CPUs fine.",
    bestValue: "Dual-tower air coolers compete with 240mm AIOs at a fraction of the price and with no pump failure risk.",
    tip: "Check cooler height clearance against your PC case before buying \u2014 tall tower coolers don\u2019t fit every case.",
  },
  "power-supplies": {
    intro: "Never cheap out on your PSU \u2014 it powers everything. 80+ Bronze efficiency is the minimum you should consider. Modern GPUs can have power spikes, so buy more wattage than you think you need.",
    bestValue: "650\u2013850W 80+ Gold modular units offer the best long-term value and will handle most builds including mid-range GPUs.",
    tip: "Modular or semi-modular PSUs make cable management much easier and improve airflow in your case.",
  },
  cases: {
    intro: "PC cases are largely about personal preference, but airflow matters for thermals. Mesh front panels are the standard for good cooling. Budget cases have come a long way in build quality.",
    bestValue: "Mid-tower ATX cases with mesh fronts in the budget-to-mid tier offer the best airflow and compatibility for the price.",
    tip: "Check GPU length clearance and CPU cooler height limits before buying \u2014 these are the most common fitment issues.",
  },
  routers: {
    intro: "WiFi 6 and WiFi 6E routers have become very affordable. For most homes, a single router handles everything. Larger homes benefit from mesh systems. WiFi 7 is arriving but at a significant premium.",
    bestValue: "WiFi 6 routers in the mid-range cover most homes and support plenty of devices without the WiFi 7 premium.",
    tip: "Placement matters more than specs \u2014 a mid-range router in the right spot beats an expensive one tucked in a closet.",
  },
  webcams: {
    intro: "1080p webcams are the baseline for video calls now, with 4K options available for streamers and content creators. Most people don\u2019t need more than a solid 1080p option with good low-light performance.",
    bestValue: "1080p webcams with auto-focus and decent low-light handling cover most needs for calls and basic streaming.",
    tip: "Good lighting does more for video quality than upgrading from 1080p to 4K \u2014 invest in a ring light first.",
  },
  speakers: {
    intro: "PC speakers range from basic stereo pairs to full 2.1 systems with subwoofers. Budget options handle media and casual music well. For a real upgrade, look at powered bookshelf speakers in the mid-range.",
    bestValue: "2.0 powered speakers in the mid-range offer surprisingly good audio that rivals much more expensive setups.",
    tip: "Placement at ear level and slightly angled toward you makes any speaker sound dramatically better.",
  },
  "external-storage": {
    intro: "External storage is essential for backups and portable work. External SSDs are much faster but cost more per TB. HDDs still make sense for bulk storage and backups where speed isn\u2019t critical.",
    bestValue: "1\u20132TB external SSDs offer the best balance of speed, portability, and price for most users.",
    tip: "Always keep a backup of irreplaceable files \u2014 no drive lasts forever, regardless of price.",
  },
};

// Default editorial for categories not listed above
const DEFAULT_EDITORIAL = {
  intro: "We track prices across Canadian retailers so you can find the best deals. Prices are updated every 4 hours to make sure you\u2019re seeing the latest numbers.",
  bestValue: "The mid-range tier typically offers the best performance-to-price ratio in this category.",
  tip: "Always compare prices between retailers \u2014 the same product can vary by $20\u201350+ depending on the store.",
};

type PageProps = { params: Promise<{ category: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { category } = await params;
  const label = CATEGORY_LABELS[category];
  if (!label) return { title: "Not Found" };

  const month = new Date().toLocaleString("en-CA", { month: "long" });
  const year = new Date().getFullYear();

  return {
    title: "Best " + label + " Deals in Canada \u2014 " + month + " " + year,
    description:
      "Find the best " + label.toLowerCase() + " prices in Canada for " + month + " " + year +
      ". Compare prices across Canada Computers and Newegg. Real price tracking data updated every 4 hours.",
    alternates: { canonical: "https://www.trackaura.com/best/" + category },
  };
}

export default async function BestCategoryPage({ params }: PageProps) {
  const { category } = await params;
  const label = CATEGORY_LABELS[category];
  if (!label) notFound();

  const icon = CATEGORY_ICONS[category] || "\uD83D\uDCE6";
  // CHANGED: Was getAllProducts().filter(category) which scanned all 37K rows.
  // Now scoped to ~3K rows per category. Same data, ~12x fewer Turso reads.
  const allProducts = await getProductsByCategory(category);
  const thresholds = TIER_THRESHOLDS[category] || [100, 300];
  const month = new Date().toLocaleString("en-CA", { month: "long" });
  const year = new Date().getFullYear();
  const editorial = EDITORIAL_ADVICE[category] || DEFAULT_EDITORIAL;

  // --- Product selections ---
  const atLowest = allProducts.filter((p) => p.currentPrice <= p.minPrice && p.priceCount > 1);
  const biggestDrops = allProducts
    .filter((p) => p.minPrice < p.maxPrice && p.currentPrice < p.maxPrice)
    .map((p) => ({ ...p, savings: p.maxPrice - p.currentPrice, drop: Math.round(((p.maxPrice - p.currentPrice) / p.maxPrice) * 100) }))
    .sort((a, b) => b.savings - a.savings)
    .slice(0, 5);

  // Tiered products: Budget / Mid-Range / High-End
  const budget = allProducts
    .filter((p) => p.currentPrice < thresholds[0])
    .sort((a, b) => a.currentPrice - b.currentPrice);
  const midrange = allProducts
    .filter((p) => p.currentPrice >= thresholds[0] && p.currentPrice < thresholds[1])
    .sort((a, b) => a.currentPrice - b.currentPrice);
  const highend = allProducts
    .filter((p) => p.currentPrice >= thresholds[1])
    .sort((a, b) => a.currentPrice - b.currentPrice);

  // Best Value pick: best savings ratio among products with real drops, reasonable price
  const bestValuePick = allProducts
    .filter((p) => p.minPrice < p.maxPrice && p.currentPrice < p.maxPrice && p.currentPrice >= thresholds[0] * 0.5)
    .sort((a, b) => {
      const aScore = ((a.maxPrice - a.currentPrice) / a.maxPrice) * 0.6 + (a.priceCount > 3 ? 0.4 : 0);
      const bScore = ((b.maxPrice - b.currentPrice) / b.maxPrice) * 0.6 + (b.priceCount > 3 ? 0.4 : 0);
      return bScore - aScore;
    })[0] || null;

  const retailers = [...new Set(allProducts.map((p) => p.retailer))];

  // Stats
  const prices = allProducts.map((p) => p.currentPrice);
  const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  const medianPrice = prices.length > 0 ? [...prices].sort((a, b) => a - b)[Math.floor(prices.length / 2)] : 0;
  const lowestPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const highestPrice = prices.length > 0 ? Math.max(...prices) : 0;
  const atLowestCount = atLowest.length;
  const withDrops = allProducts.filter((p) => p.currentPrice < p.maxPrice && p.minPrice < p.maxPrice).length;

  const retailerCounts: Record<string, number> = {};
  for (const p of allProducts) {
    retailerCounts[p.retailer] = (retailerCounts[p.retailer] || 0) + 1;
  }

  const topBrands: { name: string; count: number }[] = (() => {
    const brandCounts: Record<string, number> = {};
    for (const p of allProducts) {
      const brand = p.name.split(/\s+/)[0].toUpperCase();
      if (brand.length >= 2 && brand.length <= 20) {
        brandCounts[brand] = (brandCounts[brand] || 0) + 1;
      }
    }
    return Object.entries(brandCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));
  })();

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Best " + label + " Deals in Canada \u2014 " + month + " " + year,
    description: "Find the best " + label.toLowerCase() + " prices in Canada. Compare across " + retailers.join(" and ") + ".",
    dateModified: new Date().toISOString(),
    author: { "@type": "Organization", name: "TrackAura" },
    publisher: { "@type": "Organization", name: "TrackAura", url: "https://www.trackaura.com" },
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem 1.5rem" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />

      <nav style={{ display: "flex", gap: "0.5rem", fontSize: "0.8125rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <Link href="/" className="accent-link">Home</Link>
        <span style={{ color: "var(--text-secondary)" }}>/</span>
        <Link href="/products" className="accent-link">Products</Link>
        <span style={{ color: "var(--text-secondary)" }}>/</span>
        <span style={{ color: "var(--text-secondary)" }}>{"Best " + label}</span>
      </nav>

      {/* Hero + editorial intro */}
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontFamily: "'Sora', sans-serif", fontWeight: 800, fontSize: "1.75rem", marginBottom: "0.75rem" }}>
          {icon + " Best " + label + " Deals in Canada \u2014 " + month + " " + year}
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1rem" }}>
          {editorial.intro}
        </p>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", lineHeight: 1.7 }}>
          {"We\u2019re tracking " + allProducts.length.toLocaleString() + " " + label.toLowerCase() +
          " from " + retailers.join(" and ") + ", updated every 4 hours."}
        </p>
      </div>

      {/* Best Value pick */}
      {bestValuePick && (
        <div className="card" style={{ padding: "1.25rem 1.5rem", marginBottom: "2rem", border: "1px solid var(--accent)", background: "var(--accent-glow)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <span style={{ background: "var(--accent)", color: "#06090f", fontWeight: 700, fontSize: "0.6875rem", padding: "0.25rem 0.625rem", borderRadius: 999, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Best Value
            </span>
            <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{bestValuePick.retailer}</span>
          </div>
          <Link href={"/product/" + bestValuePick.slug} style={{ fontFamily: "'Sora', sans-serif", fontWeight: 600, fontSize: "1rem", color: "var(--text-primary)", textDecoration: "none", display: "block", marginBottom: "0.5rem" }}>
            {bestValuePick.name}
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <span className="price-tag" style={{ fontSize: "1.375rem" }}>{formatPrice(bestValuePick.currentPrice)}</span>
            {bestValuePick.minPrice < bestValuePick.maxPrice && (
              <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                {"Range: " + formatPrice(bestValuePick.minPrice) + " \u2013 " + formatPrice(bestValuePick.maxPrice)}
              </span>
            )}
            <Link href={"/product/" + bestValuePick.slug} className="btn-primary" style={{ textDecoration: "none", fontSize: "0.8125rem", padding: "0.5rem 1rem", marginLeft: "auto" }}>
              View Deal
            </Link>
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.5rem", fontStyle: "italic" }}>
            {editorial.bestValue}
          </p>
        </div>
      )}

      {/* Market snapshot */}
      <div className="card" style={{ padding: "1.5rem", marginBottom: "2rem" }}>
        <h2 style={{ fontFamily: "'Sora', sans-serif", fontWeight: 700, fontSize: "1.125rem", marginBottom: "1rem" }}>
          {label + " Price Snapshot \u2014 " + month + " " + year}
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "1rem" }}>
          <StatBox label="Products Tracked" value={allProducts.length.toLocaleString()} />
          <StatBox label="Average Price" value={formatPrice(avgPrice)} />
          <StatBox label="Median Price" value={formatPrice(medianPrice)} />
          <StatBox label="Cheapest" value={formatPrice(lowestPrice)} accent />
          <StatBox label="Most Expensive" value={formatPrice(highestPrice)} />
          <StatBox label="At Lowest Price" value={atLowestCount.toString()} accent />
        </div>
      </div>

      {/* Market context */}
      <div style={{ marginBottom: "2rem", fontSize: "0.9375rem", color: "var(--text-secondary)", lineHeight: 1.8 }}>
        <h2 style={{ fontFamily: "'Sora', sans-serif", fontWeight: 700, fontSize: "1.125rem", color: "var(--text-primary)", marginBottom: "0.75rem" }}>
          {"What\u2019s Happening with " + label + " Prices in Canada"}
        </h2>
        <p style={{ marginBottom: "1rem" }}>
          {"As of " + month + " " + year + ", the average " + label.toLowerCase() +
          " price across Canadian retailers is " + formatPrice(avgPrice) +
          " CAD, with options ranging from " + formatPrice(lowestPrice) + " to " + formatPrice(highestPrice) +
          ". The median sits at " + formatPrice(medianPrice) + "."}
        </p>
        {atLowestCount > 0 && (
          <p style={{ marginBottom: "1rem" }}>
            {atLowestCount + " " + label.toLowerCase() +
            (atLowestCount === 1 ? " is " : " are ") +
            "currently at the lowest price we\u2019ve ever tracked."}
          </p>
        )}
        {topBrands.length > 0 && (
          <p style={{ marginBottom: "1rem" }}>
            {"Top brands we track: " +
            topBrands.map((b) => b.name.charAt(0) + b.name.slice(1).toLowerCase()).join(", ") + "."}
          </p>
        )}
      </div>

      {/* Biggest drops */}
      {biggestDrops.length > 0 && (
        <Section title={"\uD83D\uDD25 Biggest Price Drops"}>
          {biggestDrops.map((p) => (<ProductRow key={p.id} product={p} badge={"-" + p.drop + "% (\u2212$" + p.savings.toFixed(0) + ")"} />))}
        </Section>
      )}

      {/* At lowest */}
      {atLowest.length > 0 && (
        <Section title={"\u2B07\uFE0F At Their Lowest Tracked Price"}>
          {atLowest.slice(0, 5).map((p) => (<ProductRow key={p.id} product={p} badge="Lowest Ever" />))}
        </Section>
      )}

      {/* Budget tier */}
      {budget.length > 0 && (
        <Section title={"\uD83D\uDCB0 Budget " + label + " (Under $" + thresholds[0] + ")"}>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginBottom: "0.75rem", padding: "0 1rem" }}>
            {"Great options if you\u2019re building on a budget or need a solid baseline."}
          </p>
          {budget.slice(0, 5).map((p) => (<ProductRow key={p.id} product={p} />))}
        </Section>
      )}

      {/* Mid-range tier */}
      {midrange.length > 0 && (
        <Section title={"\u2B50 Mid-Range " + label + " ($" + thresholds[0] + "\u2013$" + thresholds[1] + ")"}>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginBottom: "0.75rem", padding: "0 1rem" }}>
            {"The sweet spot for most buyers \u2014 strong performance without overpaying."}
          </p>
          {midrange.slice(0, 5).map((p) => (<ProductRow key={p.id} product={p} />))}
        </Section>
      )}

      {/* High-end tier */}
      {highend.length > 0 && (
        <Section title={"\uD83D\uDE80 High-End " + label + " ($" + thresholds[1] + "+)"}>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginBottom: "0.75rem", padding: "0 1rem" }}>
            {"Premium picks for enthusiasts and professionals who want the best."}
          </p>
          {highend.slice(0, 5).map((p) => (<ProductRow key={p.id} product={p} />))}
        </Section>
      )}

      {/* Buying advice */}
      <div className="card" style={{ padding: "1.5rem", marginBottom: "2rem" }}>
        <h2 style={{ fontFamily: "'Sora', sans-serif", fontWeight: 700, fontSize: "1.125rem", marginBottom: "0.75rem" }}>
          {"Tips for Buying " + label + " in Canada"}
        </h2>
        <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.8 }}>
          <p style={{ marginBottom: "0.75rem" }}>
            <strong style={{ color: "var(--text-primary)" }}>Our tip:</strong>{" " + editorial.tip}
          </p>
          <p style={{ marginBottom: "0.75rem" }}>
            {"Always compare prices across retailers before buying. We\u2019ve seen the same product priced differently at Canada Computers and Newegg \u2014 sometimes by $20\u201350 or more."}
          </p>
          <p style={{ marginBottom: "0.75rem" }}>
            {"Check the price history chart on any product page to see if the current price is a genuine deal or if it\u2019s been lower before."}
          </p>
          <p>
            {"Set a price alert on TrackAura and we\u2019ll email you when the price drops to your target."}
          </p>
        </div>
      </div>

      {/* How we track */}
      <div className="card" style={{ padding: "1.5rem", marginBottom: "2rem" }}>
        <h2 style={{ fontFamily: "'Sora', sans-serif", fontWeight: 600, fontSize: "1rem", marginBottom: "0.75rem" }}>
          {"How We Track " + label + " Prices"}
        </h2>
        <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
          {"TrackAura automatically checks prices at " + retailers.join(" and ") +
          " every 4 hours. We record every price change so you can see the full history and buy at the right time. " +
          "All prices are in Canadian dollars (CAD). Some links may earn TrackAura a commission. " +
          "This page updates automatically as new data comes in."}
        </p>
      </div>

      <div style={{ marginTop: "1.5rem", textAlign: "center" }}>
        <Link href={"/category/" + category} className="btn-primary" style={{ textDecoration: "none", display: "inline-block" }}>
          {"View All " + allProducts.length.toLocaleString() + " " + label}
        </Link>
      </div>
    </div>
  );
}

function StatBox({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ textAlign: "center", padding: "0.75rem" }}>
      <p style={{
        fontFamily: "'Sora', sans-serif",
        fontWeight: 700,
        fontSize: "1.25rem",
        color: accent ? "var(--accent)" : "var(--text-primary)",
        marginBottom: "0.25rem",
      }}>
        {value}
      </p>
      <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{label}</p>
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

function ProductRow({ product, badge }: { product: Product & { drop?: number; savings?: number }; badge?: string }) {
  const affiliateUrl = getRetailerAffiliateUrl(product);
  const isAffiliate = product.retailer === "Newegg Canada";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flex: 1, minWidth: 200 }}>
        {product.imageUrl && (
          <div style={{ width: 44, height: 44, flexShrink: 0, background: "#fff", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            <img src={product.imageUrl} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} loading="lazy" />
          </div>
        )}
        <div>
          <Link href={"/product/" + product.slug} style={{ fontSize: "0.875rem", color: "var(--text-primary)", textDecoration: "none", fontWeight: 500 }}>
            {product.shortName || product.name}
          </Link>
          <p style={{ fontSize: "0.6875rem", color: "var(--text-secondary)", marginTop: 2 }}>{product.retailer}</p>
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
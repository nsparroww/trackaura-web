import Link from "next/link";

export default function Footer() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--border)",
        padding: "3rem 1.5rem 2rem",
        marginTop: "4rem",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "2rem",
        }}
      >
        <div>
          <p
            style={{
              fontFamily: "'Sora', sans-serif",
              fontWeight: 700,
              fontSize: "1rem",
              marginBottom: "0.5rem",
            }}
          >
            Track<span style={{ color: "var(--accent)" }}>Aura</span>
          </p>
          <p
            style={{
              color: "var(--text-secondary)",
              fontSize: "0.8125rem",
              maxWidth: 320,
              lineHeight: 1.6,
            }}
          >
            A canonical catalog of consumer electronics in Canada. Independent. Updated daily.
          </p>
        </div>

        <div style={{ display: "flex", gap: "3rem", flexWrap: "wrap" }}>
          <div>
            <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem", fontFamily: "'Sora', sans-serif" }}>
              Categories
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <Link href="/c/gpus" className="accent-link" style={{ fontSize: "0.875rem" }}>Graphics Cards</Link>
              <Link href="/c/cpus" className="accent-link" style={{ fontSize: "0.875rem" }}>CPUs</Link>
              <Link href="/c/ram" className="accent-link" style={{ fontSize: "0.875rem" }}>RAM</Link>
              <Link href="/c/monitors" className="accent-link" style={{ fontSize: "0.875rem" }}>Monitors</Link>
              <Link href="/c/laptops" className="accent-link" style={{ fontSize: "0.875rem" }}>Laptops</Link>
              <Link href="/products" className="accent-link" style={{ fontSize: "0.875rem" }}>All Products</Link>
            </div>
          </div>
          <div>
            <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem", fontFamily: "'Sora', sans-serif" }}>
              Retailers We Track
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <a href="https://www.canadacomputers.com" target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.875rem", color: "var(--cc-color)", textDecoration: "none" }}>Canada Computers</a>
              <a href="https://www.newegg.ca" target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.875rem", color: "var(--newegg-color)", textDecoration: "none" }}>Newegg Canada</a>
              <a href="https://www.vuugo.com" target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.875rem", color: "var(--text-secondary)", textDecoration: "none" }}>Vuugo</a>
              <a href="https://www.visions.ca" target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.875rem", color: "var(--text-secondary)", textDecoration: "none" }}>Visions Electronics</a>
            </div>
          </div>
          <div>
            <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem", fontFamily: "'Sora', sans-serif" }}>
              Company
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <Link href="/about" className="accent-link" style={{ fontSize: "0.875rem" }}>About</Link>
              <Link href="/blog" className="accent-link" style={{ fontSize: "0.875rem" }}>Blog</Link>
              <Link href="/trends" className="accent-link" style={{ fontSize: "0.875rem" }}>Price Index</Link>
              <Link href="/privacy" className="accent-link" style={{ fontSize: "0.875rem" }}>Privacy Policy</Link>
              <Link href="/terms" className="accent-link" style={{ fontSize: "0.875rem" }}>Terms of Use</Link>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          maxWidth: 1200,
          margin: "2rem auto 0",
          paddingTop: "1.5rem",
          borderTop: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "0.75rem",
          color: "var(--text-secondary)",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <p>&copy; {new Date().getFullYear()} TrackAura. Prices in CAD.</p>
        <p style={{ fontSize: "0.6875rem", opacity: 0.6 }}>
          Some links may earn TrackAura a commission.
        </p>
      </div>
    </footer>
  );
}

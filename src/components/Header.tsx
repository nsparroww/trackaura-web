"use client";

import Link from "next/link";
import { useState } from "react";
import SearchBar from "@/components/SearchBar";

const NAV_LINKS = [
  { href: "/trends", label: "Price Index", accent: false },
  { href: "/products", label: "Products", accent: false },
  { href: "/brands", label: "Brands", accent: false },
  { href: "/blog", label: "Blog", accent: false },
  { href: "/about", label: "About", accent: false },
];

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        borderBottom: "1px solid var(--border)",
        background: "rgba(6, 9, 15, 0.85)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 1.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 64,
          gap: "0.75rem",
        }}
      >
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            textDecoration: "none",
            flexShrink: 0,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: "linear-gradient(135deg, #00e5a0, #38bdf8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              fontWeight: 800,
              color: "#06090f",
              fontFamily: "'Sora', sans-serif",
            }}
          >
            T
          </span>
          <span
            style={{
              fontFamily: "'Sora', sans-serif",
              fontWeight: 700,
              fontSize: "1.125rem",
              color: "var(--text-primary)",
            }}
          >
            Track<span style={{ color: "var(--accent)" }}>Aura</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="desktop-nav">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              style={{
                padding: "0.375rem 0.625rem",
                borderRadius: 6,
                fontSize: "0.8125rem",
                fontWeight: link.accent ? 600 : 500,
                color: link.accent ? "var(--accent)" : "var(--text-secondary)",
                textDecoration: "none",
                transition: "color 0.15s",
                fontFamily: "'DM Sans', sans-serif",
                whiteSpace: "nowrap",
              }}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Desktop search */}
        <div className="desktop-search" style={{ width: 220, flexShrink: 0 }}>
          <SearchBar />
        </div>

        {/* Mobile: search toggle + menu toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
          <button
            className="mobile-menu-btn"
            onClick={() => { setSearchOpen(!searchOpen); setMenuOpen(false); }}
            aria-label="Search"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0.5rem",
              display: "none",
            }}
          >
            <svg width={22} height={22} fill="none" stroke="var(--text-primary)" strokeWidth={2} viewBox="0 0 24 24">
              <circle cx={11} cy={11} r={8} />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </button>
          <button
            className="mobile-menu-btn"
            onClick={() => { setMenuOpen(!menuOpen); setSearchOpen(false); }}
            aria-label="Menu"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0.5rem",
              display: "none",
            }}
          >
            <svg width={24} height={24} fill="none" stroke="var(--text-primary)" strokeWidth={2} viewBox="0 0 24 24">
              {menuOpen ? (
                <path d="M6 6l12 12M6 18L18 6" />
              ) : (
                <path d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile search dropdown */}
      {searchOpen && (
        <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg-secondary)", padding: "0.75rem 1.5rem" }}>
          <SearchBar />
        </div>
      )}

      {/* Mobile menu dropdown - renders the exact same NAV_LINKS as desktop
          so the two navs stay in sync. Do not add extra links here without
          also adding them to NAV_LINKS above. */}
      {menuOpen && (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            background: "var(--bg-secondary)",
            padding: "0.75rem 1.5rem",
          }}
        >
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              style={{
                display: "block",
                padding: "0.625rem 0",
                fontSize: "0.9375rem",
                fontWeight: link.accent ? 600 : 500,
                color: link.accent ? "var(--accent)" : "var(--text-secondary)",
                textDecoration: "none",
                borderBottom: "1px solid var(--border)",
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}

      <style>{`
        .desktop-nav {
          display: flex;
          gap: 0.125rem;
          align-items: center;
        }
        .desktop-search {
          display: block;
        }
        .mobile-menu-btn {
          display: none !important;
        }
        @media (max-width: 768px) {
          .desktop-nav {
            display: none !important;
          }
          .desktop-search {
            display: none !important;
          }
          .mobile-menu-btn {
            display: block !important;
          }
        }
      `}</style>
    </header>
  );
}
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
    remotePatterns: [
      // Canada Computers
      { protocol: "https", hostname: "ccimg1.canadacomputers.com" },
      { protocol: "https", hostname: "ccimg2.canadacomputers.com" },
      { protocol: "https", hostname: "www.canadacomputers.com" },
      // Newegg Canada
      { protocol: "https", hostname: "c1.neweggimages.com" },
      { protocol: "https", hostname: "c2.neweggimages.com" },
      { protocol: "https", hostname: "images10.newegg.com" },
      { protocol: "https", hostname: "images11.newegg.com" },
      // Vuugo (Cloudfront — subdomain may rotate, so wildcard)
      { protocol: "https", hostname: "**.cloudfront.net" },
      { protocol: "https", hostname: "www.vuugo.com" },
      { protocol: "https", hostname: "vuugo.com" },
      // TechPowerUp — chip imagery via dbgpu (canonical_entities.image_primary_url)
      // Path-prefix locked so only the gpu-specs image folder is reachable through
      // our optimizer. EntityPage uses unoptimized=true today since these are
      // already small (~30KB JPEGs); the allowlist still applies as a safety net.
      {
        protocol: "https",
        hostname: "www.techpowerup.com",
        pathname: "/gpu-specs/images-new/**",
      },
    ],
  },
  async redirects() {
    return [
      // New canonical URL shapes. The old /category/:slug and /product/:slug
      // routes still exist on disk but read the deleted snapshot JSON, so
      // these redirects ensure every visitor lands on the live SSR pages.
      {
        source: "/category/:slug",
        destination: "/c/:slug",
        permanent: true,
      },

      // Old /products?category=X → new /c/X (updated from /category/X)
      ...[
        "gpus", "cpus", "ssds", "ram", "monitors", "keyboards", "mice",
        "laptops", "motherboards", "power-supplies", "cases", "coolers",
        "headphones", "speakers", "routers", "webcams", "external-storage",
        "hard-drives", "tvs", "tablets", "printers", "gaming-consoles",
        "smart-home", "ups-power", "network-switches", "case-fans",
        "desktops", "nas",
      ].map((cat) => ({
        source: "/products",
        has: [{ type: "query" as const, key: "category", value: cat }],
        destination: `/c/${cat}`,
        permanent: true,
      })),

      // /changes → homepage
      {
        source: "/changes",
        destination: "/",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;

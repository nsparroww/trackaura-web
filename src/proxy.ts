import { NextRequest, NextResponse } from "next/server";
import { isBlockedUserAgent } from "@/lib/bot-policy";

// ============================================================================
// Edge proxy — runs on every non-static, non-catalog request (see config.matcher).
//
// Two responsibilities:
//   1. Maintenance kill-switch (env var, no redeploy required).
//   2. Bot blocking — returns 403 immediately, cheapest possible reject.
//
// IMPORTANT: catalog routes (/p, /product, /c, /chip, /board, /cpu) are
// EXCLUDED from this middleware. Edge middleware running on a route opts
// it out of ISR static caching — verified 2026-05-09 when getProductViewModel
// cache() + revalidate=3600 still showed X-Vercel-Cache: MISS on every hit
// because proxy.ts was matching /p/[slug] and forcing dynamic rendering.
//
// Bot policy on catalog routes is enforced via robots.txt (declarative)
// + Vercel Firewall + Attack Challenge Mode (per ARCHITECTURE.md §7).
// Verified AI bots (ClaudeBot, GPTBot, etc.) are EXPLICITLY ALLOWED on
// these routes — they drive §1 user moment 5 (the machine).
//
// Bot policy lives in src/lib/bot-policy.ts (single source of truth shared
// with src/app/robots.ts per ARCHITECTURE.md §13.16). Do NOT add hardcoded
// UA strings here — edit bot-policy.ts and both consumers update together.
// ============================================================================

export function proxy(request: NextRequest) {
  // ─────────────────────────────────────────────────────────────────────
  // Kill switch — flip MAINTENANCE_MODE=1 in Vercel env vars to instantly
  // serve a maintenance page without redeploying. Useful if costs spike
  // or a bug is found in production.
  // ─────────────────────────────────────────────────────────────────────
  if (process.env.MAINTENANCE_MODE === "1") {
    const pathname = request.nextUrl.pathname;
    // Allow static assets and the maintenance page itself through
    if (
      pathname.startsWith("/_next/") ||
      pathname.startsWith("/favicon") ||
      pathname === "/robots.txt"
    ) {
      return NextResponse.next();
    }
    return new NextResponse(
      "<!DOCTYPE html><html><head><title>TrackAura - Maintenance</title><meta name='viewport' content='width=device-width,initial-scale=1'><style>body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:2rem}h1{font-size:1.5rem;margin-bottom:1rem}p{color:#999;max-width:500px}</style></head><body><div><h1>TrackAura is briefly offline</h1><p>We're performing maintenance. Please check back shortly.</p></div></body></html>",
      {
        status: 503,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Retry-After": "3600",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // Bot blocking — check user agent against shared blocklist.
  // ─────────────────────────────────────────────────────────────────────
  const userAgent = request.headers.get("user-agent") || "";

  // Empty or near-empty UA is almost always a bot or script.
  if (!userAgent || userAgent.length < 10) {
    return new NextResponse("Forbidden", {
      status: 403,
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  }

  if (isBlockedUserAgent(userAgent)) {
    return new NextResponse("Forbidden: automated access not permitted", {
      status: 403,
      headers: {
        "Cache-Control": "public, max-age=86400",
        "X-Robots-Tag": "noindex",
      },
    });
  }

  return NextResponse.next();
}

// ============================================================================
// Matcher — run proxy on all routes EXCEPT:
//   - static assets (favicon, robots.txt, sitemap.xml, image/font extensions)
//   - _next internals
//   - catalog/entity routes (these need ISR caching — see file header)
//
// The negative lookahead excludes:
//   _next/static, _next/image, favicon.ico, robots.txt, sitemap.xml,
//   any *.{svg,png,jpg,jpeg,gif,webp,ico,css,js,woff,woff2},
//   /p, /product, /c, /chip, /board, /cpu — including their subroutes
//   (note: /api/health and /api/* still go through middleware, which is
//    desirable for bot blocking on those endpoints).
// ============================================================================
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|p/|product/|c/|chip/|board/|cpu/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2)$).*)",
  ],
};

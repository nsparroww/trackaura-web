import { NextRequest, NextResponse } from "next/server";
import { isBlockedUserAgent } from "@/lib/bot-policy";

// ============================================================================
// Edge proxy — runs on every non-static request (see config.matcher below).
//
// Two responsibilities:
//   1. Maintenance kill-switch (env var, no redeploy required).
//   2. Bot blocking — returns 403 immediately, cheapest possible reject.
//
// Bot policy lives in src/lib/bot-policy.ts (single source of truth shared
// with src/app/robots.ts per ARCHITECTURE.md §13.16). Do NOT add hardcoded
// UA strings here — edit bot-policy.ts and both consumers update together.
// ============================================================================

export function proxy(request: NextRequest) {
  // ──────────────────────────────────────────────────────────────────────
  // Kill switch — flip MAINTENANCE_MODE=1 in Vercel env vars to instantly
  // serve a maintenance page without redeploying. Useful if costs spike
  // or a bug is found in production.
  // ──────────────────────────────────────────────────────────────────────
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

  // ──────────────────────────────────────────────────────────────────────
  // Bot blocking — check user agent against shared blocklist.
  // ──────────────────────────────────────────────────────────────────────
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
// Matcher — run proxy on all routes except static assets.
// Static files don't need bot filtering (cached at the edge anyway) and
// excluding them saves on proxy invocations.
// ============================================================================
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2)$).*)",
  ],
};

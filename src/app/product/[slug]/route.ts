/**
 * Legacy /product/[slug] route handler.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Background
 * ─────────────────────────────────────────────────────────────────────────────
 * A slug regen on 2026-04-17 rewrote canonical_products into a doubled-brand-
 * prefix form ('gigabyte-gigabyte-...'), truncated some slugs, and prefixed
 * others with a stray leading digit. Google had the OLD slugs cached. By
 * 2026-05-08 GSC reported 11,188 /product/ URLs returning 404, and site
 * impressions collapsed ~65% in two weeks (GSC export, 2026-05-14).
 *
 * The previous handler 410'd everything that didn't exact-match canonical_
 * products, which destroyed the ranking equity on ~739 dead URLs that were
 * actually LIVE products under drifted slugs. The whole site's ranked surface
 * is on /product/* — this was the bleeding.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Renderability is the gating condition, not slug existence
 * ─────────────────────────────────────────────────────────────────────────────
 * /p/[slug] (the redirect target) doesn't just check that a canonical_products
 * row exists — getProductViewModel returns null and the page 404s unless:
 *   (a) a canonical_products row matches `slug` OR `{first-segment}-{slug}`
 *       (it does the doubled-prefix prepend itself), AND
 *   (b) that row has >= 1 linked `products` row (canonical_id FK).
 *
 * So the handler must only 301 when the target will actually render. Any 301
 * to an unrenderable /p/ URL just relocates the 404. That's the smoke-test
 * failure mode that this handler explicitly guards against by checking BOTH
 * conditions before 301-ing.
 *
 * v3 note: an earlier draft tried `select('...products!inner(id)')` to enforce
 * (b) in one query. PostgREST returned the parent row anyway when the inner
 * join had zero rows on this schema, so the orphan-row guard didn't fire.
 * v3 replaces that with an explicit two-step check that mirrors exactly what
 * getProductViewModel itself does: fetch the canonical row, then fetch
 * products WHERE canonical_id = id LIMIT 1. Same pattern as /p/[slug].
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Resolution lanes (first hit wins)
 * ─────────────────────────────────────────────────────────────────────────────
 * Recon (2026-05-14, n=999 dead slugs from GSC export):
 *
 *   L_exact     /p/{slug} renders directly via its own resolution        17.4%
 *               (cp row exists for `slug` or `{first}-{slug}` AND has
 *               linked products).
 *               -> 301 /p/{slug}, /p/ takes it from there in one hop.
 *
 *   L_contains  unique cp slug CONTAINS the dead slug AND has linked      12.0%
 *               products. Catches GSC-truncated slugs. Substring match
 *               is exact and uniqueness-guarded — cannot resolve to the
 *               wrong product.
 *               -> 301 /p/{trueSlug}
 *
 *   L_gone      none of the above                                        70.6%
 *               -> 410 Gone
 *
 * No pg_trgm fuzzy lane. An earlier draft included one; recon proved it
 * unsafe at every threshold tested (bible Risk #19): pg_trgm matches the
 * wrong product when slugs differ only by a single variant (5070 Ti vs 5060,
 * Switch Pro Controller vs Switch 2 Pro Controller). A token-set guard
 * killed the wrong-product matches but also killed legitimate same-product
 * matches that differed in slug-formatting (`156` vs `15-6`, `1-35v` vs
 * `135v`). No safe form of the lane shipped this session; logged for follow-up.
 *
 * 29.4% recovered is the FLOOR. Future work to safely add a fuzzy lane can
 * only improve it. Shipping a working 29% beats holding for a tuned 60% that
 * might be wrong.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Notes
 * ─────────────────────────────────────────────────────────────────────────────
 *   - 301 (permanent) tells Google to move the index entry.
 *   - 410 (Gone) de-indexes faster than 404. Correct for genuinely removed.
 *   - Redirect target is always /p/{...} — /p/[slug] is the legacy v0 read
 *     path that still serves all of canonical_products today. Recon showed
 *     only 4 of 999 dead slugs resolved into canonical_entities-only; that
 *     entity-routing edge case is logged for follow-up, not handled here.
 *   - force-dynamic: per-request DB lookup, never prerendered.
 *   - On Supabase error we 410 rather than 500; transient blips shouldn't
 *     surface as server errors. Google retries 410s.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Minimum dead-slug length for the contains lane. Below this a substring
 * match is too weak to trust — short tokens can appear inside many live
 * slugs. Recon used 25; kept here. Combined with the uniqueness check,
 * recon found 0 ambiguous matches across 999 slugs.
 */
const MIN_CONTAINS_LEN = 25;

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Check whether a canonical_products row has >= 1 linked products row.
 * Mirrors getProductViewModel's own check (see /p/[slug]/page.tsx and
 * src/lib/queries/product.ts). True iff renderable on /p/.
 */
async function canonicalHasListings(
  supabase: SupabaseClient,
  canonicalId: number,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("products")
    .select("id")
    .eq("canonical_id", canonicalId)
    .limit(1)
    .maybeSingle();
  if (error) {
    // PGRST116 means no rows; anything else is a real problem. We
    // conservatively return false on error so we 410 rather than 301
    // into a potential 404.
    if (error.code !== "PGRST116") {
      console.error("[/product/[slug]] linked-products check failed:", error.message);
    }
    return false;
  }
  return data != null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!slug || typeof slug !== "string") {
    return goneResponse();
  }

  let decodedSlug: string;
  try {
    decodedSlug = decodeURIComponent(slug);
  } catch {
    return goneResponse();
  }

  const supabase = await createClient();

  /* ── L_exact: will /p/{decodedSlug} render? ─────────────────────────────
     /p/[slug] does its own doubled-prefix prepend, so this handler just
     needs to verify that /p/ CAN resolve `decodedSlug` AND that the
     resolved canonical_products row has at least one linked products row.
     If both pass, 301 untouched. /p/ handles the rest in one hop.

     We try the exact slug and the doubled-prefix form in one batched
     IN-query, then explicitly check linked products on whichever row
     matched. (`!inner` on the embedded `products` relation does NOT
     filter the parent row when the inner join is empty in this schema
     — see v3 note in header.) */
  {
    const idx = decodedSlug.indexOf("-");
    const doubledSlug =
      idx > 0 ? `${decodedSlug.slice(0, idx)}-${decodedSlug}` : null;
    const candidateSlugs = doubledSlug
      ? [decodedSlug, doubledSlug]
      : [decodedSlug];

    const { data, error } = await supabase
      .from("canonical_products")
      .select("id, slug")
      .in("slug", candidateSlugs)
      .limit(1)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      console.error("[/product/[slug]] L_exact query failed:", error.message);
      return goneResponse();
    }
    if (data) {
      const hasListings = await canonicalHasListings(supabase, data.id);
      if (hasListings) {
        // /p/ can resolve and render. 301 to /p/{decodedSlug} unchanged —
        // /p/ overrides to the clean (requested) slug internally.
        return redirectToProduct(request, decodedSlug);
      }
      // Orphaned canonical row — exists but no listings. /p/ would 404.
      // Fall through to L_contains (a different live row might also
      // contain this slug as a substring, with linked products).
    }
  }

  /* ── L_contains: GSC-truncated slug, unique containing live slug ────────
     Some dead slugs are leading substrings of longer live slugs (GSC
     truncated them mid-string). Substring match is exact and can't
     mismatch products; uniqueness guard prevents short-substring ambiguity.
     Tried against both the raw dead slug and its doubled-prefix form.

     We fetch up to 5 candidates without an inner-join (since !inner is
     unreliable here), then filter to those with linked products in JS.
     Only 301 if EXACTLY ONE survives the renderability filter — else
     410 to avoid guessing on ambiguous matches. */
  if (decodedSlug.length >= MIN_CONTAINS_LEN) {
    const idx = decodedSlug.indexOf("-");
    const doubledSlug =
      idx > 0 ? `${decodedSlug.slice(0, idx)}-${decodedSlug}` : null;
    const pattern = `%${decodedSlug}%`;
    const doubledPattern = doubledSlug ? `%${doubledSlug}%` : pattern;

    const { data, error } = await supabase
      .from("canonical_products")
      .select("id, slug")
      .or(`slug.like.${pattern},slug.like.${doubledPattern}`)
      .limit(5);

    if (error) {
      console.error("[/product/[slug]] L_contains query failed:", error.message);
      return goneResponse();
    }
    if (data && data.length > 0) {
      // Filter to only those with linked products. Done sequentially
      // because this path is the long tail; parallel awaits don't
      // meaningfully help when most queries return quickly and we'll
      // break on the first qualifying-but-ambiguous result anyway.
      const renderable: typeof data = [];
      for (const row of data) {
        if (await canonicalHasListings(supabase, row.id)) {
          renderable.push(row);
          if (renderable.length > 1) break; // ambiguous — stop early
        }
      }
      if (renderable.length === 1 && renderable[0]?.slug) {
        return redirectToProduct(request, renderable[0].slug);
      }
      // 0 renderable, or >1 ambiguous → fall through to 410.
    }
  }

  /* ── L_gone ──────────────────────────────────────────────────────────── */
  return goneResponse();
}

/** 301 to the canonical /p/{slug} route. */
function redirectToProduct(request: NextRequest, productSlug: string): Response {
  const dest = new URL(
    `/p/${encodeURIComponent(productSlug)}`,
    request.nextUrl.origin,
  );
  return NextResponse.redirect(dest, 301);
}

/** 410 Gone with a friendly, noindex HTML body. */
function goneResponse(): Response {
  const body = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Page removed — TrackAura</title>
  <meta name="robots" content="noindex">
  <style>
    body { font-family: system-ui, sans-serif; max-width: 540px; margin: 80px auto; padding: 0 20px; color: #e6e6e6; background: #0a0a0a; }
    h1 { font-size: 24px; margin: 0 0 16px; }
    p { line-height: 1.6; color: #999; }
    a { color: #4ade80; }
  </style>
</head>
<body>
  <h1>This page is no longer available</h1>
  <p>This product URL was part of an older catalog format and has been retired. The product may still exist under a different URL.</p>
  <p><a href="/">Browse current products</a></p>
</body>
</html>`;
  return new Response(body, {
    status: 410,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}

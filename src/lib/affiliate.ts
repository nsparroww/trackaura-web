/* ─────────────────────────────────────────────────────────────────────
   affiliate.ts

   Single source of truth for whether a retailer click is a revenue
   event (`affiliate_click`) or engagement-only (`retailer_click`).

   Today: only Newegg has an affiliate relationship. Future signups
   (Best Buy CA, Vuugo, etc.) = one-line addition to AFFILIATE_NEEDLES.

   Used by EntityListings + EntityChildren to pick the right GA4 event.
   ClickTracker.tsx then fires gtag with that event name.

   Lives outside entity-config.ts because it's about retailer commercial
   relationships, not entity-type routing. Keeping the two concerns
   separated prevents cross-contamination as more retailers and
   verticals come online.

   Match is case-insensitive substring against the retailer string as
   it appears in `listings.retailer` / `EntityListing.retailerName`.
   The casings vary ("Newegg", "Newegg Canada", "newegg-canada") so
   a strict equality check would silently miss revenue events.
   ───────────────────────────────────────────────────────────────────── */

const AFFILIATE_NEEDLES: readonly string[] = ['newegg'];

/**
 * Return true if a click on this retailer's URL should fire
 * `affiliate_click` (revenue event) instead of `retailer_click`
 * (engagement event).
 */
export function isAffiliateRetailer(retailer: string | null | undefined): boolean {
  if (!retailer) return false;
  const lc = retailer.toLowerCase();
  return AFFILIATE_NEEDLES.some((n) => lc.includes(n));
}

/** Resolve which GA4 event to fire for a given retailer click. */
export function ga4EventForRetailer(retailer: string | null | undefined): string {
  return isAffiliateRetailer(retailer) ? 'affiliate_click' : 'retailer_click';
}

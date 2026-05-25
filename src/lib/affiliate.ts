/* ─────────────────────────────────────────────────────────────────────
   affiliate.ts

   Single source of truth for:
     1. Whether a retailer click is a revenue event
        (`affiliate_click`) or engagement-only (`retailer_click`)
     2. The affiliate-tracking URL transformation per program

   Programs keyed by case-insensitive substring match against
   `listings.retailer` / `EntityListing.retailerName` (casing varies:
   "Newegg", "Newegg Canada", "newegg-canada").

   Adding a new affiliate relationship is one entry in
   AFFILIATE_PROGRAMS.
   ───────────────────────────────────────────────────────────────────── */

// Rakuten Advertising encoded publisher token (id= in deep links).
// SID 4674140 is the numeric account identifier visible in reports;
// the encoded token below is what appears in click URLs.
const RAKUTEN_PUBLISHER_ID = 'jlyoivMwGNs';

type AffiliateProgram =
  | { type: 'rakuten'; offerId: string }
  | { type: 'passthrough' };

const AFFILIATE_PROGRAMS: Record<string, AffiliateProgram> = {
  // Newegg via Rakuten Advertising (advertiser 44583).
  // offerId is the offerid= value from the dashboard's Create-a-Link tool.
  // OPEN QUESTION: this program's sample murl is newegg.com; our scraped
  // URLs are newegg.ca. Verify .ca traffic credits via Rakuten Reports
  // -> Clicks within 24-48hr of first click. If not, look for a separate
  // "Newegg Canada" advertiser in the Rakuten directory.
  newegg: {
    type: 'rakuten',
    offerId: '1786142.445838056413569066147662',
  },
};

function findProgram(
  retailer: string | null | undefined,
): AffiliateProgram | null {
  if (!retailer) return null;
  const lc = retailer.toLowerCase();
  for (const [needle, program] of Object.entries(AFFILIATE_PROGRAMS)) {
    if (lc.includes(needle)) return program;
  }
  return null;
}

function rakutenDeepLink(offerId: string, destinationUrl: string): string {
  const murl = encodeURIComponent(destinationUrl);
  return `https://click.linksynergy.com/link?id=${RAKUTEN_PUBLISHER_ID}&offerid=${offerId}&type=2&murl=${murl}`;
}

/**
 * True if this retailer fires `affiliate_click` (revenue event) instead
 * of `retailer_click` (engagement event).
 */
export function isAffiliateRetailer(
  retailer: string | null | undefined,
): boolean {
  return findProgram(retailer) !== null;
}

/** Resolve which GA4 event to fire for a given retailer click. */
export function ga4EventForRetailer(
  retailer: string | null | undefined,
): string {
  return isAffiliateRetailer(retailer) ? 'affiliate_click' : 'retailer_click';
}

/**
 * Return the affiliate-tracking URL for this retailer, or the
 * original href if no program applies.
 *
 * Deterministic — safe to call in both SSR and client render passes
 * (no hydration mismatch).
 */
export function buildAffiliateUrl(
  retailer: string | null | undefined,
  href: string,
): string {
  if (!href) return href;
  const program = findProgram(retailer);
  if (!program) return href;
  switch (program.type) {
    case 'rakuten':
      return rakutenDeepLink(program.offerId, href);
    case 'passthrough':
      return href;
  }
}

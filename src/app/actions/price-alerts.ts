'use server';
import { createClient } from '@/lib/supabase/server';
export type CreatePriceAlertInput = {
  email: string;
  productSlug: string;
  productName: string;
  targetPrice: number;
  currentPrice: number;
  retailer: string | null;
};
export type CreatePriceAlertResult =
  | { ok: true }
  | { ok: false; error: string };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export async function createPriceAlert(
  input: CreatePriceAlertInput,
): Promise<CreatePriceAlertResult> {
  // ── Validation ───────────────────────────────────────────────────────
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  if (!Number.isFinite(input.targetPrice) || input.targetPrice <= 0) {
    return { ok: false, error: 'Target price must be greater than zero.' };
  }
  if (input.targetPrice > 100_000) {
    return { ok: false, error: 'Target price looks too high.' };
  }
  if (input.currentPrice > 0 && input.targetPrice >= input.currentPrice) {
    return {
      ok: false,
      error: 'Target must be below the current price to be useful.',
    };
  }
  if (!input.productSlug || !input.productName) {
    return { ok: false, error: 'Product information missing.' };
  }
  // ── Resolve canonical_id from slug (best-effort) ─────────────────────
  // Alerts bind to canonical_id, not product_slug: slugs drift (scraper
  // output format, retailer URL churn), ids don't. We resolve here at
  // create time so the durable key is captured up front. A miss is NOT
  // fatal — the insert proceeds with canonical_id null and check_alerts.py
  // still resolves the alert via its slug fallback lane. An alert is never
  // lost over a resolution miss.
  const supabase = await createClient();
  let canonicalId: number | null = null;
  try {
    const { data: prod } = await supabase
      .from('products')
      .select('canonical_id')
      .eq('slug', input.productSlug)
      .not('canonical_id', 'is', null)
      .limit(1)
      .maybeSingle();
    if (prod && prod.canonical_id != null) {
      canonicalId = Number(prod.canonical_id);
    }
  } catch (e) {
    // Lookup failure is non-fatal; fall through with canonicalId = null.
    console.error('[price-alert] canonical_id lookup failed:', e);
  }
  // ── Insert ───────────────────────────────────────────────────────────
  const { error } = await supabase.from('price_alerts').insert({
    email,
    product_slug: input.productSlug,
    product_name: input.productName,
    target_price: input.targetPrice,
    current_price: input.currentPrice,
    retailer: input.retailer,
    canonical_id: canonicalId,
    triggered: false,
  });
  if (error) {
    console.error('[price-alert] insert failed:', error);
    // Friendly message — don't leak DB details to the client.
    return {
      ok: false,
      error: 'Could not save alert. Please try again in a moment.',
    };
  }
  return { ok: true };
}

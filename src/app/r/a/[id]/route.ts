/**
 * Price alert click-tracking redirect.
 *
 * URL shape: /r/a/{alert_id}?t={buy|history}
 *
 * Looks up the alert, logs a click row to price_alert_clicks via service-role
 * key (RLS bypassed), then 302-redirects to the appropriate destination:
 *   t=buy     -> the retailer URL stored on the alerted product (from products.json
 *                snapshot at email send time, via price_alerts.product_slug)
 *   t=history -> /product/{slug} on TrackAura
 *
 * Bot policy: shared with proxy.ts/robots.ts. Email link previewers (Slackbot,
 * iMessage, WhatsApp, etc) still redirect (so previews work) but are NOT logged
 * (to keep the funnel data clean). The bot list in bot-policy.ts is for blocking
 * scrapers; we extend it inline here with previewer UAs that shouldn't be
 * blocked but shouldn't be counted as clicks either.
 *
 * Soft-fail: any DB or lookup error still redirects the user. The user's
 * click should never break because our logging did.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isBlockedUserAgent } from '@/lib/bot-policy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FALLBACK_URL = 'https://www.trackaura.com/';

type LinkType = 'buy' | 'history';

// Email link previewers that fetch URLs to render rich cards. These hit
// /r/a/{id} from Slack messages, iMessage, WhatsApp, etc, before the real
// user does -- if we logged them we'd double-count or worse.
const PREVIEW_BOT_SUBSTRINGS = [
    'slackbot',
    'facebookexternalhit',
    'twitterbot',
    'whatsapp',
    'telegrambot',
    'discordbot',
    'linkedinbot',
    'skypeuripreview',
    'preview',
    'bot/',
    'crawler',
    'spider',
];

function isNotAHuman(ua: string): boolean {
    if (!ua) return true; // empty UA -> almost certainly automation
    if (isBlockedUserAgent(ua)) return true;
    const lower = ua.toLowerCase();
    return PREVIEW_BOT_SUBSTRINGS.some((s) => lower.includes(s));
}

function parseLinkType(raw: string | null): LinkType {
    return raw === 'history' ? 'history' : 'buy';
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id: idRaw } = await params;
    const alertId = Number.parseInt(idRaw, 10);
    if (!Number.isFinite(alertId) || alertId <= 0) {
        return NextResponse.redirect(FALLBACK_URL, 302);
    }

    const linkType = parseLinkType(req.nextUrl.searchParams.get('t'));
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
        // Misconfigured env. Fail open: send the user somewhere useful.
        return NextResponse.redirect(FALLBACK_URL, 302);
    }

    const admin = createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    // Look up the alert. We need product_slug for history links and we
    // need to confirm the alert exists before logging a click against it.
    const { data: alert, error: lookupErr } = await admin
        .from('price_alerts')
        .select('id, product_slug')
        .eq('id', alertId)
        .maybeSingle();

    if (lookupErr || !alert) {
        return NextResponse.redirect(FALLBACK_URL, 302);
    }

    // Look up the live retailer URL from canonical_products for buy clicks.
    // We do not trust query-string-supplied URLs; the alert's product_slug
    // is the only authoritative source we control.
    let destination = FALLBACK_URL;
    if (linkType === 'history') {
        destination = `https://www.trackaura.com/product/${alert.product_slug}`;
    } else {
        const { data: product } = await admin
            .from('canonical_products')
            .select('url')
            .eq('slug', alert.product_slug)
            .maybeSingle();
        destination = product?.url || `https://www.trackaura.com/product/${alert.product_slug}`;
    }

    // Log the click (best-effort; never blocks the redirect).
    const ua = req.headers.get('user-agent') || '';
    const referer = req.headers.get('referer') || null;
    if (!isNotAHuman(ua)) {
        // Fire-and-forget. We deliberately do not await this -- the redirect
        // is the user-facing latency budget; logging can race the response.
        admin
            .from('price_alert_clicks')
            .insert({
                alert_id: alertId,
                link_type: linkType,
                user_agent: ua.slice(0, 500),
                referer: referer?.slice(0, 500) || null,
            })
            .then(({ error }) => {
                if (error) {
                    console.error(`[price_alert_clicks insert] alert=${alertId} type=${linkType} err=${error.message}`);
                }
            });
    }

    return NextResponse.redirect(destination, 302);
}

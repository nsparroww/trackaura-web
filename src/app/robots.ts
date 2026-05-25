import type { MetadataRoute } from 'next';
import {
  ALLOWED_SEARCH_ENGINES,
  ALLOWED_AI_CITATION_BOTS,
} from '@/lib/bot-policy';

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trackaura.com';

/**
 * Crawler policy — single audience, narrow Disallow.
 *
 * The bible §1 names "the machine" as user moment 5 — every AI assistant,
 * agent, grounding pipeline, and LLM that needs to ground a claim about
 * a physical item. The catalog is meant to be the canonical reference,
 * machine-citable by construction. §8 line 4 (data licensing + AI
 * grounding) is the asymmetric upside line built on this access.
 *
 * Therefore: every crawler that respects robots.txt is welcome on the
 * catalog. Named bots (search engines + AI citation crawlers, listed in
 * bot-policy.ts) are listed explicitly mainly for documentation and so
 * that allow-list audits are legible; their effective rules are
 * identical to the wildcard.
 *
 * Defense against bad actors that ignore robots.txt is proxy.ts's job
 * (BLOCKED_BOTS in bot-policy.ts — CCBot, Bytespider, AhrefsBot,
 * Semrush, etc. get 403'd at the edge regardless of what this file
 * says).
 *
 * Historical note: prior to 2026-05-25 this file emitted a wildcard
 * Disallow of /p/, /c/, /category/, /products, /search — framed as
 * "the catalog is the moat." That framing predates the canonical-
 * reference pivot in bible §1 and contradicts current vision. Removed
 * session 25. The bible §11 LLM-citation work was undermined by it for
 * months — symmetric failure mode to the 2026-04-26 proxy.ts allow/
 * block mismatch.
 *
 * Single source of truth — public/robots.txt is deleted; this file
 * generates /robots.txt at request time via Next.js App Router.
 */

// Internal routes never crawled by anyone.
const INTERNAL_DISALLOW = ['/api/', '/_next/', '/admin/'];

export default function robots(): MetadataRoute.Robots {
  const namedAudiences = [
    ...ALLOWED_SEARCH_ENGINES,
    ...ALLOWED_AI_CITATION_BOTS,
  ];

  return {
    rules: [
      // Named allow-listed bots — same rules as wildcard, listed
      // explicitly for documentation and audit legibility.
      ...namedAudiences.map((userAgent) => ({
        userAgent,
        allow: '/',
        disallow: INTERNAL_DISALLOW,
      })),
      // Everyone else — same access, narrow Disallow.
      {
        userAgent: '*',
        allow: '/',
        disallow: INTERNAL_DISALLOW,
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}

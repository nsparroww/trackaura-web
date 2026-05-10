import { createServerClient, createBrowserClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Auth-context Supabase client for Server Components and Route Handlers
 * that need user identity (admin routes, RLS-scoped reads, mutations).
 *
 * IMPORTANT: This client calls `cookies()` from `next/headers`, which
 * Next.js classifies as a Dynamic Function. Any route that calls this
 * is forced into dynamic rendering — `export const revalidate = N` is
 * IGNORED on those routes.
 *
 * For public catalog reads (no auth needed), use createCatalogClient()
 * below — it returns a client with no cookie dependency, which keeps
 * the calling route eligible for ISR.
 *
 * History: prior to 2026-05-09, this was the only Supabase server
 * client. /p/[slug] declared `revalidate = 300` but every render still
 * hit the database because cookies() forced dynamic rendering. The
 * resulting load saturated Supabase Nano-tier connections during the
 * AI-bot crawl wave that day. Catalog routes split off to
 * createCatalogClient() to reclaim ISR eligibility.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component without middleware — safe to ignore.
          }
        },
      },
    },
  );
}

/**
 * Cookie-free Supabase client for public catalog reads. Use this for
 * any read against canonical_products, canonical_entities, products,
 * price_points, entity_attributes, etc. that doesn't require user
 * identity or RLS-scoped filtering.
 *
 * Reads through the anon key. RLS policies still apply — the difference
 * is the absence of auth-cookie propagation, which keeps Next.js
 * classifying the calling route as cacheable.
 *
 * Do NOT use this for:
 *   - /admin/* routes (need service role or auth context)
 *   - price_alerts mutations (RLS scopes by auth.uid())
 *   - any route where the user identity matters
 *
 * Use createClient() for those.
 */
export function createCatalogClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

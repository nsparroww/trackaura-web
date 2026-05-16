import { createClient } from '@/lib/supabase/server';
import { cleanEntitySlug } from './entity-slug-helpers';
import { getEntityTypeConfig, type EntityType } from './entity-config';

/* -------------------------------------------------------------------------
   entity-slug.ts

   Generic entity-slug resolution. Mirrors the chip-slug.ts pattern but
   is parameterized over entity_type. Algorithm:

     1. Try the slug exactly as requested.
     1.5. Short-slug alias check (Phase-0.5 polish, 2026-05-04).
          For high-traffic short queries that don't map 1:1 to DB slugs
          (e.g. 'rtx-3060' -> 'rtx-3060-12-gb'), the entity_type config
          declares an alias map. Hit -> recursively resolve the target
          and return needsRedirect=true so the route handler 308s to
          the canonical clean form.
     1.7. Slug rewrites (CPU page coverage probe, 2026-05-11).
          For marketing-form to canonical-form equivalences that don't
          fit prefix-prepend semantics (e.g. 'intel-core-i7-8700k' on
          input, DB stores 'intel-i7-8700k'), each regex rewrite is tried
          in order. First rewrite whose substituted slug hits a DB row
          returns with needsRedirect=true and finalClean computed via
          cleanSlugBrandPrefixes -- this collapses what would otherwise
          be a two-hop redirect chain (rewrite-then-strip) into one hop.
     2. If the entity_type has registered brand prefixes, try each
        prefix prepended in a single batched query.
     3. Flag whether a redirect to the clean form is needed.

   Prefix lists by entity_type (source of truth: entity-config.ts +
   chip-slug-helpers.ts):

     - 'gpus' (boards): empty. URL = DB slug.
     - 'gpu_chip': [nvidia-geforce-, amd-radeon-, intel-arc-, nvidia-,
       amd-, intel-]. Longer (line-qualified) prefixes precede bare
       brand prefixes due to first-match semantics in cleanEntitySlug
       -- /chip/rtx-5090 stays canonical for nvidia-geforce-rtx-5090
       while /chip/jetson-agx-xavier-16-gb resolves to the bare
       nvidia- DB row (2026-05-13 amendment, Jetson/Tesla/Quadro/
       Workstation 404 fix).
     - 'cpu' and 'cpu_microarch': [intel-, amd-]. CPU slugs also pass
       through slugRewrites for 'core-i*' and 'core-ultra-N-*' marketing
       forms.
     - 'gpus' (boards) and other leaf-only types: see entity-config.

   Bare-slug collision handling (Phase-0.5 polish, 2026-05-14):
     The step-3 brand-prefix fallback previously used `.limit(1)`. When
     two prefixed candidates both exist as real DB rows -- e.g. bare
     '610m' expands to both 'nvidia-geforce-610m' and 'amd-radeon-610m'
     -- `.limit(1)` returned whichever row Postgres yielded first, a
     coin flip that silently served one arbitrary chip on /chip/610m.
     Recon (2026-05-14) found 4 such collisions in gpu_chip: 610m,
     m2000, m4000, m6000 -- each an AMD part vs an NVIDIA part cleaning
     to an identical bare slug, all 8 chips content-empty (0 boards,
     0 listings).
     Fix: fetch ALL prefix matches (no limit) and branch on count.
       1 match  -> resolve as before.
       0 matches -> genuine miss.
       2+ matches -> AMBIGUOUS: return a miss so the route 404s cleanly
                     rather than coin-flipping. The full prefixed slugs
                     ('/chip/nvidia-geforce-610m', '/chip/amd-radeon-610m')
                     still resolve via step-1 exact-match, so both chips
                     stay reachable; only the ambiguous bare URL is
                     refused. Systemic -- no per-collision alias entries,
                     and a 5th collision is handled with zero new code.

   This module imports next/headers via the Supabase server client. Do
   NOT import it from client components. Client components should reach
   for entity-slug-helpers.ts directly.
   ------------------------------------------------------------------------- */

export type EntitySlugResolution = {
  /** Stringified bigint id of the canonical_entities row, or null. */
  entityId: string | null;
  /** The slug in clean form (brand prefixes stripped if applicable). */
  cleanSlug: string;
  /** True when the requested slug was brand-prefixed AND a clean form exists. */
  needsRedirect: boolean;
};

export async function resolveEntitySlug(
  requestedSlug: string,
  entityType: EntityType,
): Promise<EntitySlugResolution> {
  const cfg = getEntityTypeConfig(entityType);
  const prefixes = cfg.cleanSlugBrandPrefixes;
  const supabase = await createClient();

  /* 1. Exact match. */
  const { data: exact, error: exactErr } = await supabase
    .from('canonical_entities')
    .select('id, slug')
    .eq('slug', requestedSlug)
    .eq('entity_type', entityType)
    .maybeSingle();

  if (exactErr) {
    console.error(
      `[entity-slug] exact-match query failed (type=${entityType}):`,
      exactErr,
    );
    return { entityId: null, cleanSlug: requestedSlug, needsRedirect: false };
  }

  if (exact) {
    const cleaned = cleanEntitySlug(requestedSlug, prefixes);
    return {
      entityId: String(exact.id),
      cleanSlug: cleaned,
      needsRedirect: cleaned !== requestedSlug,
    };
  }

  /* 1.5. Short-slug alias -> resolve target and force redirect.
     Recursion is bounded: alias targets must themselves resolve via
     exact-match, slug-rewrite, or brand-prefix fallback (validated at
     config time by manual review; if a typo creeps in, the inner
     resolveEntitySlug returns null and we log + fall through). */
  const aliasTarget = cfg.shortSlugAliases?.[requestedSlug];
  if (aliasTarget) {
    const resolved = await resolveEntitySlug(aliasTarget, entityType);
    if (resolved.entityId != null) {
      return {
        entityId: resolved.entityId,
        cleanSlug: aliasTarget,
        needsRedirect: true,
      };
    }
    console.error(
      `[entity-slug] short-slug alias '${requestedSlug}' -> '${aliasTarget}' has no entity (type=${entityType})`,
    );
  }

  /* 1.7. Slug rewrites -- marketing-form to canonical-form equivalences
     that don't fit prefix-prepend (e.g. CPUs: user types 'intel-core-i7-8700k',
     DB stores 'intel-i7-8700k'). Each rewrite is tried in order; first
     rewritten slug that hits a DB row wins. finalClean is computed against
     cleanSlugBrandPrefixes so the redirect chain is single-hop. */
  const rewrites = cfg.slugRewrites;
  if (rewrites && rewrites.length > 0) {
    for (const { pattern, replacement } of rewrites) {
      if (!pattern.test(requestedSlug)) continue;
      const rewritten = requestedSlug.replace(pattern, replacement);
      if (rewritten === requestedSlug) continue;

      const { data: rewriteHit, error: rewriteErr } = await supabase
        .from('canonical_entities')
        .select('id, slug')
        .eq('slug', rewritten)
        .eq('entity_type', entityType)
        .maybeSingle();

      if (rewriteErr) {
        console.error(
          `[entity-slug] rewrite query failed (type=${entityType}, pattern=${pattern}):`,
          rewriteErr,
        );
        continue;
      }

      if (rewriteHit) {
        const finalClean = cleanEntitySlug(rewritten, prefixes);
        return {
          entityId: String(rewriteHit.id),
          cleanSlug: finalClean,
          needsRedirect: true,
        };
      }
    }
  }

  /* 2. No prefixes registered -> genuine miss. */
  if (prefixes.length === 0) {
    return { entityId: null, cleanSlug: requestedSlug, needsRedirect: false };
  }

  /* 3. Brand-prefix fallback in a single batched query.
     Fetch ALL matches (no .limit) so a bare-slug collision -- two
     prefixed candidates both existing as real rows -- can be detected
     and refused rather than coin-flipped. See the bare-slug collision
     note in the module header. */
  const candidates = prefixes.map((p) => `${p}${requestedSlug}`);
  const { data: prefixed, error: prefixedErr } = await supabase
    .from('canonical_entities')
    .select('id, slug')
    .in('slug', candidates)
    .eq('entity_type', entityType);

  if (prefixedErr) {
    console.error(
      `[entity-slug] prefix-fallback query failed (type=${entityType}):`,
      prefixedErr,
    );
    return { entityId: null, cleanSlug: requestedSlug, needsRedirect: false };
  }

  if (prefixed && prefixed.length > 1) {
    /* Ambiguous bare slug: multiple real rows share this cleaned form.
       Refuse resolution so the route 404s; the full prefixed slugs
       still resolve via step-1 exact-match. */
    console.warn(
      `[entity-slug] ambiguous bare slug '${requestedSlug}' (type=${entityType}) ` +
        `matched ${prefixed.length} rows: ${prefixed.map((r) => r.slug).join(', ')} -- refusing`,
    );
    return { entityId: null, cleanSlug: requestedSlug, needsRedirect: false };
  }

  if (prefixed && prefixed.length === 1) {
    return {
      entityId: String(prefixed[0].id),
      cleanSlug: requestedSlug,
      needsRedirect: false,
    };
  }

  /* Genuine miss. */
  return { entityId: null, cleanSlug: requestedSlug, needsRedirect: false };
}

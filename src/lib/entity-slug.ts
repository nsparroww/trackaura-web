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

   For boards (entity_type='gpus') and microarchs the prefix list is
   empty and the resolver short-circuits after step 1 -- URL = DB slug.
   For chips (entity_type='gpu_chip') the prefix list is
   [nvidia-geforce-, amd-radeon-, intel-arc-] preserving today's
   /chip/rtx-5090 -> DB row 'nvidia-geforce-rtx-5090' behaviour.
   For CPUs (entity_type='cpu') the prefix list is [intel-, amd-] and
   slugRewrites carry the 'core-i*' marketing-form equivalences; combined
   they map natural search queries (/cpu/i7-8700k, /cpu/intel-core-i7-8700k,
   /cpu/ryzen-7-7800x3d) to canonical clean URLs (/cpu/i7-8700k,
   /cpu/ryzen-7-7800x3d).

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

  /* 3. Brand-prefix fallback in a single batched query. */
  const candidates = prefixes.map((p) => `${p}${requestedSlug}`);
  const { data: prefixed, error: prefixedErr } = await supabase
    .from('canonical_entities')
    .select('id, slug')
    .in('slug', candidates)
    .eq('entity_type', entityType)
    .limit(1);

  if (prefixedErr) {
    console.error(
      `[entity-slug] prefix-fallback query failed (type=${entityType}):`,
      prefixedErr,
    );
    return { entityId: null, cleanSlug: requestedSlug, needsRedirect: false };
  }

  if (prefixed && prefixed.length > 0) {
    return {
      entityId: String(prefixed[0].id),
      cleanSlug: requestedSlug,
      needsRedirect: false,
    };
  }

  /* Genuine miss. */
  return { entityId: null, cleanSlug: requestedSlug, needsRedirect: false };
}

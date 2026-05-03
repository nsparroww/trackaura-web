import { createClient } from '@/lib/supabase/server';
import { cleanEntitySlug } from './entity-slug-helpers';
import { getEntityTypeConfig, type EntityType } from './entity-config';

/* ─────────────────────────────────────────────────────────────────────
   entity-slug.ts

   Generic entity-slug resolution. Mirrors the chip-slug.ts pattern but
   is parameterized over entity_type. Same algorithm:

     1. Try the slug exactly as requested.
     2. If the entity_type has registered brand prefixes, try each
        prefix prepended in a single batched query.
     3. Flag whether a redirect to the clean form is needed.

   For boards (entity_type='gpus'), CPUs, monitors etc. the prefix list
   is empty and the resolver short-circuits after step 1 — URL = DB slug.
   For chips (entity_type='gpu_chip') the prefix list is
   [nvidia-geforce-, amd-radeon-, intel-arc-] preserving today's
   /chip/rtx-5090 → DB row 'nvidia-geforce-rtx-5090' behaviour.

   This module imports next/headers via the Supabase server client. Do
   NOT import it from client components. Client components should reach
   for entity-slug-helpers.ts directly.
   ───────────────────────────────────────────────────────────────────── */

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

  /* 2. No prefixes registered → genuine miss. */
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

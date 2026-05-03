/* ─────────────────────────────────────────────────────────────────────
   entity-slug-helpers.ts

   Pure helpers for entity slug brand-prefix handling. No server deps;
   safe to import from client components.

   The chip-side equivalent (chip-slug-helpers.ts) stays in place and is
   re-exported via entity-config.ts. This module is the generic API that
   future entity types can use.
   ───────────────────────────────────────────────────────────────────── */

/**
 * Strip the first matching brand prefix from a slug.
 *
 *   cleanEntitySlug('nvidia-geforce-rtx-5090', ['nvidia-geforce-', 'amd-radeon-'])
 *     → 'rtx-5090'
 *   cleanEntitySlug('asus-tuf-rtx-5090-oc', [])
 *     → 'asus-tuf-rtx-5090-oc'  (no change; empty prefix list)
 *   cleanEntitySlug('rx-9070-xt', ['nvidia-geforce-', 'amd-radeon-'])
 *     → 'rx-9070-xt'  (no match)
 *
 * Returns the slug as-is when no prefix matches or the prefix list is empty.
 * Used for clean-URL emission, redirect detection, and cross-page links.
 */
export function cleanEntitySlug(
  slug: string,
  prefixes: readonly string[],
): string {
  for (const p of prefixes) {
    if (slug.startsWith(p)) return slug.slice(p.length);
  }
  return slug;
}

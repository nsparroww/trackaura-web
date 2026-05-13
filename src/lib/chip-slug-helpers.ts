/* ────────────────────────────────────────────────────────────────────────
   Pure helpers for chip slug brand-prefix handling.

   Split from chip-slug.ts because that module imports the Supabase
   server client (which uses `next/headers` and is server-only). When a
   client component imports from chip-slug.ts, the bundler pulls the
   entire module's imports into the client bundle — including
   `next/headers` — and the build fails.

   Anything in this file is import-safe in both server and client code.
   The brand-prefix list lives here as the single source of truth;
   chip-slug.ts re-exports `cleanChipSlug` for backwards compatibility
   with server-side callers.

   Imports:
     server-side resolver (chip-slug.ts) → here
     client component   (ChipParentSection.tsx) → here, directly
     server query       (queries/chip.ts) → chip-slug.ts (re-export)

   2026-05-13 amendment (Jetson / Tesla / Quadro / Workstation 404 fix):
     Extended BRAND_PREFIXES with bare 'nvidia-', 'amd-', 'intel-' to
     cover data-center, embedded, and workstation chips — Jetson family,
     Tesla V100 / A100 / H100, Quadro, RTX A-series workstation,
     AMD FirePro / Instinct, Intel Data Center GPU. Recon showed
     552 / 1621 gpu_chip rows (34%) were unreachable via clean URL —
     only the GeForce / Radeon / Arc consumer lines were addressable.

     First-match semantics make ordering load-bearing: longer prefixes
     ('nvidia-geforce-') MUST precede their bare counterparts
     ('nvidia-') so /chip/rtx-5090 stays the canonical form for
     nvidia-geforce-rtx-5090. Inserting bare prefixes mid-list would
     short-circuit 'nvidia-geforce-' and produce '/chip/geforce-rtx-5090'.

     Known collision pre-existing this change:
       'nvidia-geforce-610m' and 'amd-radeon-610m' both clean to '610m'.
       Filed to ROADMAP Tail; resolution will be shortSlugAliases on
       one of the two pair members or a disambiguation page.
   ──────────────────────────────────────────────────────────────────────── */

export const BRAND_PREFIXES = [
  // Longer (line-qualified) prefixes first — first-match wins.
  'nvidia-geforce-',
  'amd-radeon-',
  'intel-arc-',
  // Bare brand prefixes — catch data-center, embedded, workstation,
  // and pro-line chips that don't carry a consumer-line segment.
  'nvidia-',
  'amd-',
  'intel-',
] as const;

/**
 * Strip a known GPU brand prefix from a chip slug.
 *
 *   nvidia-geforce-rtx-5090       → rtx-5090
 *   nvidia-jetson-agx-xavier-16-gb → jetson-agx-xavier-16-gb
 *   amd-firepro-2270              → firepro-2270
 *   rx-9070-xt                    → rx-9070-xt  (no change)
 *
 * Returns the slug as-is when no prefix matches. Used for public URL
 * emission, brand-prefix redirect detection, and cross-page links from
 * the product page to the chip hub.
 */
export function cleanChipSlug(slug: string): string {
  for (const prefix of BRAND_PREFIXES) {
    if (slug.startsWith(prefix)) return slug.slice(prefix.length);
  }
  return slug;
}

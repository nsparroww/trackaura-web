import type { CoverageTier } from '@/lib/queries/entity';

/* ---------------------------------------------------------------------
   coverage-tier.ts

   Display layer for honest-labeling per Architecture Bible Sec 9.
   Single source of truth for tier -> user-facing copy + color. Used by:
     - EntityListings.tsx  (leaf header bar)
     - EntityChildren.tsx  (per-row badge in chip's children grid)
     - EntityPage.tsx      (stats tile copy + amber-callout copy)

   Future copy/color changes land here only. The data layer in
   queries/entity.ts owns the classification; this file owns presentation.
   --------------------------------------------------------------------- */

export type CoverageTierTone = 'emerald' | 'amber' | 'zinc';

export type CoverageTierDisplay = {
  /** Compact label for tight spaces (children-grid badges). 1-3 words. */
  shortLabel: string;
  /** Longer label for leaf-page header bars - includes count framing. */
  fullLabel: string;
  /** Visual tone:
        emerald = positive trust signal (multi-retailer comparison sound)
        amber   = caution (single-source, no comparison being made)
        zinc    = neutral (no current retail, reference-only). */
  tone: CoverageTierTone;
  /** True when the page can honestly use "Lowest current" framing (>=2
      retailers being compared). single_source/historical/encyclopedic_only
      drop the comparison framing - there's nothing to compare. */
  allowsComparisonFraming: boolean;
};

export function getCoverageTierDisplay(
  tier: CoverageTier,
): CoverageTierDisplay {
  switch (tier) {
    case 'well_tracked':
      return {
        shortLabel: 'Well tracked',
        fullLabel: 'Well tracked  -  3+ retailers',
        tone: 'emerald',
        allowsComparisonFraming: true,
      };
    case 'tracked':
      return {
        shortLabel: 'Tracked',
        fullLabel: 'Tracked  -  2 retailers',
        tone: 'emerald',
        allowsComparisonFraming: true,
      };
    case 'single_source':
      return {
        shortLabel: 'Single source',
        fullLabel: 'Single source  -  1 retailer',
        tone: 'amber',
        allowsComparisonFraming: false,
      };
    case 'historical':
      return {
        shortLabel: 'No current retail',
        fullLabel: 'No current retail availability',
        tone: 'zinc',
        allowsComparisonFraming: false,
      };
    case 'encyclopedic_only':
      return {
        shortLabel: 'Reference only',
        fullLabel: 'Reference only  -  no retail data',
        tone: 'zinc',
        allowsComparisonFraming: false,
      };
  }
}

/** Tailwind background + text classes for a tier badge. Keeping these
    co-located with the tone enum so adding a new tone (e.g. red for a
    "withdrawn" state Phase 2+) is a single-file change. */
export function tierBadgeClasses(tone: CoverageTierTone): string {
  switch (tone) {
    case 'emerald':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
    case 'amber':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
    case 'zinc':
      return 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300';
  }
}

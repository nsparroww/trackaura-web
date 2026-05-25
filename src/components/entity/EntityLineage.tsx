import Image from 'next/image';
import Link from 'next/link';
import type { LineageItem } from '@/lib/queries/entity';

/* ---------------------------------------------------------------------
   EntityLineage

   Lineage section: predecessor + successor row, optionally followed by
   a Variants subsection. Renders only when at least one is non-empty;
   the component is responsible for its own visibility (caller doesn't
   gate).

   Layout:
     - Pred/succ row: two-up grid on sm+, stacked on mobile. Each
       card carries the existing direction arrow + label + name + year.
       Whichever side is null shows an empty placeholder so the grid
       does not collapse asymmetrically.
     - Variants subsection: rendered below pred/succ when variants[]
       is non-empty. Smaller cards (h-12 image), 3-col grid on lg+,
       2-col on sm. No directional arrow - variants are horizontal,
       not chronological.

   Design constraints (Bible Sec 1 + Sec 9):
     - Lineage is chronological/sibling context, not a comparison. No
       price, no stat tiles, no "vs" framing. Each card just answers
       "what came before/after" or "what other configurations exist".
     - Honest-labeling: pred/succ explicitly say "First in chain" /
       "Latest in chain" on the null side rather than hiding the
       column. Variants section is fully omitted when empty - the
       count in the header would be (0), and a "no siblings" empty
       state would be noise.

   2026-05-25 (session 29):
     - Variants subsection added. Session 28 ingest shipped 566
       variant_of edges across 92 CPU groups; this surfaces them.
       fetchLineage in queries/entity.ts now resolves variant_of
       targets through the same canonical_entities batch fetch as
       pred/succ. Sorted alphabetically.

   2026-05-13: v0 ships NVIDIA GeForce desktop only for pred/succ;
   variants are populated for CPU groups from session 28.
   --------------------------------------------------------------------- */

type Props = {
  predecessor: LineageItem | null;
  successor: LineageItem | null;
  variants: LineageItem[];
};

const MONTH_ABBREV = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/* Extract just the year. Date-only ISO ('2025-01-30') uses regex
   direct parse to avoid the UTC-midnight timezone shift bug fixed
   in EntityPage.formatDate. Full ISO timestamps fall back to Date. */
function formatYear(iso: string | null): string | null {
  if (!iso) return null;
  const dateOnly = iso.match(/^(\d{4})-/);
  if (dateOnly) return dateOnly[1];
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return String(d.getFullYear());
}

function formatReleaseDate(iso: string | null): string | null {
  if (!iso) return null;
  const dateOnly = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, year, mm] = dateOnly;
    const monthIdx = parseInt(mm, 10) - 1;
    if (monthIdx < 0 || monthIdx > 11) return year;
    return `${MONTH_ABBREV[monthIdx]} ${year}`;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short' });
}

export default function EntityLineage({ predecessor, successor, variants }: Props) {
  if (!predecessor && !successor && variants.length === 0) return null;

  const showLineageRow = predecessor != null || successor != null;
  const showVariants = variants.length > 0;

  return (
    <section className="mb-8">
      <h2 className="mb-4 text-lg font-semibold">Lineage</h2>

      {showLineageRow && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <LineageCard
            direction="predecessor"
            item={predecessor}
            emptyLabel="First in chain"
          />
          <LineageCard
            direction="successor"
            item={successor}
            emptyLabel="Latest in chain"
          />
        </div>
      )}

      {showVariants && (
        <div className={showLineageRow ? 'mt-6' : undefined}>
          <h3 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            {`Variants (${variants.length})`}
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {variants.map((v) => (
              <VariantCard key={v.id} item={v} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function LineageCard({
  direction,
  item,
  emptyLabel,
}: {
  direction: 'predecessor' | 'successor';
  item: LineageItem | null;
  emptyLabel: string;
}) {
  const arrow = direction === 'predecessor' ? '←' : '→';
  const label = direction === 'predecessor' ? 'Predecessor' : 'Successor';

  if (!item) {
    return (
      <div className="flex items-center gap-3 rounded border border-dashed border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600">
          <span aria-hidden="true" className="text-2xl">{arrow}</span>
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-zinc-500">
            {label}
          </div>
          <div className="mt-0.5 text-sm text-zinc-500">{emptyLabel}</div>
        </div>
      </div>
    );
  }

  const year = formatYear(item.releaseDate);
  const dateLabel = formatReleaseDate(item.releaseDate);
  const href = `${item.routePrefix}/${item.cleanSlug}`;

  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded border border-zinc-200 bg-white p-3 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/60"
    >
      <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            sizes="4rem"
            className="object-contain p-1"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-zinc-300 dark:text-zinc-700">
            <span aria-hidden="true" className="text-2xl">{arrow}</span>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-wide text-zinc-500">
          {arrow} {label}
        </div>
        <div className="mt-0.5 truncate text-sm font-medium text-zinc-900 group-hover:text-zinc-700 dark:text-zinc-100 dark:group-hover:text-zinc-300">
          {item.name}
        </div>
        {(year || dateLabel) && (
          <div className="mt-0.5 text-xs text-zinc-500" title={dateLabel ?? undefined}>
            {year}
          </div>
        )}
      </div>
    </Link>
  );
}

function VariantCard({ item }: { item: LineageItem }) {
  const year = formatYear(item.releaseDate);
  const href = `${item.routePrefix}/${item.cleanSlug}`;

  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded border border-zinc-200 bg-white p-2.5 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/60"
    >
      <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            sizes="3rem"
            className="object-contain p-1"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-zinc-300 dark:text-zinc-700">
            <span aria-hidden="true" className="text-base">·</span>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-zinc-900 group-hover:text-zinc-700 dark:text-zinc-100 dark:group-hover:text-zinc-300">
          {item.name}
        </div>
        {year && (
          <div className="mt-0.5 text-xs text-zinc-500">{year}</div>
        )}
      </div>
    </Link>
  );
}

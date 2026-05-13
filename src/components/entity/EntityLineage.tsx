import Image from 'next/image';
import Link from 'next/link';
import type { LineageItem } from '@/lib/queries/entity';

/* ---------------------------------------------------------------------
   EntityLineage

   Predecessor and successor navigation cards. Renders only when at
   least one of {predecessor, successor} is non-null; the component is
   responsible for its own visibility (caller doesn't gate).

   Layout:
     - Two-up grid on sm+ screens, stacked on mobile.
     - Each card: small product image, "Predecessor" / "Successor"
       label, name, release year.
     - Whichever side is null renders an empty placeholder card so the
       grid doesn't collapse asymmetrically. Empty card has subdued
       copy ("None on record" / "Latest in chain") with no link.

   Design constraints (Bible §1 + §9):
     - Lineage is chronological context, not a comparison. No price,
       no stat tiles, no "vs" framing. The card just answers "what
       came before / after this one".
     - Honest-labeling: when a side is null we explicitly say so
       rather than hiding the column. A user who lands on RTX 5090
       and sees "Latest in chain" learns there's no successor yet;
       hiding the column would leave them guessing whether we
       just don't have the data.

   2026-05-13: v0 ships NVIDIA GeForce desktop only. Most entity
   pages today will see this component render with at most one side
   populated (chain head or tail) or not render at all (out-of-scope
   chips: AMD Radeon, Intel Arc, Tesla / Quadro / Jetson, etc.).
   --------------------------------------------------------------------- */

type Props = {
  predecessor: LineageItem | null;
  successor: LineageItem | null;
};

const MONTH_ABBREV = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/* Extract just the year for the card side-context. Date-only ISO
   ('2025-01-30') uses regex direct parse to avoid the UTC-midnight
   timezone shift bug fixed in EntityPage.formatDate. Full ISO
   timestamps fall back to Date. */
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

export default function EntityLineage({ predecessor, successor }: Props) {
  if (!predecessor && !successor) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-4 text-lg font-semibold">Lineage</h2>
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

import type { EntityListing } from '@/lib/queries/entity';

type Props = { listings: EntityListing[] };

/* ─────────────────────────────────────────────────────────────────────
   EntityListings

   Leaf render layer. One row per active listing for this entity:
     retailer | freshness chip | price | external View link

   Used by /board/[slug] today; /cpu/[slug] in Step 4 if CPUs are
   modeled as leaves. (CPUs may end up as branches under a chip-family
   pattern — that's a Step-4 decision.)

   No GA4 outbound_click yet. ChipPage's BoardTable presumably wires it;
   re-introducing it here means a 'use client' OutboundLink shim, which
   is structurally cleaner than threading client components through
   server-component lists. Deferred to the cutover so existing chip-page
   click telemetry isn't disrupted by Step-2 changes. (Tracked as
   Bible §10 tail.)
   ───────────────────────────────────────────────────────────────────── */

function formatPrice(n: number, currency: string = 'CAD'): string {
  return `${currency} $${n.toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return 'never';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function EntityListings({ listings }: Props) {
  return (
    <div className="overflow-hidden rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {listings.map((l) => {
          const freshnessLabel = l.currentPrice != null
            ? l.lastObservedAt
              ? `seen ${formatRelative(l.lastObservedAt)}`
              : 'current'
            : `last seen ${formatRelative(l.lastSeen)}`;

          return (
            <li
              key={l.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {l.retailerName}
                </span>
                {l.isOpenBox && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    Open box
                  </span>
                )}
                <span className="text-xs text-zinc-500">{freshnessLabel}</span>
              </div>

              <div className="flex items-baseline gap-4">
                {l.currentPrice != null ? (
                  <span className="text-base font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {formatPrice(l.currentPrice, l.currency)}
                  </span>
                ) : (
                  <span className="text-sm text-zinc-500">no current price</span>
                )}
                {l.url && (
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                  >
                    View →
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

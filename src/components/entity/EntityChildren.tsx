import Link from 'next/link';
import ClickTracker from '@/components/ClickTracker';
import { ga4EventForRetailer } from '@/lib/affiliate';
import type { EntityChild } from '@/lib/queries/entity';

type Props = {
  items: EntityChild[];
  entityCategory: string;
};

/* ─────────────────────────────────────────────────────────────────────
   EntityChildren

   Branch render layer. Each child gets a card with:
     - Header: name (link to child page) + lowest current price + retailer count
     - Inline listings list (up to 6) — retailer · price · external View link
     - "+ N more" link to the child page when truncated

   NOT exercised by /board/[slug] (a leaf route). Lives here so Step 3
   chip-page cutover swaps `<BoardTable boards={...} />` for
   `<EntityChildren items={...} />` without writing new code at cutover
   time. If BoardTable's exact visual is preferred, port its internals
   into this file at Step 3 instead — the contract (props shape) stays
   the same.

   Truncation depth (6) is a load-time guess. Most chips have 1-12
   boards; chips with 30+ boards (rare AIB-heavy SKUs) push the page
   too long without truncation.

   Step-3 (2026-05-04): each row's outbound View link now goes through
   <ClickTracker> for GA4. The label is the *child* entity name (each
   row represents a different board), not the parent chip — that's
   what answers "which board did the user click through on" in the
   GA4 report. Category threads through unchanged because all children
   under a parent share the parent's category.
   ───────────────────────────────────────────────────────────────────── */

const VISIBLE_LISTINGS = 6;

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

export default function EntityChildren({ items, entityCategory }: Props) {
  return (
    <div className="space-y-3">
      {items.map((child) => {
        const href = `${child.routePrefix}/${child.cleanSlug}`;
        const visible = child.listings.slice(0, VISIBLE_LISTINGS);
        const overflow = Math.max(0, child.listings.length - visible.length);

        return (
          <article
            key={child.id}
            className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <Link
                href={href}
                className="text-base font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
              >
                {child.name}
              </Link>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
                {child.lowestPrice != null ? (
                  <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {formatPrice(
                      child.lowestPrice,
                      child.lowestPriceCurrency ?? 'CAD',
                    )}
                  </span>
                ) : (
                  <span className="text-zinc-500">no current price</span>
                )}
                <span className="text-xs text-zinc-500">
                  {child.retailerCount > 0
                    ? `${child.retailerCount} retailer${child.retailerCount === 1 ? '' : 's'}`
                    : `${child.listings.length} listing${child.listings.length === 1 ? '' : 's'} (stale)`}
                </span>
              </div>
            </header>

            {child.listings.length > 0 ? (
              <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                {visible.map((l) => (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1.5"
                  >
                    <span className="text-zinc-600 dark:text-zinc-400">
                      {l.retailerName}
                      {l.isOpenBox && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                          Open box
                        </span>
                      )}
                    </span>
                    <span className="flex items-baseline gap-3">
                      {l.currentPrice != null ? (
                        <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
                          {formatPrice(l.currentPrice, l.currency)}
                        </span>
                      ) : (
                        <span className="text-zinc-500">
                          last seen {formatRelative(l.lastSeen)}
                        </span>
                      )}
                      {l.url && (
                        <ClickTracker
                          href={l.url}
                          event={ga4EventForRetailer(l.retailerName)}
                          label={child.name}
                          retailer={l.retailerName}
                          category={entityCategory}
                          price={l.currentPrice ?? 0}
                          className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                        >
                          View →
                        </ClickTracker>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">No active listings.</p>
            )}

            {overflow > 0 && (
              <p className="mt-2 text-right">
                <Link
                  href={href}
                  className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  + {overflow} more →
                </Link>
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}

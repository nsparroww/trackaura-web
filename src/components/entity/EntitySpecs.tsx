import type { EntityAttribute } from '@/lib/queries/entity-attributes';

type Props = { attributes: EntityAttribute[] };

/* ─────────────────────────────────────────────────────────────────────
   EntitySpecs

   Renders specs as grouped sections per the GROUP_ORDER convention in
   chip-attributes.ts (Chip → Performance → Memory → Power →
   Manufacturing for GPU verticals; future verticals add their own
   group order via the same ATTRIBUTE_CONFIG).

   Visual language matches the existing Stat tiles in ChipPage.tsx —
   same border / dark-mode / text-weight rules. Empty input → renders
   nothing (parent decides whether to show a heading).
   ───────────────────────────────────────────────────────────────────── */

export default function EntitySpecs({ attributes }: Props) {
  if (attributes.length === 0) return null;

  // Group preserving the order they arrive in (formatAttributes already
  // sorted by GROUP_ORDER, then alphabetical within group).
  const groups = new Map<string, EntityAttribute[]>();
  for (const attr of attributes) {
    if (!groups.has(attr.group)) groups.set(attr.group, []);
    groups.get(attr.group)!.push(attr);
  }

  return (
    <section className="mb-8">
      <h2 className="mb-4 text-lg font-semibold">Specifications</h2>
      <div className="rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <dl className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {[...groups.entries()].map(([group, items]) => (
            <div key={group} className="px-4 py-3 sm:px-5 sm:py-4">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {group}
              </div>
              <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {items.map((attr) => (
                  <div
                    key={attr.key}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <dt className="text-zinc-500">{attr.label}</dt>
                    <dd className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                      {attr.value}
                    </dd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

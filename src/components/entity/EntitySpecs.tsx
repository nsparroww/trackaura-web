import type { EntityAttribute } from '@/lib/queries/entity-attributes';

type Props = {
  attributes: EntityAttribute[];
  inheritedAttributes: EntityAttribute[];
  inheritedFromName: string | null;
};

/* ───────────────────────────────────────────────────────────────────────────
   EntitySpecs

   Renders specs as grouped sections per the GROUP_ORDER convention in
   chip-attributes.ts (Chip → Performance → Memory → Power →
   Manufacturing for GPU verticals; future verticals add their own
   group order via the same ATTRIBUTE_CONFIG).

   Visual language matches the existing Stat tiles in ChipPage.tsx —
   same border / dark-mode / text-weight rules.

   Phase-0.5 polish (2026-05-04): renders TWO blocks for leaf entities
   that inherit attributes from a parent (e.g. boards inheriting silicon
   specs from their gpu_chip parent). The own-attributes block always
   renders first; the inherited block renders below with a distinct
   heading ("Inherited from RTX 5090") and slightly muted dd values to
   signal that those numbers describe the parent (the silicon), not
   measured directly on this specific board model. View-model
   de-duplicates inherited keys against own keys, so a board's factory
   boost_clock_mhz wins over the chip's reference clock when both exist.

   Empty input on both blocks → renders nothing (parent decides whether
   to show a heading).
   ─────────────────────────────────────────────────────────────────────────── */

export default function EntitySpecs({
  attributes,
  inheritedAttributes,
  inheritedFromName,
}: Props) {
  if (attributes.length === 0 && inheritedAttributes.length === 0) return null;

  return (
    <section className="mb-8 space-y-4">
      {attributes.length > 0 && (
        <SpecsBlock heading="Specifications" attributes={attributes} />
      )}
      {inheritedAttributes.length > 0 && (
        <SpecsBlock
          heading={
            inheritedFromName
              ? `Inherited from ${inheritedFromName}`
              : 'Inherited specifications'
          }
          attributes={inheritedAttributes}
          muted
        />
      )}
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   SpecsBlock — renders one bordered card with grouped attribute rows.
   `muted` flag tones down dd values to communicate "this came from
   somewhere else", used by the inherited-attributes block.
   ─────────────────────────────────────────────────────────────────────────── */

function SpecsBlock({
  heading,
  attributes,
  muted,
}: {
  heading: string;
  attributes: EntityAttribute[];
  muted?: boolean;
}) {
  // Group preserving the order they arrive in (formatAttributes already
  // sorted by GROUP_ORDER, then alphabetical within group).
  const groups = new Map<string, EntityAttribute[]>();
  for (const attr of attributes) {
    if (!groups.has(attr.group)) groups.set(attr.group, []);
    groups.get(attr.group)!.push(attr);
  }

  const ddClass = muted
    ? 'font-medium tabular-nums text-zinc-600 dark:text-zinc-400'
    : 'font-medium tabular-nums text-zinc-900 dark:text-zinc-100';

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">{heading}</h2>
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
                    <dd className={ddClass}>{attr.value}</dd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

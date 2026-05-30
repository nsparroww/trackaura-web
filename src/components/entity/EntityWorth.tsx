import type { EntityViewModel } from '@/lib/queries/entity';

/* ---------------------------------------------------------------------
   EntityWorth

   Human-facing render of the synthesized worth estimate
   (WORTH_ENGINE_SPEC). Until now the worth tuple
   (estimate, confidence, source_tier, as_of) was emitted only in the
   Product JSON-LD via buildEntityProductLd -- machine-visible, never
   shown to readers. This closes that gap: a person arriving from an LLM
   citation now sees the same figure the model was grounded on.

   Worth is a central-tendency INDEX with stated uncertainty, not a
   transactable price (bible Section 6). The copy preserves that
   distinction: it reads "estimated worth", names the confidence
   explicitly, names the source tier, and always shows the as-of date so
   a stale estimate is never presented as today's.

   Self-gates to null when entity.worth is absent -- which is exactly the
   below-floor / no-observation case, since persist_worth writes nothing
   below the publishable confidence floor and the view model carries the
   null through. No worth section renders rather than a fabricated number.

   ASCII source by convention (Protocol #7 cp1252 trap): the em-dash in
   the prose is a \u2014 escape inside a JS string, not a literal char in
   JSX text.
   --------------------------------------------------------------------- */

const MONTH_ABBREV = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/* W-tier -> human phrase. Mirrors WORTH_ENGINE_SPEC tier ladder. W3/W4
   copy ships ahead of the tiers themselves (Phase 2 / deferred) so the
   component is complete when those sources land. */
const SOURCE_TIER_COPY: Record<string, string> = {
  W1: 'current retail listings',
  W2: 'recent retail pricing',
  W3: 'secondary-market sales',
  W4: 'a modelled estimate',
};

type ConfidenceBand = { label: string; tone: string; bar: string };

/* Band thresholds match WORTH_ENGINE_SPEC's §5 confidence->tier map:
   >=0.75 high (well_tracked), 0.55-0.75 moderate (tracked), below that
   limited. Items under the 0.35 publishable floor never reach this
   component (worth is null), so there's no "below floor" band here. */
function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 0.75) {
    return {
      label: 'High confidence',
      tone: 'text-emerald-700 dark:text-emerald-400',
      bar: 'bg-emerald-500',
    };
  }
  if (confidence >= 0.55) {
    return {
      label: 'Moderate confidence',
      tone: 'text-amber-700 dark:text-amber-400',
      bar: 'bg-amber-500',
    };
  }
  return {
    label: 'Limited confidence',
    tone: 'text-zinc-600 dark:text-zinc-400',
    bar: 'bg-zinc-400',
  };
}

/* As-of formatting mirrors EntityPage.formatDate's date-only path: parse
   YYYY-MM-DD by hand so a UTC-midnight Date never shifts the day backward
   in a negative-offset timezone (the RTX 5090 "Jan 29" bug). */
function formatAsOf(iso: string | null): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, year, mm, dd] = m;
  const idx = parseInt(mm, 10) - 1;
  if (idx < 0 || idx > 11) return null;
  return `${MONTH_ABBREV[idx]} ${parseInt(dd, 10)}, ${year}`;
}

export default function EntityWorth({ entity }: { entity: EntityViewModel }) {
  const worth = entity.worth;
  if (!worth) return null;

  /* Defensive Number() coercion: the persisted worth_* columns are
     numeric, but coercing here means a string-typed value model can't
     break toLocaleString / width math. */
  const estimateNum = Number(worth.estimate);
  const confidenceNum = Number(worth.confidence);
  if (!Number.isFinite(estimateNum) || !Number.isFinite(confidenceNum)) {
    return null;
  }

  const band = confidenceBand(confidenceNum);
  const pct = Math.round(Math.max(0, Math.min(1, confidenceNum)) * 100);
  const asOf = formatAsOf(worth.asOf);
  const sourceCopy = SOURCE_TIER_COPY[worth.sourceTier] ?? 'available observations';
  const estimateStr = `CAD $${estimateNum.toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  const prose =
    `An estimate of central market value based on ${sourceCopy}` +
    (asOf ? `, as of ${asOf}` : '') +
    `. This is a synthesized index, not a price you can transact at \u2014 ` +
    `it reflects what the item is broadly worth, with the confidence shown.`;

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold">Estimated worth</h2>
      <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="text-2xl font-semibold tabular-nums sm:text-3xl">
            {estimateStr}
          </div>
          <div className={`text-sm font-medium ${band.tone}`}>{band.label}</div>
        </div>

        {/* Confidence bar - visual of the [0,1] score, colored by band. */}
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className={`h-full rounded-full ${band.bar}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-zinc-500">Confidence {pct}%</div>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
          {prose}
        </p>
      </div>
    </section>
  );
}

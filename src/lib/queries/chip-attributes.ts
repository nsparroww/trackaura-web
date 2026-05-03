import { createClient } from '@/lib/supabase/server';

/* ─────────────────────────────────────────────────────────────────────
   Chip attribute config + fetch.

   This module is the single source of truth for how raw `entity_attributes`
   rows turn into display-ready spec rows. Used by:
     - src/lib/queries/chip.ts          (chip page hero specs section)
     - src/lib/queries/enrichment.ts    (legacy product page chip-context)

   Adding a new attribute key: add to ATTRIBUTE_CONFIG below + give it an
   ATTR_ORDER index for predictable sort order. Anything not in the config
   is silently dropped from output (keeps long-tail keys like
   alternate_chip_codename, memory_variant_*, has_* off display surfaces).

   Formatter convention: every numeric attribute MUST consult `num` not `v`.
   Backfilled rows (dbgpu) populate attribute_value_num only — attribute_value
   is null. The earlier (v) => `${v} W` pattern only worked on legacy
   attributes that had text values populated. Risk #29 / Protocol #40:
   verify formatter correctness against actual row shape, not assumed shape.
   ───────────────────────────────────────────────────────────────────── */

export type ChipAttribute = {
  key: string;
  label: string;
  value: string;
  group: string;
};

type AttrCfg = {
  label: string;
  group: string;
  format?: (v: string, num: number | null) => string;
};

export const ATTRIBUTE_CONFIG: Record<string, AttrCfg> = {
  architecture: { label: 'Architecture', group: 'Chip' },
  generation: { label: 'Generation', group: 'Chip' },
  chip_codename: { label: 'Codename', group: 'Chip' },
  bus_interface: { label: 'Bus Interface', group: 'Chip' },
  process_size_nm: {
    label: 'Process',
    group: 'Manufacturing',
    format: (v, num) => {
      if (num != null) return `${num} nm`;
      return v ? `${v} nm` : '—';
    },
  },
  tdp_w: {
    label: 'TDP',
    group: 'Power',
    format: (v, num) => {
      if (num != null) return `${num} W`;
      return v ? `${v} W` : '—';
    },
  },
  base_clock_mhz: {
    label: 'Base Clock',
    group: 'Performance',
    format: (_v, num) => (num != null ? `${Math.round(num)} MHz` : '—'),
  },
  boost_clock_mhz: {
    label: 'Boost Clock',
    group: 'Performance',
    format: (_v, num) => (num != null ? `${Math.round(num)} MHz` : '—'),
  },
  memory_size_gb: {
    label: 'Memory Size',
    group: 'Memory',
    format: (_v, num) => {
      if (num == null) return '—';
      // Sub-1 GB GPUs (legacy workstation cards) shouldn't display as "0 GB"
      if (num < 1) return `${(num * 1024).toFixed(0)} MB`;
      return `${num.toFixed(num % 1 === 0 ? 0 : 1)} GB`;
    },
  },
  memory_type: { label: 'Memory Type', group: 'Memory' },
  memory_bus_bits: {
    label: 'Memory Bus',
    group: 'Memory',
    format: (v, num) => {
      if (num != null) return `${num}-bit`;
      return v ? `${v}-bit` : '—';
    },
  },
};

export const GROUP_ORDER = [
  'Chip',
  'Performance',
  'Memory',
  'Power',
  'Manufacturing',
];

// Explicit ordering inside each group. Lower number = higher position.
// Anything missing from this map sorts to the end alphabetically.
const ATTR_ORDER: Record<string, number> = {
  // Chip
  architecture: 1,
  generation: 2,
  chip_codename: 3,
  bus_interface: 4,
  // Performance
  base_clock_mhz: 1,
  boost_clock_mhz: 2,
  // Memory  (Size → Type → Bus is the natural reading order)
  memory_size_gb: 1,
  memory_type: 2,
  memory_bus_bits: 3,
  // Power
  tdp_w: 1,
  // Manufacturing
  process_size_nm: 1,
};

type RawAttrRow = {
  attribute_key: string;
  attribute_value: string | null;
  attribute_value_num: number | string | null;
};

export function formatAttributes(rows: RawAttrRow[]): ChipAttribute[] {
  const out: ChipAttribute[] = [];
  for (const r of rows) {
    const cfg = ATTRIBUTE_CONFIG[r.attribute_key];
    if (!cfg) continue;
    // Some rows have only attribute_value_num set (numeric attributes from
    // the dbgpu backfill). Don't drop those — synthesize a value string.
    const num =
      r.attribute_value_num != null ? Number(r.attribute_value_num) : null;
    const haveText = !!r.attribute_value;
    const haveNum = num != null && Number.isFinite(num);
    if (!haveText && !haveNum) continue;
    const value = cfg.format
      ? cfg.format(r.attribute_value ?? '', haveNum ? num : null)
      : (r.attribute_value ?? String(num));
    out.push({
      key: r.attribute_key,
      label: cfg.label,
      value,
      group: cfg.group,
    });
  }
  out.sort((a, b) => {
    const ga = GROUP_ORDER.indexOf(a.group);
    const gb = GROUP_ORDER.indexOf(b.group);
    if (ga !== gb) return (ga === -1 ? 99 : ga) - (gb === -1 ? 99 : gb);
    const oa = ATTR_ORDER[a.key] ?? 99;
    const ob = ATTR_ORDER[b.key] ?? 99;
    if (oa !== ob) return oa - ob;
    return a.label.localeCompare(b.label);
  });
  return out;
}

/* ─────────────────────────────────────────────────────────────────────
   fetchChipAttributes — returns formatted attributes for a chip entity.
   Caller is responsible for verifying entity_type === 'gpu_chip'.
   Returns [] on error or no data. Never returns null (lets callers
   .map without nullability checks).
   ───────────────────────────────────────────────────────────────────── */

export async function fetchChipAttributes(
  chipEntityId: string | number,
): Promise<ChipAttribute[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('entity_attributes')
    .select('attribute_key, attribute_value, attribute_value_num')
    .eq('entity_id', chipEntityId);

  if (error) {
    console.error('[chip-attributes] fetch failed:', error);
    return [];
  }
  return formatAttributes(data ?? []);
}

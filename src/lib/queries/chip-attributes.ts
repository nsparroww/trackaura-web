import { createClient } from '@/lib/supabase/server';

/* ─────────────────────────────────────────────────────────────────────
   Chip attribute config + fetch.

   This module is the single source of truth for how raw `entity_attributes`
   rows turn into display-ready spec rows. Used by:
     - src/lib/queries/chip.ts          (chip page hero specs section)
     - src/lib/queries/enrichment.ts    (legacy product page chip-context)
     - src/lib/queries/entity.ts        (generic EntityPage path, all verticals)

   Adding a new attribute key: add to ATTRIBUTE_CONFIG below + give it an
   ATTR_ORDER index for predictable sort order. Anything not in the config
   is silently dropped from output (keeps long-tail keys like
   alternate_chip_codename, memory_variant_*, has_* off display surfaces).

   Formatter convention: every numeric attribute MUST consult `num` not `v`.
   Backfilled rows (dbgpu) populate attribute_value_num only — attribute_value
   is null. The earlier (v) => `${v} W` pattern only worked on legacy
   attributes that had text values populated. Risk #29 / Protocol #40:
   verify formatter correctness against actual row shape, not assumed shape.

   2026-05-08: CPU vertical (Intel ARK) added. 783 SKUs imported with 75+
   attributes per SKU. Curated allowlist below surfaces the price-defining
   13 plus supporting context — about 27 keys across 5 groups. Long-tail
   ARK keys (use_conditions, embedded_options_*, advanced_technologies_*)
   stay dropped. Renaming this module to entity-attributes-config.ts is a
   Phase-0.5 polish item; Protocol #11 says don't introduce a parallel
   module while the existing one already owns the concern.
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
  /* ===================================================================
     GPU vertical (gpu_chip + gpus entity_types)
     =================================================================== */
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

  /* ===================================================================
     CPU vertical (cpu entity_type) — Intel ARK source
     Group order: Identity → Performance → Memory → Power → Manufacturing
     All values arrive as text strings from ARK; attribute_value_num is
     best-effort numeric extraction (e.g. "6 GHz" → 6.0). Formatters trust
     the raw text in most cases since ARK already includes units.
     =================================================================== */

  // --- Identity / Chip ---
  processor_number:    { label: 'Processor Number',  group: 'Identity' },
  vertical_segment:    { label: 'Segment',           group: 'Identity' },
  product_collection:  { label: 'Product Collection', group: 'Identity' },
  codename:            { label: 'Codename',          group: 'Identity' },
  package_sockets_supported: { label: 'Socket',      group: 'Identity' },
  launch_date:         { label: 'Launch',            group: 'Identity' },

  // --- Performance ---
  total_cores:                 { label: 'Total Cores',          group: 'Performance' },
  num_of_performance_cores:    { label: 'Performance Cores',    group: 'Performance' },
  num_of_efficient_cores:      { label: 'Efficient Cores',      group: 'Performance' },
  total_threads:               { label: 'Total Threads',        group: 'Performance' },
  max_turbo_frequency:         { label: 'Max Turbo',            group: 'Performance' },
  performance_core_max_turbo_frequency: { label: 'P-Core Max Turbo', group: 'Performance' },
  efficient_core_max_turbo_frequency:   { label: 'E-Core Max Turbo', group: 'Performance' },
  performance_core_base_frequency:      { label: 'P-Core Base',      group: 'Performance' },
  efficient_core_base_frequency:        { label: 'E-Core Base',      group: 'Performance' },
  cache:                       { label: 'Cache',                group: 'Performance' },
  total_l2_cache:              { label: 'L2 Cache',             group: 'Performance' },

  // --- Memory ---
  memory_max_memory_size:           { label: 'Max Memory',         group: 'Memory' },
  memory_memory_types:              { label: 'Memory Types',       group: 'Memory' },
  memory_max_num_of_memory_channels:{ label: 'Memory Channels',    group: 'Memory' },
  memory_ecc_memory_supported:      { label: 'ECC Support',        group: 'Memory' },

  // --- GPU (integrated) ---
  gpu_gpu_name:           { label: 'Integrated Graphics', group: 'Integrated GPU' },
  gpu_graphics_base_frequency: { label: 'iGPU Base',      group: 'Integrated GPU' },
  gpu_graphics_max_dynamic_frequency: { label: 'iGPU Max', group: 'Integrated GPU' },

  // --- Power ---
  processor_base_power: { label: 'Base Power',     group: 'Power' },
  maximum_turbo_power:  { label: 'Max Turbo Power', group: 'Power' },

  // --- Manufacturing ---
  lithography:          { label: 'Lithography',     group: 'Manufacturing' },
};

export const GROUP_ORDER = [
  // GPU groups
  'Chip',
  // CPU groups (interleave Identity above Performance for both verticals)
  'Identity',
  'Performance',
  'Memory',
  'Integrated GPU',
  'Power',
  'Manufacturing',
];

// Explicit ordering inside each group. Lower number = higher position.
// Anything missing from this map sorts to the end alphabetically.
const ATTR_ORDER: Record<string, number> = {
  // ---- GPU ----
  // Chip
  architecture: 1,
  generation: 2,
  chip_codename: 3,
  bus_interface: 4,
  // Performance (GPU)
  base_clock_mhz: 1,
  boost_clock_mhz: 2,
  // Memory  (Size → Type → Bus is the natural reading order)
  memory_size_gb: 1,
  memory_type: 2,
  memory_bus_bits: 3,
  // Power (GPU)
  tdp_w: 1,
  // Manufacturing
  process_size_nm: 1,

  // ---- CPU ----
  // Identity
  processor_number: 1,
  vertical_segment: 2,
  product_collection: 3,
  codename: 4,
  package_sockets_supported: 5,
  launch_date: 6,
  // Performance (CPU) — order so cores appear before frequencies before cache
  total_cores: 10,
  num_of_performance_cores: 11,
  num_of_efficient_cores: 12,
  total_threads: 13,
  max_turbo_frequency: 20,
  performance_core_max_turbo_frequency: 21,
  efficient_core_max_turbo_frequency: 22,
  performance_core_base_frequency: 23,
  efficient_core_base_frequency: 24,
  // cache fields after frequencies
  // (key 'cache' shares with potential GPU cache; no collision today)
  // Memory (CPU)
  memory_max_memory_size: 10,
  memory_memory_types: 11,
  memory_max_num_of_memory_channels: 12,
  memory_ecc_memory_supported: 13,
  // Integrated GPU
  gpu_gpu_name: 1,
  gpu_graphics_base_frequency: 2,
  gpu_graphics_max_dynamic_frequency: 3,
  // Power (CPU)
  processor_base_power: 10,
  maximum_turbo_power: 11,
  // Manufacturing
  lithography: 10,
};

// Ordering note: the CPU 'cache' and 'total_l2_cache' keys aren't in
// ATTR_ORDER, so they sort to the end of Performance alphabetically
// (Cache, L2 Cache) — which puts them after the cores+frequency block.
// That's the desired reading order; explicit ordering would duplicate
// the alphabetic outcome.

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
   fetchChipAttributes — returns formatted attributes for any entity.
   Caller is responsible for verifying entity_type matches what the
   ATTRIBUTE_CONFIG covers.

   Despite the historical name, this fetches attributes for any entity_id;
   the function is the entry point used by both the GPU chip page and
   the generic EntityPage data layer (re-exported as fetchEntityAttributes
   in entity-attributes.ts).

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

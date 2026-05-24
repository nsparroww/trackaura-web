import { createCatalogClient } from '@/lib/supabase/server';

/* ---------------------------------------------------------------------------
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
   Backfilled rows (dbgpu) populate attribute_value_num only -- attribute_value
   is null. The earlier (v) => `${v} W` pattern only worked on legacy
   attributes that had text values populated. Risk #29 / Protocol #40:
   verify formatter correctness against actual row shape, not assumed shape.

   2026-05-08: CPU vertical (Intel ARK) added. 783 SKUs imported with 75+
   attributes per SKU. Curated allowlist below surfaces the price-defining
   13 plus supporting context -- about 27 keys across 5 groups. Long-tail
   ARK keys (use_conditions, embedded_options_*, advanced_technologies_*)
   stay dropped. Renaming this module to entity-attributes-config.ts is a
   Phase-0.5 polish item; Protocol #11 says don't introduce a parallel
   module while the existing one already owns the concern.

   2026-05-19: Monitor vertical added. The monitor block below is the
   ~70-key CANONICAL monitor vocabulary -- the intentional key set the
   ASUS adapter emits (catalog/asus/normalize.py KEY_MAP values +
   PRICE_DEFINING_KEYS) and the LG adapter is contracted to mirror. It is
   deliberately NOT the full set of distinct monitor attribute_key values
   in the DB: the LG ingest (2026-05-11) wrote a large un-normalized
   fallback-key tail (~900 keys -- vesa_mounting / vesa_compatible /
   vesa_size_mm all the same concept, plus regulatory cruft like tco99,
   semko, ccc_for_china). Allowlisting the canonical vocabulary surfaces
   every ASUS spec and the LG canonical subset; the LG fallback sprawl
   stays dropped. The real fix for LG's trapped spec data is an LG
   normalizer KEY_MAP pass mirroring the ASUS v2 work -- tracked as a
   separate ROADMAP item, NOT papered over by expanding this config.

   Cookie-free per Bible Protocol #37 (2026-05-15):
     fetchChipAttributes was the second cookies() callsite (alongside
     entity-slug.ts) keeping /chip /board /cpu /cpu-microarch from
     opting into ISR. Reads on entity_attributes are public-catalog with
     public-read RLS, so anon-key access via the cookie-free client is
     correct.
   --------------------------------------------------------------------------- */

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
      return v ? `${v} nm` : '-';
    },
  },
  tdp_w: {
    label: 'TDP',
    group: 'Power',
    format: (v, num) => {
      if (num != null) return `${num} W`;
      return v ? `${v} W` : '-';
    },
  },
  base_clock_mhz: {
    label: 'Base Clock',
    group: 'Performance',
    format: (_v, num) => (num != null ? `${Math.round(num)} MHz` : '-'),
  },
  boost_clock_mhz: {
    label: 'Boost Clock',
    group: 'Performance',
    format: (_v, num) => (num != null ? `${Math.round(num)} MHz` : '-'),
  },
  memory_size_gb: {
    label: 'Memory Size',
    group: 'Memory',
    format: (_v, num) => {
      if (num == null) return '-';
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
      return v ? `${v}-bit` : '-';
    },
  },

  /* ===================================================================
     CPU vertical (cpu entity_type) -- Intel ARK source
     Group order: Identity -> Performance -> Memory -> Power -> Manufacturing
     All values arrive as text strings from ARK; attribute_value_num is
     best-effort numeric extraction (e.g. "6 GHz" -> 6.0). Formatters trust
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

  /* ===================================================================
     MONITOR vertical (monitor entity_type) -- LG + ASUS source
     Canonical vocabulary only (catalog/asus/normalize.py KEY_MAP values).
     Values arrive as text; no formatters -- ASUS values carry their own
     units and LG values are bare numbers; raw text is the safe display
     until a unit-normalization polish pass. See module header.
     =================================================================== */

  // --- Display ---
  screen_size_inches:    { label: 'Screen Size',      group: 'Display' },
  aspect_ratio:          { label: 'Aspect Ratio',     group: 'Display' },
  panel_type:            { label: 'Panel Type',       group: 'Display' },
  resolution:            { label: 'Resolution',       group: 'Display' },
  refresh_rate_hz:       { label: 'Refresh Rate',     group: 'Display' },
  response_time:         { label: 'Response Time',    group: 'Display' },
  curvature:             { label: 'Curvature',        group: 'Display' },
  backlight_type:        { label: 'Backlight',        group: 'Display' },
  pixel_pitch_mm:        { label: 'Pixel Pitch',      group: 'Display' },
  pixel_density_ppi:     { label: 'Pixel Density',    group: 'Display' },
  display_viewing_area:  { label: 'Viewing Area',     group: 'Display' },
  viewing_angle:         { label: 'Viewing Angle',    group: 'Display' },
  surface_treatment:     { label: 'Surface',          group: 'Display' },
  touch_support:         { label: 'Touch',            group: 'Display' },

  // --- Image Quality ---
  brightness_typ_cd_m2:      { label: 'Brightness (Typ.)',      group: 'Image Quality' },
  brightness_hdr_peak_cd_m2: { label: 'Brightness (HDR Peak)',  group: 'Image Quality' },
  contrast_ratio_typ:        { label: 'Contrast Ratio',         group: 'Image Quality' },
  contrast_ratio_max:        { label: 'Contrast Ratio (Max)',   group: 'Image Quality' },
  contrast_ratio_hdr_max:    { label: 'Contrast Ratio (HDR Max)', group: 'Image Quality' },
  contrast_ratio_summary:    { label: 'Contrast Ratio',         group: 'Image Quality' },
  color_count:               { label: 'Display Colors',         group: 'Image Quality' },
  color_gamut_srgb:          { label: 'sRGB Coverage',          group: 'Image Quality' },
  color_gamut_dci_p3:        { label: 'DCI-P3 Coverage',        group: 'Image Quality' },
  color_gamut_adobe_rgb:     { label: 'Adobe RGB Coverage',     group: 'Image Quality' },
  color_gamut_rec2020:       { label: 'Rec.2020 Coverage',      group: 'Image Quality' },
  hdr_10:                    { label: 'HDR10',                  group: 'Image Quality' },
  vesa_displayhdr:           { label: 'VESA DisplayHDR',        group: 'Image Quality' },
  flicker_safe:              { label: 'Flicker-Free',           group: 'Image Quality' },
  low_blue_light:            { label: 'Low Blue Light',         group: 'Image Quality' },
  dynamic_contrast_ratio:    { label: 'Dynamic Contrast Ratio', group: 'Image Quality' },

  // --- Features ---
  vrr:                   { label: 'Variable Refresh Rate', group: 'Features' },
  amd_freesync:          { label: 'AMD FreeSync',          group: 'Features' },
  nvidia_gsync:          { label: 'NVIDIA G-SYNC',         group: 'Features' },
  adaptive_sync:         { label: 'Adaptive-Sync',         group: 'Features' },
  motion_blur_reduction: { label: 'Motion Blur Reduction', group: 'Features' },
  gameplus:              { label: 'GamePlus',              group: 'Features' },
  gamefast_input:        { label: 'GameFast Input',        group: 'Features' },
  dark_boost:            { label: 'Dark Boost',            group: 'Features' },
  shadow_boost:          { label: 'Shadow Boost',          group: 'Features' },
  gamevisual:            { label: 'GameVisual',            group: 'Features' },
  hdr_effect:            { label: 'HDR Modes',             group: 'Features' },
  color_temp_selection:  { label: 'Color Temp. Selection', group: 'Features' },
  hdcp:                  { label: 'HDCP',                  group: 'Features' },
  pip_pbp:               { label: 'PiP / PbP',             group: 'Features' },
  hardware_calibration:  { label: 'Hardware Calibration',  group: 'Features' },
  ambient_light_sensor:  { label: 'Ambient Light Sensor',  group: 'Features' },
  proximity_sensor:      { label: 'Proximity Sensor',      group: 'Features' },
  embedded_colorimeter:  { label: 'Embedded Colorimeter',  group: 'Features' },
  ergonomic:             { label: 'Ergonomic Design',      group: 'Features' },
  ai_assistant:          { label: 'AI Assistant',          group: 'Features' },
  ddc_ci:                { label: 'DDC/CI',                group: 'Features' },
  plug_play:             { label: 'Plug & Play',           group: 'Features' },
  f_engine:              { label: 'F-Engine',              group: 'Features' },
  srgb_mode:             { label: 'sRGB Mode',             group: 'Features' },
  overclocking:          { label: 'Overclocking',          group: 'Features' },
  key_lock:              { label: 'Key Lock',              group: 'Features' },
  osd_lock:              { label: 'OSD Lock',              group: 'Features' },
  game_mode:             { label: 'Game Mode',             group: 'Features' },

  // --- Connectivity ---
  hdmi_ports:            { label: 'HDMI',                 group: 'Connectivity' },
  displayport_ports:     { label: 'DisplayPort',          group: 'Connectivity' },
  usb_c_ports:           { label: 'USB-C',                group: 'Connectivity' },
  usb_hub:               { label: 'USB Hub',              group: 'Connectivity' },
  usb_c_power_delivery:  { label: 'USB-C Power Delivery',  group: 'Connectivity' },
  ethernet_rj45:         { label: 'Ethernet (RJ45)',      group: 'Connectivity' },
  headphone_jack:        { label: 'Headphone Jack',       group: 'Connectivity' },
  audio_line_in:         { label: 'Audio Line-In',        group: 'Connectivity' },

  // --- Sound ---
  built_in_speaker:      { label: 'Built-in Speakers',    group: 'Sound' },

  // --- Stand ---
  stand_tilt:               { label: 'Tilt',              group: 'Stand' },
  stand_swivel:             { label: 'Swivel',            group: 'Stand' },
  stand_pivot:              { label: 'Pivot',             group: 'Stand' },
  stand_height_adjustment:  { label: 'Height Adjustment', group: 'Stand' },
  vesa_mount_pattern:       { label: 'VESA Mount',        group: 'Stand' },
  kensington_lock:          { label: 'Kensington Lock',   group: 'Stand' },
  tilt_supported:           { label: 'Tilt',              group: 'Stand' },
  tilt_angle:               { label: 'Tilt Angle',        group: 'Stand' },
  pivot_supported:          { label: 'Pivot',             group: 'Stand' },
  base_detachable:          { label: 'Detachable Base',   group: 'Stand' },

  // --- Power (monitor keys share the existing Power group) ---
  power_consumption_typ_w:   { label: 'Power (Typical)', group: 'Power' },
  power_consumption_max_w:   { label: 'Power (Max)',     group: 'Power' },
  power_consumption_sleep_w: { label: 'Power (Sleep)',   group: 'Power' },
  power_consumption_off_w:   { label: 'Power (Off)',     group: 'Power' },
  ac_input:                  { label: 'AC Input',        group: 'Power' },
  dc_output:                 { label: 'DC Output',       group: 'Power' },

  // --- Physical ---
  dimensions_with_stand:     { label: 'Dimensions (with stand)',    group: 'Physical' },
  dimensions_without_stand:  { label: 'Dimensions (without stand)', group: 'Physical' },
  dimensions_shipping:       { label: 'Dimensions (shipping)',      group: 'Physical' },
  weight_with_stand:         { label: 'Weight (with stand)',        group: 'Physical' },
  weight_without_stand:      { label: 'Weight (without stand)',     group: 'Physical' },
  weight_shipping:           { label: 'Weight (shipping)',          group: 'Physical' },
  front_color:               { label: 'Front Color',                group: 'Physical' },
  stand_color:               { label: 'Stand Color',                group: 'Physical' },
  back_cover_color:          { label: 'Back Cover Color',           group: 'Physical' },

  // --- In the Box (LG v2) ---
  accessory_manual:          { label: 'Manual Included',            group: 'In the Box' },
  thunderbolt_cable:         { label: 'Thunderbolt Cable',          group: 'In the Box' },

  // --- Identity (release_year shares the existing Identity group) ---
  release_year:          { label: 'Release Year',        group: 'Identity' },
};

export const GROUP_ORDER = [
  // GPU groups
  'Chip',
  // CPU groups (interleave Identity above Performance for both verticals)
  'Identity',
  // Monitor display-side groups
  'Display',
  'Image Quality',
  'Features',
  // GPU/CPU performance groups
  'Performance',
  'Memory',
  'Integrated GPU',
  // Monitor connectivity-side groups
  'Connectivity',
  'Sound',
  'Stand',
  // Shared
  'Power',
  // Monitor physical group
  'Physical',
  // Monitor accessories
  'In the Box',
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
  // Memory  (Size -> Type -> Bus is the natural reading order)
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
  // Performance (CPU) -- order so cores appear before frequencies before cache
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

  // ---- MONITOR ----
  // Display
  screen_size_inches: 1,
  aspect_ratio: 2,
  panel_type: 3,
  resolution: 4,
  refresh_rate_hz: 5,
  response_time: 6,
  curvature: 7,
  backlight_type: 8,
  pixel_pitch_mm: 9,
  pixel_density_ppi: 10,
  display_viewing_area: 11,
  viewing_angle: 12,
  surface_treatment: 13,
  touch_support: 14,
  // Image Quality
  brightness_typ_cd_m2: 1,
  brightness_hdr_peak_cd_m2: 2,
  contrast_ratio_typ: 3,
  contrast_ratio_max: 4,
  contrast_ratio_hdr_max: 5,
  contrast_ratio_summary: 6,
  color_count: 7,
  color_gamut_srgb: 8,
  color_gamut_dci_p3: 9,
  color_gamut_adobe_rgb: 10,
  color_gamut_rec2020: 11,
  hdr_10: 12,
  vesa_displayhdr: 13,
  flicker_safe: 14,
  low_blue_light: 15,
  dynamic_contrast_ratio: 16,
  // Features
  vrr: 1,
  amd_freesync: 2,
  nvidia_gsync: 3,
  adaptive_sync: 4,
  motion_blur_reduction: 5,
  gameplus: 6,
  gamefast_input: 7,
  dark_boost: 8,
  shadow_boost: 9,
  gamevisual: 10,
  hdr_effect: 11,
  color_temp_selection: 12,
  hdcp: 13,
  pip_pbp: 14,
  hardware_calibration: 15,
  ambient_light_sensor: 16,
  proximity_sensor: 17,
  embedded_colorimeter: 18,
  ergonomic: 19,
  ai_assistant: 20,
  ddc_ci: 21,
  plug_play: 22,
  f_engine: 23,
  srgb_mode: 24,
  overclocking: 25,
  key_lock: 26,
  osd_lock: 27,
  game_mode: 28,
  // Connectivity
  hdmi_ports: 1,
  displayport_ports: 2,
  usb_c_ports: 3,
  usb_hub: 4,
  usb_c_power_delivery: 5,
  ethernet_rj45: 6,
  headphone_jack: 7,
  audio_line_in: 8,
  // Sound
  built_in_speaker: 1,
  // Stand
  stand_tilt: 1,
  stand_swivel: 2,
  stand_pivot: 3,
  stand_height_adjustment: 4,
  vesa_mount_pattern: 5,
  kensington_lock: 6,
  tilt_supported: 7,
  tilt_angle: 8,
  pivot_supported: 9,
  base_detachable: 10,
  // Power (monitor) -- offset clear of the CPU Power keys (10, 11)
  power_consumption_typ_w: 20,
  power_consumption_max_w: 21,
  power_consumption_sleep_w: 22,
  power_consumption_off_w: 23,
  ac_input: 24,
  dc_output: 25,
  // Physical
  dimensions_with_stand: 1,
  dimensions_without_stand: 2,
  dimensions_shipping: 3,
  weight_with_stand: 4,
  weight_without_stand: 5,
  weight_shipping: 6,
  front_color: 7,
  stand_color: 8,
  back_cover_color: 9,
  // In the Box
  accessory_manual: 1,
  thunderbolt_cable: 2,
  // Identity (monitor) -- offset clear of the CPU Identity keys (1-6)
  release_year: 20,
};

// Ordering note: the CPU 'cache' and 'total_l2_cache' keys aren't in
// ATTR_ORDER, so they sort to the end of Performance alphabetically
// (Cache, L2 Cache) -- which puts them after the cores+frequency block.

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
    // the dbgpu backfill). Don't drop those -- synthesize a value string.
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

/* ---------------------------------------------------------------------------
   fetchChipAttributes -- returns formatted attributes for any entity.
   Caller is responsible for verifying entity_type matches what the
   ATTRIBUTE_CONFIG covers.

   Despite the historical name, this fetches attributes for any entity_id;
   the function is the entry point used by both the GPU chip page and
   the generic EntityPage data layer (re-exported as fetchEntityAttributes
   in entity-attributes.ts).

   Returns [] on error or no data. Never returns null (lets callers
   .map without nullability checks).
   --------------------------------------------------------------------------- */

export async function fetchChipAttributes(
  chipEntityId: string | number,
): Promise<ChipAttribute[]> {
  const supabase = createCatalogClient();
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

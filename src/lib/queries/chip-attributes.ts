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

   2026-05-26: LG canonical-key additions. The LG fallback-key migration
   of the same date renamed 4,005 entity_attribute rows to canonical
   normalizer keys. This config now recognises the canonical key names
   the LG normalizer (catalog/lg/normalize.py v3) emits -- including
   unit-suffixed forms (`weight_with_stand_kg`, `dimensions_with_stand_mm`)
   and previously-unrecognised features/software/connectivity keys
   (`hw_calibration`, `factory_calibrated`, `sw_onscreen_control`,
   `dynamic_action_sync`, `super_resolution_plus`, `d_sub_ports`,
   `dvi_d_ports`, etc.). Pre-existing unsuffixed entries
   (`weight_with_stand`, `dimensions_with_stand`, `usb_c_power_delivery`)
   are kept inert in case the ASUS adapter emits them; they cost nothing
   when no row matches.

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
  // codename and code_name both exist on every CPU (970/970, both brands).
  // codename is Intel ARK's long-form ("Products formerly Raptor Lake");
  // code_name is the clean short form ("Raptor Lake"). Surfacing only
  // code_name avoids duplicate rows and gives the better display value.
  code_name:           { label: 'Codename',          group: 'Identity' },
  package_sockets_supported: { label: 'Socket',      group: 'Identity' },
  launch_date:         { label: 'Launch',            group: 'Identity' },
  release_quarter:     { label: 'Release Quarter',   group: 'Identity' },

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
  // --- CPU Performance v2 additions (2026-05-26 audit) ---
  processor_base_frequency:    { label: 'Base Frequency',       group: 'Performance' },
  tech_intel_hyper_threading_technology: { label: 'Hyper-Threading', group: 'Performance' },
  tech_intel_turbo_boost_technology:     { label: 'Turbo Boost',     group: 'Performance' },
  tech_instruction_set_extensions:       { label: 'Instruction Set Extensions', group: 'Performance' },
  tech_amd_smart_access_memory:          { label: 'AMD Smart Access Memory', group: 'Performance' },
  tech_amd_ryzen_ai:                     { label: 'AMD Ryzen AI',    group: 'Performance' },

  // --- Memory ---
  memory_max_memory_size:           { label: 'Max Memory',         group: 'Memory' },
  memory_memory_types:              { label: 'Memory Types',       group: 'Memory' },
  memory_max_num_of_memory_channels:{ label: 'Memory Channels',    group: 'Memory' },
  memory_ecc_memory_supported:      { label: 'ECC Support',        group: 'Memory' },
  memory_max_memory_bandwidth:      { label: 'Memory Bandwidth',   group: 'Memory' },
  // PCIe + bus -- folded into Memory group (interconnect/IO)
  expansion_max_num_of_pci_express_lanes: { label: 'PCIe Lanes',          group: 'Memory' },
  expansion_pci_express_revision:         { label: 'PCIe Revision',       group: 'Memory' },
  bus_speed:                              { label: 'Bus Speed',           group: 'Memory' },

  // --- GPU (integrated) ---
  gpu_gpu_name:           { label: 'Integrated Graphics', group: 'Integrated GPU' },
  gpu_graphics_base_frequency: { label: 'iGPU Base',      group: 'Integrated GPU' },
  gpu_graphics_max_dynamic_frequency: { label: 'iGPU Max', group: 'Integrated GPU' },
  // CPU iGPU v2 additions (2026-05-26 audit)
  gpu_execution_units:    { label: 'Execution Units',  group: 'Integrated GPU' },
  gpu_intel_quick_sync_video: { label: 'Quick Sync',   group: 'Integrated GPU' },
  gpu_directx_support:    { label: 'DirectX',          group: 'Integrated GPU' },
  gpu_opengl_support:     { label: 'OpenGL',           group: 'Integrated GPU' },
  gpu_max_resolution:     { label: 'Max Resolution',   group: 'Integrated GPU' },
  gpu_graphics_output:    { label: 'Display Outputs',  group: 'Integrated GPU' },
  gpu_4k_support:         { label: '4K Support',       group: 'Integrated GPU' },

  // --- Power ---
  processor_base_power: { label: 'Base Power',     group: 'Power' },
  maximum_turbo_power:  { label: 'Max Turbo Power', group: 'Power' },
  tdp:                  { label: 'TDP',            group: 'Power' },  // AMD canonical (2026-05-26 audit)

  // --- Manufacturing ---
  lithography:          { label: 'Lithography',     group: 'Manufacturing' },
  package_max_operating_temperature: { label: 'Max Operating Temp', group: 'Manufacturing' },
  operation_temperature: { label: 'Operating Temperature', group: 'Manufacturing' },  // ASUS monitor (2026-05-26)
  operation_humidity:    { label: 'Operating Humidity',    group: 'Manufacturing' },  // ASUS monitor (2026-05-26)

  /* ===================================================================
     MONITOR vertical (monitor entity_type) -- LG + ASUS source
     Canonical vocabulary only (catalog/asus/normalize.py KEY_MAP values).
     Values arrive as text; no formatters -- ASUS values carry their own
     units and LG values are bare numbers; raw text is the safe display
     until a unit-normalization polish pass. See module header.
     =================================================================== */

  // --- Display ---
  screen_size_inches:    { label: 'Screen Size',      group: 'Display' },
  screen_size_cm:        { label: 'Screen Size (cm)', group: 'Display' },
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
  color_depth_bits:      { label: 'Color Depth',      group: 'Display' },

  // --- Image Quality ---
  brightness_typ_cd_m2: {
    label: 'Brightness (Typ.)',
    group: 'Image Quality',
    format: (v, _num) => {
      if (!v) return '-';
      // Older LG SKUs ship bare numbers ("300"); newer ship "275cd/m²" inline.
      return /cd\s*\/?\s*m/i.test(v) ? v : `${v} cd/m²`;
    },
  },
  brightness_min_cd_m2: {
    label: 'Brightness (Min.)',
    group: 'Image Quality',
    format: (v, _num) => {
      if (!v) return '-';
      return /cd\s*\/?\s*m/i.test(v) ? v : `${v} cd/m²`;
    },
  },
  // brightness_summary is an alternative form, NOT a duplicate of typ/min.
  // Older LG template ships "Brightness" as a single combined row
  // ("200 cd/m² (Typ.), 160 (Min.)") instead of decomposed typ/min rows.
  // 27GR75Q-B is summary-only. Surfacing it preserves the data; the
  // formatting awkwardness is LG's, not ours.
  brightness_summary:        { label: 'Brightness',             group: 'Image Quality' },
  brightness_hdr_peak_cd_m2: { label: 'Brightness (HDR Peak)',  group: 'Image Quality' },
  contrast_ratio_typ:        { label: 'Contrast Ratio',         group: 'Image Quality' },
  contrast_ratio_min:        { label: 'Contrast Ratio (Min)',   group: 'Image Quality' },
  contrast_ratio_max:        { label: 'Contrast Ratio (Max)',   group: 'Image Quality' },
  contrast_ratio_hdr_max:    { label: 'Contrast Ratio (HDR Max)', group: 'Image Quality' },
  // Same as brightness_summary -- alternative form, not duplicate.
  contrast_ratio_summary:    { label: 'Contrast Ratio',         group: 'Image Quality' },
  color_count:               { label: 'Display Colors',         group: 'Image Quality' },
  color_gamut_typ:           { label: 'Color Gamut (Typ.)',     group: 'Image Quality' },
  color_gamut_min:           { label: 'Color Gamut (Min.)',     group: 'Image Quality' },
  color_gamut_srgb:          { label: 'sRGB Coverage',          group: 'Image Quality' },
  color_gamut_dci_p3:        { label: 'DCI-P3 Coverage',        group: 'Image Quality' },
  color_gamut_adobe_rgb:     { label: 'Adobe RGB Coverage',     group: 'Image Quality' },
  color_gamut_rec2020:       { label: 'Rec.2020 Coverage',      group: 'Image Quality' },
  hdr_10:                    { label: 'HDR10',                  group: 'Image Quality' },
  vesa_displayhdr:           { label: 'VESA DisplayHDR',        group: 'Image Quality' },
  flicker_safe:              { label: 'Flicker-Free',           group: 'Image Quality' },
  low_blue_light:            { label: 'Low Blue Light',         group: 'Image Quality' },
  dynamic_contrast_ratio:    { label: 'Dynamic Contrast Ratio', group: 'Image Quality' },
  // --- ASUS-specific image quality (2026-05-26 audit) ---
  gamma_adjustment:          { label: 'Gamma Adjustment',   group: 'Image Quality' },
  color_accuracy:            { label: 'Color Accuracy (ΔE)', group: 'Image Quality' },
  color_adjustment:          { label: 'Color Adjustment',   group: 'Image Quality' },

  // --- Features ---
  vrr:                    { label: 'Variable Refresh Rate', group: 'Features' },
  amd_freesync:           { label: 'AMD FreeSync',          group: 'Features' },
  nvidia_gsync:           { label: 'NVIDIA G-SYNC',         group: 'Features' },
  adaptive_sync:          { label: 'Adaptive-Sync',         group: 'Features' },
  motion_blur_reduction:  { label: 'Motion Blur Reduction', group: 'Features' },
  gameplus:               { label: 'GamePlus',              group: 'Features' },
  gamefast_input:         { label: 'GameFast Input',        group: 'Features' },
  dark_boost:             { label: 'Dark Boost',            group: 'Features' },
  shadow_boost:           { label: 'Shadow Boost',          group: 'Features' },
  gamevisual:             { label: 'GameVisual',            group: 'Features' },
  hdr_effect:             { label: 'HDR Modes',             group: 'Features' },
  color_temp_selection:   { label: 'Color Temp. Selection', group: 'Features' },
  hdcp:                   { label: 'HDCP',                  group: 'Features' },
  pip_pbp:                { label: 'PiP / PbP',             group: 'Features' },
  pip:                    { label: 'PiP',                   group: 'Features' },
  pbp:                    { label: 'PbP',                   group: 'Features' },
  hardware_calibration:   { label: 'Hardware Calibration',  group: 'Features' },  // ASUS-likely; inert if no data
  hw_calibration:         { label: 'Hardware Calibration',  group: 'Features' },  // LG canonical (2026-05-26)
  factory_calibrated:     { label: 'Factory Calibrated',    group: 'Features' },
  ambient_light_sensor:   { label: 'Ambient Light Sensor',  group: 'Features' },
  proximity_sensor:       { label: 'Proximity Sensor',      group: 'Features' },
  embedded_colorimeter:   { label: 'Embedded Colorimeter',  group: 'Features' },
  ergonomic:              { label: 'Ergonomic Design',      group: 'Features' },
  a_i_assistant_technology: { label: 'AI Assistant Technology', group: 'Features' },  // ASUS canonical (2026-05-26 audit)
  ddc_ci:                 { label: 'DDC/CI',                group: 'Features' },
  plug_play:              { label: 'Plug & Play',           group: 'Features' },
  f_engine:               { label: 'F-Engine',              group: 'Features' },
  srgb_mode:              { label: 'sRGB Mode',             group: 'Features' },
  overclocking:           { label: 'Overclocking',          group: 'Features' },
  key_lock:               { label: 'Key Lock',              group: 'Features' },
  osd_lock:               { label: 'OSD Lock',              group: 'Features' },
  game_mode:              { label: 'Game Mode',             group: 'Features' },
  // --- ASUS-specific features (2026-05-26 audit) ---
  quickfit:               { label: 'QuickFit',              group: 'Features' },
  quickfit_plus:          { label: 'QuickFit Plus',         group: 'Features' },
  displaywidget:          { label: 'DisplayWidget',         group: 'Features' },
  splendid_technology:    { label: 'Splendid',              group: 'Features' },
  eye_care_technology:    { label: 'Eye Care',              group: 'Features' },
  motion_sync:            { label: 'Motion Sync',           group: 'Features' },
  asus_power_sync:        { label: 'ASUS Power Sync',       group: 'Features' },
  hdr_preview:            { label: 'HDR Preview',           group: 'Features' },
  proart_preset:          { label: 'ProArt Preset',         group: 'Features' },
  proart_palette:         { label: 'ProArt Palette',        group: 'Features' },
  proart_chroma_tune:     { label: 'ProArt Chroma Tune',    group: 'Features' },
  antibacterial_treatment: { label: 'Antibacterial Treatment', group: 'Features' },
  // LG canonical features (2026-05-26)
  black_stabilizer:       { label: 'Black Stabilizer',      group: 'Features' },
  dynamic_action_sync:    { label: 'Dynamic Action Sync',   group: 'Features' },
  fps_counter:            { label: 'FPS Counter',           group: 'Features' },
  crosshair:              { label: 'Crosshair',             group: 'Features' },
  reader_mode:            { label: 'Reader Mode',           group: 'Features' },
  smart_energy_saving:    { label: 'Smart Energy Saving',   group: 'Features' },
  auto_input_switch:      { label: 'Auto Input Switch',     group: 'Features' },
  color_weakness:         { label: 'Color Weakness',        group: 'Features' },
  super_resolution_plus:  { label: 'Super Resolution+',     group: 'Features' },
  user_defined_key:       { label: 'User-Defined Key',      group: 'Features' },
  rgb_led_lighting:       { label: 'RGB LED Lighting',      group: 'Features' },
  nano_ips:               { label: 'Nano IPS',              group: 'Features' },
  auto_brightness:        { label: 'Auto Brightness',       group: 'Features' },
  automatic_standby:      { label: 'Automatic Standby',     group: 'Features' },

  // --- Connectivity ---
  hdmi_ports:              { label: 'HDMI',                  group: 'Connectivity' },
  displayport_ports:       { label: 'DisplayPort',           group: 'Connectivity' },
  displayport_version:     { label: 'DisplayPort Version',   group: 'Connectivity' },
  usb_c_ports:             { label: 'USB-C',                 group: 'Connectivity' },
  usb_hub:                 { label: 'USB Hub',               group: 'Connectivity' },
  usb_c_power_delivery:    { label: 'USB-C Power Delivery',  group: 'Connectivity' },  // ASUS-likely; inert if no data
  usb_c_power_delivery_w:  { label: 'USB-C Power Delivery',  group: 'Connectivity' },  // LG canonical (2026-05-26)
  usb_c_data_transmission: { label: 'USB-C Data Mode',       group: 'Connectivity' },
  usb_c_max_resolution:    { label: 'USB-C Max Resolution',  group: 'Connectivity' },
  usb_upstream_ports:      { label: 'USB Upstream',          group: 'Connectivity' },
  usb_downstream_ports:    { label: 'USB Downstream',        group: 'Connectivity' },
  ethernet_rj45:           { label: 'Ethernet (RJ45)',       group: 'Connectivity' },
  headphone_jack:          { label: 'Headphone Jack',        group: 'Connectivity' },
  audio_line_in:           { label: 'Audio Line-In',         group: 'Connectivity' },
  d_sub_ports:             { label: 'D-Sub (VGA)',           group: 'Connectivity' },
  dvi_d_ports:             { label: 'DVI-D',                 group: 'Connectivity' },
  daisy_chain:             { label: 'Daisy Chain',           group: 'Connectivity' },
  built_in_kvm:            { label: 'Built-in KVM',          group: 'Connectivity' },
  input_jack_location:     { label: 'Input Jack Location',   group: 'Connectivity' },

  // --- Sound ---
  built_in_speaker:        { label: 'Built-in Speakers',     group: 'Sound' },
  dolby_atmos:             { label: 'Dolby Atmos',           group: 'Sound' },
  dts_hpx:                 { label: 'DTS HP:X',              group: 'Sound' },
  maxx_audio:              { label: 'MaxxAudio',             group: 'Sound' },
  rich_bass:               { label: 'Rich Bass',             group: 'Sound' },

  // --- Stand (mechanical) ---
  stand_tilt:               { label: 'Tilt',              group: 'Stand' },
  stand_swivel:             { label: 'Swivel',            group: 'Stand' },
  stand_pivot:              { label: 'Pivot',             group: 'Stand' },
  stand_height_adjustment:  { label: 'Height Adjustment', group: 'Stand' },
  stand_adjustments:        { label: 'Stand Adjustments', group: 'Stand' },
  vesa_mount_pattern:       { label: 'VESA Mount',        group: 'Stand' },
  kensington_lock:          { label: 'Kensington Lock',   group: 'Stand' },
  tilt_supported:           { label: 'Tilt',              group: 'Stand' },
  tilt_angle:               { label: 'Tilt Angle',        group: 'Stand' },
  pivot_supported:          { label: 'Pivot',             group: 'Stand' },
  base_detachable:          { label: 'Detachable Base',   group: 'Stand' },
  borderless_design:        { label: 'Borderless Design', group: 'Stand' },
  oneclick_stand:           { label: 'OneClick Stand',    group: 'Stand' },

  // --- Power ---
  power_consumption_typ_w:          { label: 'Power (Typical)',     group: 'Power' },
  power_consumption_max_w:          { label: 'Power (Max)',         group: 'Power' },
  power_consumption_sleep_w:        { label: 'Power (Sleep)',       group: 'Power' },
  power_consumption_off_w:          { label: 'Power (Off)',         group: 'Power' },
  power_consumption_energy_star_w:  { label: 'Power (Energy Star)', group: 'Power' },
  ac_input:                         { label: 'AC Input',            group: 'Power' },
  dc_output:                        { label: 'DC Output',           group: 'Power' },
  power_supply_type:                { label: 'Power Supply',        group: 'Power' },

  // --- Physical ---
  // Unsuffixed entries kept as inert defensive aliases in case the ASUS
  // adapter emits them; LG canonical (post-2026-05-26 migration) is suffixed.
  dimensions_with_stand:        { label: 'Dimensions (with stand)',    group: 'Physical' },
  dimensions_without_stand:     { label: 'Dimensions (without stand)', group: 'Physical' },
  dimensions_shipping:          { label: 'Dimensions (shipping)',      group: 'Physical' },
  weight_with_stand:            { label: 'Weight (with stand)',        group: 'Physical' },
  weight_without_stand:         { label: 'Weight (without stand)',     group: 'Physical' },
  weight_shipping:              { label: 'Weight (shipping)',          group: 'Physical' },
  // LG canonical (2026-05-26) — unit-suffixed
  dimensions_with_stand_mm:     { label: 'Dimensions (with stand)',    group: 'Physical' },
  dimensions_without_stand_mm:  { label: 'Dimensions (without stand)', group: 'Physical' },
  dimensions_shipping_mm:       { label: 'Dimensions (shipping)',      group: 'Physical' },
  dimensions_with_stand_in:     { label: 'Dimensions (with stand)',    group: 'Physical' },
  dimensions_without_stand_in:  { label: 'Dimensions (without stand)', group: 'Physical' },
  dimensions_shipping_in:       { label: 'Dimensions (shipping)',      group: 'Physical' },
  weight_with_stand_kg:         { label: 'Weight (with stand)',        group: 'Physical' },
  weight_without_stand_kg:      { label: 'Weight (without stand)',     group: 'Physical' },
  weight_shipping_kg:           { label: 'Weight (shipping)',          group: 'Physical' },
  weight_with_stand_lb:         { label: 'Weight (with stand)',        group: 'Physical' },
  weight_without_stand_lb:      { label: 'Weight (without stand)',     group: 'Physical' },
  weight_shipping_lb:           { label: 'Weight (shipping)',          group: 'Physical' },
  front_color:                  { label: 'Front Color',                group: 'Physical' },
  stand_color:                  { label: 'Stand Color',                group: 'Physical' },
  back_cover_color:             { label: 'Back Cover Color',           group: 'Physical' },
  // --- ASUS-specific physical features (2026-05-26 audit) ---
  '1_4_tripod_socket':          { label: '1/4" Tripod Socket',         group: 'Physical' },
  protection_glass:             { label: 'Protection Glass',           group: 'Physical' },

  // --- Software (LG) ---
  sw_dual_controller:      { label: 'Dual Controller',         group: 'Software' },
  sw_calibration_studio:   { label: 'LG Calibration Studio',   group: 'Software' },
  sw_onscreen_control:     { label: 'OnScreen Control',        group: 'Software' },

  // --- In the Box (LG v2) ---
  accessory_manual:              { label: 'Manual Included',           group: 'In the Box' },
  thunderbolt_cable:             { label: 'Thunderbolt Cable',         group: 'In the Box' },
  accessory_hdmi_cable:          { label: 'HDMI Cable',                group: 'In the Box' },
  accessory_hdmi_cable_spec:     { label: 'HDMI Cable Spec',           group: 'In the Box' },
  accessory_displayport_cable:   { label: 'DisplayPort Cable',         group: 'In the Box' },
  accessory_usbc_cable:          { label: 'USB-C Cable',               group: 'In the Box' },
  accessory_usb_ab_cable:        { label: 'USB A-to-B Cable',          group: 'In the Box' },
  accessory_power_cord:          { label: 'Power Cord',                group: 'In the Box' },
  accessory_adapter:             { label: 'Power Adapter',             group: 'In the Box' },
  accessory_calibration_report:  { label: 'Calibration Report',        group: 'In the Box' },
  accessory_other:               { label: 'Other Accessories',         group: 'In the Box' },

  // --- Compliance / Warranty (LG canonical) ---
  warranty:               { label: 'Warranty',          group: 'Warranty' },
  upc:                    { label: 'UPC',               group: 'Warranty' },
  country_of_origin:      { label: 'Country of Origin', group: 'Warranty' },
  compliance_ce:          { label: 'CE',                group: 'Warranty' },
  compliance_rohs:        { label: 'RoHS',              group: 'Warranty' },
  lcd_zbd_warranty:       { label: 'LCD ZBD Warranty',  group: 'Warranty' },  // ASUS (2026-05-26 audit)

  /* ===================================================================
     MOTHERBOARD vertical (motherboard entity_type) -- retailer-seeded
     Keys emitted by scripts/ingest_motherboards.py. socket is
     price-defining + the CPU-relationship axis; chipset/form_factor are
     identity; memory/pcie/m2_slots/wifi are supporting. Values are clean
     text (socket/chipset/form_factor normalized at ingest); no formatters.
     =================================================================== */
  socket:      { label: 'Socket',         group: 'Motherboard' },
  chipset:     { label: 'Chipset',        group: 'Motherboard' },
  form_factor: { label: 'Form Factor',    group: 'Motherboard' },
  memory:      { label: 'Memory Support', group: 'Motherboard' },
  pcie:        { label: 'PCIe',           group: 'Motherboard' },
  m2_slots:    { label: 'M.2 Slots',      group: 'Motherboard' },
  wifi:        { label: 'Wi-Fi',          group: 'Motherboard' },

  // --- Identity (release_year shares the existing Identity group) ---
  release_year:           { label: 'Release Year',      group: 'Identity' },
  product_family:         { label: 'Product Family',    group: 'Identity' },
};

export const GROUP_ORDER = [
  // GPU groups
  'Chip',
  // CPU groups (interleave Identity above Performance for both verticals)
  'Identity',
  // Motherboard platform group
  'Motherboard',
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
  // Monitor software (LG)
  'Software',
  // Monitor accessories
  'In the Box',
  // Compliance / warranty trails the spec block
  'Warranty',
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
  code_name: 4,
  package_sockets_supported: 5,
  launch_date: 6,
  release_quarter: 6.5,
  // Performance (CPU) -- order so cores appear before frequencies before cache
  total_cores: 10,
  num_of_performance_cores: 11,
  num_of_efficient_cores: 12,
  total_threads: 13,
  processor_base_frequency: 14,
  max_turbo_frequency: 20,
  performance_core_max_turbo_frequency: 21,
  efficient_core_max_turbo_frequency: 22,
  performance_core_base_frequency: 23,
  efficient_core_base_frequency: 24,
  // tech_* keys after frequencies + cache
  tech_intel_hyper_threading_technology: 30,
  tech_intel_turbo_boost_technology: 31,
  tech_instruction_set_extensions: 32,
  tech_amd_smart_access_memory: 33,
  tech_amd_ryzen_ai: 34,
  // cache fields after frequencies
  // Memory (CPU)
  memory_max_memory_size: 10,
  memory_memory_types: 11,
  memory_max_num_of_memory_channels: 12,
  memory_ecc_memory_supported: 13,
  memory_max_memory_bandwidth: 14,
  // PCIe + bus in Memory group, ordered after memory specs
  expansion_max_num_of_pci_express_lanes: 20,
  expansion_pci_express_revision: 21,
  bus_speed: 22,
  // Integrated GPU
  gpu_gpu_name: 1,
  gpu_graphics_base_frequency: 2,
  gpu_graphics_max_dynamic_frequency: 3,
  gpu_execution_units: 4,
  gpu_intel_quick_sync_video: 5,
  gpu_directx_support: 6,
  gpu_opengl_support: 7,
  gpu_max_resolution: 8,
  gpu_graphics_output: 9,
  gpu_4k_support: 10,
  // Power (CPU)
  processor_base_power: 10,
  maximum_turbo_power: 11,
  tdp: 12,  // AMD canonical; renders alongside processor_base_power if both somehow present (shouldn't)
  // Manufacturing
  lithography: 10,
  package_max_operating_temperature: 11,
  operation_temperature: 20,  // ASUS monitor (2026-05-26)
  operation_humidity: 21,

  // ---- MONITOR ----
  // Display
  screen_size_inches: 1,
  screen_size_cm: 1.5,
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
  color_depth_bits: 15,
  // Image Quality
  brightness_typ_cd_m2: 1,
  brightness_min_cd_m2: 1.5,
  brightness_summary: 1.7,
  brightness_hdr_peak_cd_m2: 2,
  contrast_ratio_typ: 3,
  contrast_ratio_min: 3.5,
  contrast_ratio_max: 4,
  contrast_ratio_hdr_max: 5,
  contrast_ratio_summary: 6,
  color_count: 7,
  color_gamut_typ: 7.5,
  color_gamut_min: 7.7,
  color_gamut_srgb: 8,
  color_gamut_dci_p3: 9,
  color_gamut_adobe_rgb: 10,
  color_gamut_rec2020: 11,
  hdr_10: 12,
  vesa_displayhdr: 13,
  flicker_safe: 14,
  low_blue_light: 15,
  dynamic_contrast_ratio: 16,
  // ASUS-specific image quality (2026-05-26)
  gamma_adjustment: 17,
  color_accuracy: 18,
  color_adjustment: 19,
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
  pip: 14.5,
  pbp: 14.7,
  hardware_calibration: 15,
  hw_calibration: 15.1,  // same display label; either renders, never both per entity
  factory_calibrated: 15.5,
  ambient_light_sensor: 16,
  proximity_sensor: 17,
  embedded_colorimeter: 18,
  ergonomic: 19,
  ai_assistant: 20,
  a_i_assistant_technology: 20.5,  // ASUS canonical
  ddc_ci: 21,
  plug_play: 22,
  f_engine: 23,
  srgb_mode: 24,
  overclocking: 25,
  key_lock: 26,
  osd_lock: 27,
  game_mode: 28,
  // ASUS-specific features (2026-05-26 audit) -- trailing the existing set
  quickfit: 50,
  quickfit_plus: 51,
  displaywidget: 52,
  splendid_technology: 53,
  eye_care_technology: 54,
  motion_sync: 55,
  asus_power_sync: 56,
  hdr_preview: 57,
  proart_preset: 58,
  proart_palette: 59,
  proart_chroma_tune: 60,
  antibacterial_treatment: 61,
  // LG canonical features (alphabetical-ish trailing the existing set)
  black_stabilizer: 30,
  dynamic_action_sync: 31,
  fps_counter: 32,
  crosshair: 33,
  reader_mode: 34,
  smart_energy_saving: 35,
  auto_input_switch: 36,
  color_weakness: 37,
  super_resolution_plus: 38,
  user_defined_key: 39,
  rgb_led_lighting: 40,
  nano_ips: 41,
  auto_brightness: 42,
  automatic_standby: 43,
  // Connectivity
  hdmi_ports: 1,
  displayport_ports: 2,
  displayport_version: 2.5,
  usb_c_ports: 3,
  usb_hub: 4,
  usb_c_power_delivery: 5,
  usb_c_power_delivery_w: 5.1,
  usb_c_data_transmission: 5.3,
  usb_c_max_resolution: 5.5,
  usb_upstream_ports: 5.7,
  usb_downstream_ports: 5.8,
  ethernet_rj45: 6,
  headphone_jack: 7,
  audio_line_in: 8,
  d_sub_ports: 10,
  dvi_d_ports: 11,
  daisy_chain: 12,
  built_in_kvm: 13,
  input_jack_location: 14,
  // Sound
  built_in_speaker: 1,
  dolby_atmos: 2,
  dts_hpx: 3,
  maxx_audio: 4,
  rich_bass: 5,
  // Stand
  stand_tilt: 1,
  stand_swivel: 2,
  stand_pivot: 3,
  stand_height_adjustment: 4,
  stand_adjustments: 4.5,
  vesa_mount_pattern: 5,
  kensington_lock: 6,
  tilt_supported: 7,
  tilt_angle: 8,
  pivot_supported: 9,
  base_detachable: 10,
  borderless_design: 11,
  oneclick_stand: 12,
  // Power (monitor) -- offset clear of the CPU Power keys (10, 11)
  power_consumption_typ_w: 20,
  power_consumption_max_w: 21,
  power_consumption_sleep_w: 22,
  power_consumption_off_w: 23,
  power_consumption_energy_star_w: 24,
  ac_input: 25,
  dc_output: 26,
  power_supply_type: 27,
  // Physical -- unsuffixed and suffixed share order slots (only one renders per entity)
  dimensions_with_stand: 1,
  dimensions_with_stand_mm: 1,
  dimensions_with_stand_in: 1.5,
  dimensions_without_stand: 2,
  dimensions_without_stand_mm: 2,
  dimensions_without_stand_in: 2.5,
  dimensions_shipping: 3,
  dimensions_shipping_mm: 3,
  dimensions_shipping_in: 3.5,
  weight_with_stand: 4,
  weight_with_stand_kg: 4,
  weight_with_stand_lb: 4.5,
  weight_without_stand: 5,
  weight_without_stand_kg: 5,
  weight_without_stand_lb: 5.5,
  weight_shipping: 6,
  weight_shipping_kg: 6,
  weight_shipping_lb: 6.5,
  front_color: 7,
  stand_color: 8,
  back_cover_color: 9,
  // ASUS-specific physical features (2026-05-26)
  '1_4_tripod_socket': 10,
  protection_glass: 11,
  // Software (LG)
  sw_onscreen_control: 1,
  sw_dual_controller: 2,
  sw_calibration_studio: 3,
  // In the Box
  accessory_manual: 1,
  accessory_hdmi_cable: 2,
  accessory_hdmi_cable_spec: 2.5,
  accessory_displayport_cable: 3,
  accessory_usbc_cable: 4,
  accessory_usb_ab_cable: 5,
  thunderbolt_cable: 6,
  accessory_power_cord: 7,
  accessory_adapter: 8,
  accessory_calibration_report: 9,
  accessory_other: 10,
  // Warranty / Compliance
  warranty: 1,
  country_of_origin: 2,
  upc: 3,
  compliance_ce: 10,
  compliance_rohs: 11,
  lcd_zbd_warranty: 12,  // ASUS (2026-05-26)
  // Identity (monitor) -- offset clear of the CPU Identity keys (1-6)
  release_year: 20,
  product_family: 21,
  // ---- MOTHERBOARD ----
  socket: 1,
  chipset: 2,
  form_factor: 3,
  memory: 4,
  pcie: 5,
  m2_slots: 6,
  wifi: 7,
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

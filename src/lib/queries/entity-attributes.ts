/* ─────────────────────────────────────────────────────────────────────
   entity-attributes.ts

   Generic-named API for entity attribute fetching. Currently a thin
   re-export of chip-attributes.ts since the existing ATTRIBUTE_CONFIG
   already covers all attribute keys in the database today (all GPU).

   Future entity types (CPUs, monitors, etc.) add their attribute keys
   to the same ATTRIBUTE_CONFIG in chip-attributes.ts. The configs key
   on attribute_key alone, not entity_type, so there is no collision as
   long as semantically-identical keys (`tdp_w` for both GPU and CPU)
   stay semantically identical.

   When the chip page is cut over to the generic data layer (Step 3 in
   entity-page-design.md), chip-attributes.ts is renamed to
   entity-attributes.ts, this re-export disappears, and references in
   queries/chip.ts get deleted.

   Until then: callers depend on this module's generic name so they
   don't need to be touched at cutover.
   ───────────────────────────────────────────────────────────────────── */

export {
  fetchChipAttributes as fetchEntityAttributes,
  formatAttributes,
  type ChipAttribute as EntityAttribute,
} from './chip-attributes';

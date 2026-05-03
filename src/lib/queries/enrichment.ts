import { createClient } from '@/lib/supabase/server';
import {
  formatAttributes,
  type ChipAttribute,
} from '@/lib/queries/chip-attributes';

/* ─────────────────────────────────────────────────────────────────────
   Chip-parent enrichment.

   Joins from old-schema product page (canonical_products / products /
   price_points) to the new-schema canonical_entities tree by way of
   listing URLs — old `products.url` and new `listings.url` are stable
   across migration, so they're the most reliable bridge.

   Returns null whenever any link in the chain breaks. The product page
   degrades gracefully — chip section just doesn't render.

   Attribute config (label/group/format) lives in chip-attributes.ts
   so the chip page and the legacy product page render identically.
   ───────────────────────────────────────────────────────────────────── */

// Preserved for backward compatibility — anything importing
// ChipParentAttribute keeps working.
export type ChipParentAttribute = ChipAttribute;

export type ChipParentSibling = {
  // entityId is the new-schema board id; legacySlug is the OLD
  // canonical_products slug we navigate to (so /p/[slug] works).
  // legacySlug may be null when no legacy mapping exists — caller
  // filters siblings to those that ARE navigable.
  entityId: number;
  legacySlug: string | null;
  name: string;
  brand: string | null;
};

export type ChipParentData = {
  id: number;
  slug: string;
  canonicalName: string;
  brand: string | null;
  releaseDate: string | null;
  msrpCad: number | null;
  attributes: ChipParentAttribute[];
  siblings: ChipParentSibling[];
  totalBoardCount: number;
};

/* ──── Main entry ──── */

const LEGACY_SOURCE_ID = 2; // canonical_sources row 2 = canonical_products_legacy

export async function getChipParent(
  retailerUrls: string[],
): Promise<ChipParentData | null> {
  if (retailerUrls.length === 0) return null;

  const supabase = await createClient();

  // 1. Find the new-schema board entity_id via URL match. Multiple URLs
  //    should agree — pick the most-common entity_id to be resilient
  //    against one-off mismatches (e.g. a re-scrape that updated the URL).
  const { data: listingRows, error: lErr } = await supabase
    .from('listings')
    .select('entity_id')
    .in('url', retailerUrls)
    .limit(20);

  if (lErr || !listingRows || listingRows.length === 0) return null;

  const counts = new Map<number, number>();
  for (const r of listingRows) {
    counts.set(r.entity_id, (counts.get(r.entity_id) ?? 0) + 1);
  }
  const boardId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // 2. Fetch board's parent (chip) id.
  const { data: boardRow } = await supabase
    .from('canonical_entities')
    .select('parent_entity_id, entity_type')
    .eq('id', boardId)
    .maybeSingle();

  if (!boardRow || !boardRow.parent_entity_id) return null;
  if (boardRow.entity_type !== 'gpus') return null; // safety: only enrich GPU boards

  const chipId = boardRow.parent_entity_id;

  // 3. Fetch chip + chip attributes + siblings + sibling-count in parallel.
  const [chipRes, attrsRes, siblingsRes, totalCountRes] = await Promise.all([
    supabase
      .from('canonical_entities')
      .select('id, slug, canonical_name, brand, release_date, msrp_cad')
      .eq('id', chipId)
      .maybeSingle(),
    supabase
      .from('entity_attributes')
      .select('attribute_key, attribute_value, attribute_value_num')
      .eq('entity_id', chipId),
    supabase
      .from('canonical_entities')
      .select('id, canonical_name, brand')
      .eq('parent_entity_id', chipId)
      .eq('entity_type', 'gpus')
      .neq('id', boardId)
      .order('id', { ascending: false })
      .limit(8),
    supabase
      .from('canonical_entities')
      .select('id', { count: 'exact', head: true })
      .eq('parent_entity_id', chipId)
      .eq('entity_type', 'gpus'),
  ]);

  if (!chipRes.data) return null;

  // 4. Map sibling new-schema entity_ids back to old canonical_products slugs
  //    via entity_source_mappings. Required because /p/[slug] reads from
  //    canonical_products, not canonical_entities. Best-effort — siblings
  //    without a legacy mapping just don't get rendered as links.
  const siblingEntities = siblingsRes.data ?? [];
  const siblingIds = siblingEntities.map((s) => s.id);
  const slugByEntityId = new Map<number, string>();

  if (siblingIds.length > 0) {
    const { data: mappings } = await supabase
      .from('entity_source_mappings')
      .select('entity_id, external_id')
      .eq('source_id', LEGACY_SOURCE_ID)
      .in('entity_id', siblingIds);

    const externalToEntity = new Map<string, number>();
    for (const m of mappings ?? []) {
      if (!m.external_id) continue;
      externalToEntity.set(m.external_id, m.entity_id);
    }

    if (externalToEntity.size > 0) {
      const oldIds = [...externalToEntity.keys()]
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n));
      if (oldIds.length > 0) {
        const { data: oldRows } = await supabase
          .from('canonical_products')
          .select('id, slug')
          .in('id', oldIds);
        for (const row of oldRows ?? []) {
          const eid = externalToEntity.get(String(row.id));
          if (eid != null) slugByEntityId.set(eid, row.slug);
        }
      }
    }
  }

  const siblings: ChipParentSibling[] = siblingEntities.map((s) => ({
    entityId: s.id,
    legacySlug: slugByEntityId.get(s.id) ?? null,
    name: s.canonical_name,
    brand: s.brand,
  }));

  return {
    id: chipRes.data.id,
    slug: chipRes.data.slug,
    canonicalName: chipRes.data.canonical_name,
    brand: chipRes.data.brand,
    releaseDate: chipRes.data.release_date,
    msrpCad: chipRes.data.msrp_cad ? Number(chipRes.data.msrp_cad) : null,
    attributes: formatAttributes(attrsRes.data ?? []),
    siblings,
    // total boards = siblings count; head:true returns count without rows
    totalBoardCount: totalCountRes.count ?? siblings.length,
  };
}

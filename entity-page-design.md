# `<EntityPage>` extraction — design

Locked 2026-05-03 night. Implements ARCHITECTURE.md §7 (generic entity routing).
This file lives next to ARCHITECTURE.md as the working design for Item 1
of the active queue. Delete or fold into ARCHITECTURE.md once shipped.

---

## Goal

Move the chip-page architecture from one-vertical-one-route to a single
generic data layer + render component, parameterized by `entity_type`.
Adding CPUs / monitors / motherboards becomes: register in
`entity-config.ts`, write a 6-line route file, ship a scraper. No new
frontend code per vertical.

## Proof of correctness

Build `/board/[slug]` on top of the abstraction. Boards
(`entity_type='gpus'`, 1387 rows) live in `canonical_entities` today but
render via legacy `/p/[slug]`. A working `/board/[slug]` proves the
abstraction handles the leaf case (own listings, no children) as
cleanly as the branch case (chip with boards as children).

## Branch vs leaf

| Entity type    | Has children?   | Has own listings? | Renders        |
| -------------- | --------------- | ----------------- | -------------- |
| `gpu_chip`     | Yes (boards)    | No                | `<EntityChildren>` |
| `gpus`         | No              | Yes               | `<EntityListings>` |
| `cpu` (future) | No              | Yes               | `<EntityListings>` |

Determined by `ENTITY_TYPES[type].childEntityType` — non-null ⇒ branch.
A future "series → chip → board" 3-level tree works automatically.

## File layout

```
src/lib/
  entity-config.ts             ENTITY_TYPES, CATEGORIES registries
  entity-slug-helpers.ts       pure helpers (cleanEntitySlug)
  entity-slug.ts               server resolver (resolveEntitySlug)
  queries/
    entity.ts                  getEntityViewModel
    entity-attributes.ts       re-export of chip-attributes (interim)

src/components/entity/         [NEXT SESSION]
  EntityPage.tsx
  EntityBreadcrumbs.tsx
  EntityStats.tsx
  EntityChildren.tsx           extracted from BoardTable
  EntityListings.tsx           new — the leaf case
  EntitySpecs.tsx              extracted from ChipSpecs

src/app/
  chip/[slug]/page.tsx         UNCHANGED THIS SESSION
  board/[slug]/page.tsx        NEW [NEXT SESSION]
```

## Four shippable steps

1. **Data layer** — this session. Net-new files. Live chip page untouched.
   Smoke-test via scratch route (see below).
2. **Render layer + `/board/[slug]`** — next session. Builds
   `EntityPage` etc., mounts on the new board route. Live chip page
   still untouched.
3. **Cutover** — point `app/chip/[slug]/page.tsx` at the new layer.
   Hard-delete the chip-specific modules per Bible Protocol #35:
   `ChipPage.tsx`, `BoardTable.tsx`, `ChipSpecs.tsx`, `chip-slug.ts`,
   `chip-slug-helpers.ts`, `queries/chip.ts`, `queries/chip-attributes.ts`.
4. **First new vertical: CPUs.** Register `cpu` in `entity-config.ts`,
   ship 6-line `app/cpu/[slug]/page.tsx`. Bottleneck moves to scraper +
   catalog source recon.

## Slug resolution

Generalized from `chip-slug.ts`:
- Per-entity-type `cleanSlugBrandPrefixes` list. Chips: NVIDIA/AMD/Intel.
  Boards / CPUs: empty.
- Empty prefix list ⇒ resolver short-circuits after exact match.
- Returns `{ entityId, cleanSlug, needsRedirect }` — same shape as today.

Aggregate confirms (1387 boards, 60.8% with major-vendor prefix in slug):
boards have brand-prefixed names natively (`asus-tuf-rtx-5090-oc`) but
no clean form to strip toward. URL = DB slug for boards.

## Breadcrumbs

Walk `parent_entity_id` bottom-up (max depth 5, cycle-safe). Outermost
ancestor's `entity_type` config determines the category breadcrumb.

| Entity | Walk           | Category | Rendered                                          |
| ------ | -------------- | -------- | ------------------------------------------------- |
| chip   | [self]         | gpus     | Home / Graphics Cards / RTX 5090                  |
| board  | [self, chip]   | gpus     | Home / Graphics Cards / RTX 5090 / ASUS TUF       |
| CPU    | [self]         | cpus     | Home / Processors / Ryzen 7 9700X                 |

Generated server-side; same array consumed by UI breadcrumb and JSON-LD.

## What's NOT changing

- `/c/[slug]` and `/c/[slug]/b/[brand]` continue to read `canonical_products`.
  Migrating those is Phase-0.5 polish, separate from this work.
- `/p/[slug]` continues to serve legacy product pages.
- The 410-or-301 logic for dead URLs (2026-05-02) is unaffected.
- `chip-attributes.ts` is re-exported as `entity-attributes.ts` rather
  than rewritten. Adding CPU specs later = adding keys to the existing
  `ATTRIBUTE_CONFIG`. No new module needed.

## Risks specific to this refactor

- **N+1 on breadcrumb walk.** Each level = 1 query, bounded by
  `MAX_BREADCRUMB_DEPTH=5`. Chips: 0 walks. Boards: 1 walk. Future
  deeper trees: 2-3.
- **PostgREST 1000-row cap (Bible Risk #26).** Children + listings use
  `.in_()`. A chip with 50 boards × ~5 listings = ~250 listings — well
  under cap. Verification queries still use raw SQL aggregation per
  Protocol #41.
- **`parent_entity_id` cycle.** Defended by `MAX_BREADCRUMB_DEPTH`. No
  cycles exist today.
- **Bible-fiction (Risk #30).** Earlier today the bible logged the
  `chip-attributes.ts` path wrong (`src/lib/` vs actual
  `src/lib/queries/`). Fix at end-of-session amend.

## Step 1 smoke test

Create a scratch route that exercises the new query without touching
live pages. Don't ship to prod; delete after verifying.

```tsx
// src/app/_smoke/entity/page.tsx — DELETE before push
import { getEntityViewModel } from '@/lib/queries/entity';
import { resolveEntitySlug } from '@/lib/entity-slug';

export const dynamic = 'force-dynamic';

export default async function SmokePage() {
  // Pick a chip you know has boards + listings, e.g. RTX 5090
  const chipRes = await resolveEntitySlug('rtx-5090', 'gpu_chip');
  const chip = chipRes.entityId
    ? await getEntityViewModel(chipRes.entityId, 'gpu_chip')
    : null;

  // Pick any board id from the sample query you ran
  const boardRes = await resolveEntitySlug('asus-tuf-rtx-5090-oc', 'gpus');
  const board = boardRes.entityId
    ? await getEntityViewModel(boardRes.entityId, 'gpus')
    : null;

  return (
    <pre style={{ padding: 16, fontSize: 11 }}>
      {JSON.stringify({ chipRes, chip, boardRes, board }, null, 2)}
    </pre>
  );
}
```

Visit `/_smoke/entity` locally. Confirm: chip has children populated +
listings empty; board has listings populated + children empty;
breadcrumbs walk correctly for both. Delete the route before commit.

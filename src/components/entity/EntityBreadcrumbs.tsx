import Link from 'next/link';
import type { BreadcrumbItem } from '@/lib/queries/entity';

type Props = { items: BreadcrumbItem[] };

/* ─────────────────────────────────────────────────────────────────────
   EntityBreadcrumbs

   Renders the breadcrumb chain produced by getEntityViewModel. Items
   with href=null render as text (the current page); items with href
   render as Next.js Links with the same hover-color convention as the
   inline breadcrumbs in ChipPage.tsx today.

   Visual parity with ChipPage's inline `<nav>` is preserved so Step 3
   cutover is a no-op visually.
   ───────────────────────────────────────────────────────────────────── */

export default function EntityBreadcrumbs({ items }: Props) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-zinc-500">
      <ol className="flex flex-wrap items-center">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li
              key={`${i}-${item.label}`}
              className="flex items-center"
            >
              {item.href ? (
                <Link
                  href={item.href}
                  className="hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className="text-zinc-700 dark:text-zinc-300"
                >
                  {item.label}
                </span>
              )}
              {!isLast && <span className="mx-2" aria-hidden="true">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

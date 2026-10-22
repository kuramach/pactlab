import Link from 'next/link';
import type { EvidencePager } from './filters';

/** "51–100 of 342" with Previous and Next; an unavailable direction is shown disabled, never hidden. */
export function EvidencePagerNav({ pager, base }: { pager: EvidencePager; base: string }) {
  if (!pager.windowLabel) return null;
  const href = (query: string) => (query ? `${base}?${query}` : base);
  return (
    <nav aria-label="Evidence pages" className="flex flex-wrap items-center gap-4 text-sm">
      <span className="text-muted-foreground" data-numeric>
        {pager.windowLabel}
      </span>
      {pager.previous !== null ? (
        <Link href={href(pager.previous)} className="font-medium hover:underline">
          ← Previous
        </Link>
      ) : (
        <span aria-disabled="true" className="cursor-not-allowed text-muted-foreground/60">
          ← Previous
        </span>
      )}
      {pager.next !== null ? (
        <Link href={href(pager.next)} className="font-medium hover:underline">
          Next →
        </Link>
      ) : (
        <span aria-disabled="true" className="cursor-not-allowed text-muted-foreground/60">
          Next →
        </span>
      )}
    </nav>
  );
}

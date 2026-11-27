import type { DocumentProvenanceView, RinseSetView } from '@pactlab/contracts';
import { formatDate } from '@pactlab/domain';
import { Badge } from '@pactlab/ui';
import Link from 'next/link';

/**
 * Where a document came from when it arrived in a set finished in Pactlab Rinse (T-178d): the canonical
 * copy the pact reads and cites, the seller's original it was converted from (left at the source), and
 * what was checked on the seller's machine. Shown on the document and beside its citations.
 */
const short = (sha: string) => `${sha.slice(0, 12)}…`;
const READ_BY = { TEXT_LAYER: 'its own text layer', VISION: 'its page images' } as const;

/** One line for a citation: whose original this copy reproduces, and how it was checked. */
export function provenanceLine(item: DocumentProvenanceView): string {
  const who = `${item.set.preparedBy.name}, ${item.set.preparedBy.organization}`;
  if (!item.original) return `Carried as it is in Pactlab Rinse by ${who} (${item.canonical.path}).`;
  const audit = item.entry.audit ? `; ${item.entry.audit.figuresMatched} of ${item.entry.audit.figuresCompared} figures matched the original` : '';
  return `Canonical copy of the seller’s original ${item.original.path}, rinsed by ${who}${audit}.`;
}

/** The lines shown on the document: the original, the audit, the checks and the conversion steps. */
export function provenanceDetails(item: DocumentProvenanceView): string[] {
  const lines = [provenanceLine(item)];
  if (item.original) lines.push(`Original SHA-256 ${short(item.original.sha256)} · copy SHA-256 ${short(item.canonical.sha256)}.`);
  const audit = item.entry.audit;
  if (audit) {
    lines.push(`Conversion audit: the original re-read from ${READ_BY[audit.originalReadBy]}; pages ${audit.pages.original} → ${audit.pages.converted}, tables ${audit.tables.original} → ${audit.tables.converted}.`);
    for (const mismatch of audit.mismatches) lines.push(`Resolved before upload (${mismatch.resolution.toLowerCase()}): ${mismatch.label}.`);
    for (const discrepancy of audit.sourceDiscrepancies) lines.push(`The original does not foot: ${discrepancy.label} on page ${discrepancy.page} states ${discrepancy.stated}; its lines sum to ${discrepancy.computed}.`);
  }
  const flagged = item.entry.checks.filter((check) => check.severity !== 'INFO');
  for (const check of flagged) lines.push(`${check.severity === 'ERROR' ? 'Resolved' : 'Noted'}: ${check.message}`);
  if (item.entry.conversionLog.length) lines.push(`Steps: ${item.entry.conversionLog.map((step) => `${step.step.toLowerCase().replace(/_/g, ' ')} (${step.tool})`).join(', ')}.`);
  return lines;
}

export function RinseProvenance({ items }: { items: readonly DocumentProvenanceView[] }) {
  const item = items[0];
  if (!item) return null;
  return (
    <section aria-label="Where this document came from" className="mb-4 flex flex-col gap-1 rounded-md border border-border px-3 py-2 text-xs">
      <span className="flex flex-wrap items-center gap-2">
        <Badge variant="reviewed">Pactlab Rinse</Badge>
        <span className="text-muted-foreground">
          {item.set.name} · {item.set.origin === 'ARCHIVE' ? 'imported once as a zip' : 'read from a connected folder'} · ready {formatDate(item.set.readyAt)}
        </span>
      </span>
      {provenanceDetails(item).map((line) => (
        <span key={line}>{line}</span>
      ))}
    </section>
  );
}

const GAP_STATE = { PRESENT: 'Present', PRESENT_FLAGGED: 'Present, flagged', HAND_SOURCED: 'Hand-sourced', NOT_APPLICABLE: 'Not applicable', NOTED: 'Noted', MISSING: 'Missing' } as const;

/** The sets that reached the pact: the seller's gap notes, and the originals that do not foot, with their drafts. */
export function RinseSets({ dealId, sets }: { dealId: string; sets: readonly RinseSetView[] }) {
  if (sets.length === 0) return <p className="text-sm text-muted-foreground">No set finished in Pactlab Rinse has reached this pact yet.</p>;
  return (
    <ul className="flex flex-col gap-4 text-sm" aria-label="Sets finished in Pactlab Rinse">
      {sets.map((set) => (
        <li key={set.id} className="flex flex-col gap-1">
          <span className="font-medium">
            {set.name} <span className="font-normal text-muted-foreground">by {set.preparedBy.name}, {set.preparedBy.organization} · {set.documents} documents · {set.origin === 'ARCHIVE' ? 'zip import' : 'connected folder'}</span>
          </span>
          {set.gaps
            .filter((gap) => gap.state === 'NOTED' || gap.state === 'NOT_APPLICABLE' || gap.state === 'HAND_SOURCED')
            .map((gap) => (
              <span key={gap.input}>
                {gap.label}: {GAP_STATE[gap.state].toLowerCase()}
                {gap.note ? <span className="text-muted-foreground"> — “{gap.note}”</span> : null}
              </span>
            ))}
          {set.sourceDiscrepancies.map((item) => (
            <span key={`${item.manifestDocumentId}-${item.label}-${item.page}`}>
              {item.title} doesn’t add up in the seller’s own original: {item.label} on page {item.page} says {item.stated}, its lines sum to {item.computed}.{' '}
              {item.findingId ? (
                <Link className="underline" href={`/deals/${dealId}/findings/${item.findingId}`}>
                  Draft finding for review
                </Link>
              ) : (
                <span className="text-muted-foreground">Becomes a draft finding when the deal team reads the set.</span>
              )}
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}

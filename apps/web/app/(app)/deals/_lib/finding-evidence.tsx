import type { FindingEvidenceLink } from '@pactlab/domain';
import { Badge } from '@pactlab/ui';
import Link from 'next/link';
import { EN, type I18n } from '../../../../lib/i18n';
import { withReturn } from './return-to';

/**
 * One citation of a finding: an evidence record (opens its lineage, returning
 * here) or a quote from a document page (T-058) — page number and the exact
 * quote, so a reviewer can check it against the document.
 */
export function FindingEvidenceChip({ link, dealId, from, label, t = EN }: { link: FindingEvidenceLink; dealId: string; from: string; label?: string; t?: I18n }) {
  if (link.documentCitation) {
    const quote = link.documentCitation.quote;
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <Link href={`/deals/${dealId}/documents`} className="hover:underline">
          <Badge variant="evidence">{t.fill(t.m.common.evidence.documentPage, { page: link.documentCitation.pageNumber })}</Badge>
        </Link>
        <q className="text-xs text-slate-text" title={quote}>
          {quote.length > 90 ? `${quote.slice(0, 90)}…` : quote}
        </q>
      </span>
    );
  }
  if (!link.evidenceItemId) return null;
  return (
    <Link href={withReturn(`/deals/${dealId}/evidence/${link.evidenceItemId}`, from)} className="hover:underline">
      <Badge variant="evidence">{label ?? t.m.common.evidence.record}</Badge>
    </Link>
  );
}

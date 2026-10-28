'use client';

import { Badge, Button } from '@pactlab/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { citationHref, type DocumentFindingItem } from '../../../documents/_lib/view';
import { decideDocumentFinding } from './actions';

export type QueueFilter = 'ALL' | 'DRAFT' | 'ACCEPTED' | 'REJECTED';

export interface Override {
  status: DocumentFindingItem['status'];
  rationale: string;
  saving: boolean;
}

/**
 * The queue as the reviewer sees it: the server's findings with any decision
 * still in flight shown on top. Once the server reports a decided status, it
 * wins and the override is ignored.
 */
export function mergeQueue(findings: readonly DocumentFindingItem[], overrides: Readonly<Record<string, Override>>): (DocumentFindingItem & { saving: boolean })[] {
  return findings.map((finding) => {
    const override = overrides[finding.id];
    return override && finding.status === 'DRAFT'
      ? { ...finding, status: override.status, decisionRationale: override.rationale, saving: override.saving }
      : { ...finding, saving: false };
  });
}

/** Counts for the queue header, after any in-flight decisions. */
export function queueCounts(items: readonly Pick<DocumentFindingItem, 'status'>[]): Record<QueueFilter, number> {
  return {
    ALL: items.length,
    DRAFT: items.filter((item) => item.status === 'DRAFT').length,
    ACCEPTED: items.filter((item) => item.status === 'ACCEPTED').length,
    REJECTED: items.filter((item) => item.status === 'REJECTED').length,
  };
}

const FILTERS: readonly { value: QueueFilter; label: string }[] = [
  { value: 'DRAFT', label: 'Pending' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'ALL', label: 'All' },
];

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/**
 * The document review queue (T-094 B4, B6). Accept and Reject act in place:
 * the card shows the decision at once, the server confirms it, and a refused
 * decision rolls back with the reason on that card. Nothing reloads, so the
 * reviewer keeps their place. The header counts update live and filter the
 * list; decided items stay in the list and can be re-read.
 */
export function ReviewQueue({
  dealId,
  findings,
  reviewer,
  reviewerName,
  openPage = null,
}: {
  dealId: string;
  findings: readonly DocumentFindingItem[];
  reviewer: boolean;
  reviewerName: string;
  /** The page open in the document pane, so findings quoted there are marked. */
  openPage?: { documentId: string; pageNumber: number } | null;
}) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [filter, setFilter] = useState<QueueFilter>('ALL');
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const items = mergeQueue(findings, overrides);
  const counts = queueCounts(items);
  const shown = filter === 'ALL' ? items : items.filter((item) => item.status === filter);

  const decide = async (finding: DocumentFindingItem, decision: 'ACCEPT' | 'REJECT') => {
    const rationale = (drafts[finding.id] ?? '').trim();
    if (rationale.length < 3) {
      setErrors((current) => ({ ...current, [finding.id]: 'Write a short rationale (a few words) for the decision.' }));
      return;
    }
    setErrors(({ [finding.id]: _cleared, ...rest }) => rest);
    setOverrides((current) => ({ ...current, [finding.id]: { status: decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED', rationale, saving: true } }));
    let result: Awaited<ReturnType<typeof decideDocumentFinding>>;
    try {
      result = await decideDocumentFinding(dealId, finding.id, { decision, rationale, expectedVersion: finding.version });
    } catch {
      result = { kind: 'error', message: 'The decision was not saved. Try again.' };
    }
    if (result.kind === 'ok') {
      setOverrides((current) => ({ ...current, [finding.id]: { status: decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED', rationale, saving: false } }));
    } else {
      setOverrides(({ [finding.id]: _rolledBack, ...rest }) => rest);
      setErrors((current) => ({ ...current, [finding.id]: result.message }));
    }
    startRefresh(() => router.refresh());
  };

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Filter the review queue" className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-2 bg-card px-1 py-2">
        {FILTERS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            aria-pressed={filter === entry.value}
            onClick={() => setFilter(entry.value)}
            className={`rounded-full border px-3 py-1 text-sm ${filter === entry.value ? 'border-primary bg-muted font-semibold' : 'border-border'}`}
          >
            {entry.label} <span aria-label={`${counts[entry.value]} ${entry.label.toLowerCase()}`}>{counts[entry.value]}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? <p className="text-sm text-muted-foreground">No {filter === 'ALL' ? '' : FILTERS.find((entry) => entry.value === filter)?.label.toLowerCase()} findings.</p> : null}

      {shown.map((finding) => (
        <article key={finding.id} aria-label={finding.title} className="flex flex-col gap-2 border-b border-border pb-4 last:border-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={finding.status === 'DRAFT' ? 'draft' : finding.status === 'ACCEPTED' ? 'reviewed' : 'neutral'}>
              {finding.status === 'DRAFT' ? 'AI draft' : finding.status === 'ACCEPTED' ? 'Accepted' : 'Rejected'}
              {finding.saving ? ' · saving…' : ''}
            </Badge>
            <Badge variant={finding.severity === 'HIGH' || finding.severity === 'CRITICAL' ? 'danger' : 'neutral'}>{finding.severity}</Badge>
            <h2 className="font-medium">{finding.title}</h2>
            {openPage && finding.citations.some((c) => c.documentId === openPage.documentId && c.pageNumber === openPage.pageNumber) ? (
              <Badge variant="evidence">Quoted on the open page</Badge>
            ) : null}
          </div>
          <p className="text-sm">{finding.summary}</p>
          <div className="flex flex-wrap gap-2">
            {finding.citations.map((citation) => (
              <Link key={citation.citationId} href={citationHref(dealId, citation)} scroll={false} title={`“${citation.quote}”`}>
                <Badge variant="evidence">Show on page {citation.pageNumber}</Badge>
              </Link>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Model-generated · {finding.provenance.promptId} v{finding.provenance.promptVersion} · {finding.provenance.resolvedModelId}
            {finding.status === 'DRAFT' ? ' · awaiting human review' : null}
          </p>
          {finding.status !== 'DRAFT' ? (
            <p className="rounded-lg border border-navy/10 bg-mist px-3 py-2 text-xs">
              <span className="font-semibold">
                {finding.status === 'ACCEPTED' ? 'Accepted' : 'Rejected'} by {finding.reviewer?.displayName ?? reviewerName}
                {finding.decidedAt ? ` on ${finding.decidedAt.slice(0, 10)}` : ''}
              </span>
              {finding.decisionRationale ? <>: “{finding.decisionRationale}”</> : null}
            </p>
          ) : null}
          {finding.status === 'ACCEPTED' && !finding.saving ? (
            <Link href={`/deals/${dealId}/findings?source=document-review`} className="text-xs font-semibold text-indigo-ink hover:underline">
              In the findings register — decide its valuation direction and price →
            </Link>
          ) : null}
          {errors[finding.id] ? (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {errors[finding.id]}
            </p>
          ) : null}
          {finding.status === 'DRAFT' && reviewer ? (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-xs font-semibold">
                Reason for your decision <span className="font-normal text-muted-foreground">Required · saved in the audit trail with your name</span>
                <textarea
                  value={drafts[finding.id] ?? ''}
                  onChange={(event) => setDrafts((current) => ({ ...current, [finding.id]: event.target.value }))}
                  rows={2}
                  placeholder="Accepting: what did you confirm in the document? e.g. “Clause 14 on p. 2 matches; termination needs 30 days’ notice.” Rejecting: why is it wrong or not relevant? e.g. “Clause was deleted in the 2025 amendment.”"
                  className={`${inputClass} font-normal`}
                />
              </label>
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={() => void decide(finding, 'ACCEPT')}>
                  Accept
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => void decide(finding, 'REJECT')}>
                  Reject
                </Button>
              </div>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

'use client';

import { Badge, Button } from '@pactlab/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CopyButton } from '../../../_lib/copy-button';
import { citationHref } from '../../../documents/_lib/view';
import { categorizeDocument, requestFromSeller } from './actions';
import { sortDocument } from './sorting';

export interface ChecklistItemView {
  readonly id: string;
  readonly label: string;
  readonly need: 'REQUIRED' | 'OPTIONAL';
  readonly state: 'RECEIVED' | 'PARTIAL' | 'CONNECTED' | 'MISSING';
  readonly documentIds: readonly string[];
  readonly connections: readonly string[];
  readonly connectable: readonly string[];
  readonly missingFor: readonly string[];
}

export interface NeedsYouView {
  readonly documentId: string;
  readonly fileName: string;
  readonly state: 'NEEDS_YOU' | 'NOT_READ';
  readonly category: string | null;
  readonly question: string | null;
  readonly reason: string | null;
  readonly confidence: number | null;
}

export interface IntakeView {
  readonly pack: { readonly id: string; readonly label: string };
  readonly checklist: readonly ChecklistItemView[];
  readonly request: string;
  readonly needsYou: readonly NeedsYouView[];
  readonly unclassified: readonly string[];
  readonly refiled: readonly {
    readonly documentId: string;
    readonly fileName: string;
    readonly from: string;
    readonly to: string | null;
    readonly recheck: { readonly draftFindings: number; readonly acceptedFindings: number; readonly balanceSheetItems: number };
  }[];
  readonly removedAtSource: readonly { readonly documentId: string; readonly fileName: string }[];
  readonly categories: readonly { readonly id: string; readonly label: string; readonly route: string }[];
}

const PROVIDER_LABEL: Readonly<Record<string, string>> = { github: 'GitHub', jira: 'Jira', stripe: 'Stripe' };
const provider = (id: string) => PROVIDER_LABEL[id] ?? id;

const STATE: Record<ChecklistItemView['state'], { label: string; tone: 'reviewed' | 'calculation' | 'draft' | 'neutral' }> = {
  RECEIVED: { label: 'Received', tone: 'reviewed' },
  PARTIAL: { label: 'Some missing', tone: 'draft' },
  CONNECTED: { label: 'Connected', tone: 'calculation' },
  MISSING: { label: 'Missing', tone: 'draft' },
};

/**
 * Intake (T-098): what this pact expects and whether each is received,
 * connected or missing; the files the AI was unsure about, each with its
 * question and a one-click answer; and the request list for what is
 * missing, ready to send to the counterparty.
 */
export function IntakePanel({ dealId, intake, writer, aiOn, hasSeller }: { dealId: string; intake: IntakeView; writer: boolean; aiOn: boolean; hasSeller: boolean }) {
  const router = useRouter();
  const missingRequired = intake.checklist.filter((item) => (item.state === 'MISSING' || item.state === 'PARTIAL') && item.need === 'REQUIRED').length;
  const missing = intake.checklist.filter((item) => item.state === 'MISSING' || item.state === 'PARTIAL');
  const [sorting, setSorting] = useState<number | null>(null);
  const started = useRef(new Set<string>());

  // New files from the seller (or earlier uploads) are sorted as soon as a buyer opens the page.
  useEffect(() => {
    if (!aiOn || !writer) return;
    const waiting = intake.unclassified.filter((id) => !started.current.has(id));
    if (waiting.length === 0) return;
    waiting.forEach((id) => started.current.add(id));
    void (async () => {
      setSorting(waiting.length);
      for (const [index, id] of waiting.entries()) {
        await sortDocument(dealId, id);
        setSorting(waiting.length - index - 1);
      }
      setSorting(null);
      router.refresh();
    })();
  }, [aiOn, writer, dealId, intake.unclassified, router]);

  return (
    <div className="flex flex-col gap-4 text-sm">
      {sorting !== null ? (
        <p role="status" className="text-xs text-muted-foreground">
          Sorting new files… {sorting} to go.
        </p>
      ) : null}

      {intake.refiled.length > 0 ? (
        <section aria-labelledby="refiled" className="flex flex-col gap-1 rounded-md border border-border p-3">
          <h3 id="refiled" className="font-semibold">
            Re-filed — check what was built from these
          </h3>
          <ul className="flex flex-col gap-1">
            {intake.refiled.map((entry) => (
              <li key={entry.documentId}>
                <Link href={citationHref(dealId, { documentId: entry.documentId, pageNumber: 1 })} scroll={false} className="font-medium hover:underline">
                  {entry.fileName}
                </Link>{' '}
                moved from {entry.from.toLowerCase()} to {entry.to?.toLowerCase() ?? 'unsorted'}:{' '}
                {[
                  entry.recheck.draftFindings ? `${entry.recheck.draftFindings} draft(s) in the review queue` : null,
                  entry.recheck.acceptedFindings ? `${entry.recheck.acceptedFindings} accepted finding(s)` : null,
                  entry.recheck.balanceSheetItems ? `${entry.recheck.balanceSheetItems} balance-sheet line(s) on Valuation` : null,
                ]
                  .filter(Boolean)
                  .join(', ')}
                .
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {intake.removedAtSource.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Removed from the data room since it was read (kept here, with everything built from it):{' '}
          {intake.removedAtSource.map((entry) => entry.fileName).join(', ')}.
        </p>
      ) : null}

      {intake.needsYou.length > 0 ? (
        <section aria-labelledby="needs-you" className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50/60 p-3">
          <h3 id="needs-you" className="font-semibold">
            Pactlab needs you · {intake.needsYou.length} file{intake.needsYou.length === 1 ? '' : 's'}
          </h3>
          <ul className="flex flex-col divide-y divide-amber-200">
            {intake.needsYou.map((item) => (
              <NeedsYouRow key={item.documentId} dealId={dealId} item={item} categories={intake.categories} writer={writer} />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="checklist" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="checklist" className="font-semibold">
            What this {intake.pack.label} pact needs
            {missingRequired > 0 ? <span className="ml-2 font-normal text-muted-foreground">{missingRequired} required item(s) missing</span> : null}
          </h3>
          {missing.length > 0 ? (
            <span className="flex flex-wrap items-center gap-2">
              {writer && hasSeller ? <RequestButton dealId={dealId} items={missing.map((item) => item.id)} /> : null}
              <CopyButton text={intake.request} label="Copy request for missing items" />
            </span>
          ) : null}
        </div>
        <ul className="grid gap-1 sm:grid-cols-2">
          {intake.checklist.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
              <span>
                {item.label}
                {item.need === 'OPTIONAL' ? <span className="ml-1 text-xs text-muted-foreground">(if available)</span> : null}
              </span>
              <span className="flex items-center gap-2 text-xs">
                {item.state === 'RECEIVED' && item.documentIds[0] ? (
                  <Link href={citationHref(dealId, { documentId: item.documentIds[0], pageNumber: 1 })} scroll={false} className="text-muted-foreground hover:underline">
                    {item.documentIds.length} file{item.documentIds.length === 1 ? '' : 's'}
                  </Link>
                ) : null}
                {item.state === 'CONNECTED' ? <span className="text-muted-foreground">{item.connections.map(provider).join(', ')}</span> : null}
                {item.missingFor.length > 0 ? (
                  <span className="text-muted-foreground" title={item.missingFor.join(', ')}>
                    none yet for {item.missingFor.slice(0, 3).join(', ')}
                    {item.missingFor.length > 3 ? ` +${item.missingFor.length - 3} more` : ''}
                  </span>
                ) : null}
                {item.state === 'MISSING' && item.connectable.length > 0 ? (
                  <Link href={`/deals/${dealId}/sources`} className="text-indigo-ink hover:underline">
                    Connect {item.connectable.map(provider).join(' or ')}, or upload
                  </Link>
                ) : null}
                <Badge variant={STATE[item.state].tone}>{STATE[item.state].label}</Badge>
              </span>
            </li>
          ))}
        </ul>
        {intake.unclassified.length > 0 && !aiOn ? (
          <p className="text-xs text-muted-foreground">{intake.unclassified.length} file(s) are not sorted yet; Pactlab sorts them once AI is switched on.</p>
        ) : null}
      </section>
    </div>
  );
}

function NeedsYouRow({ dealId, item, categories, writer }: { dealId: string; item: NeedsYouView; categories: IntakeView['categories']; writer: boolean }) {
  const router = useRouter();
  const [category, setCategory] = useState(item.category ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const file = async () => {
    setSaving(true);
    setError(null);
    const result = await categorizeDocument(dealId, item.documentId, category).catch(() => ({ kind: 'error' as const, message: 'The answer was not saved. Try again.' }));
    setSaving(false);
    if (result.kind === 'error') setError(result.message);
    else router.refresh();
  };

  return (
    <li className="flex flex-col gap-2 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href={citationHref(dealId, { documentId: item.documentId, pageNumber: 1 })} scroll={false} className="font-medium hover:underline">
          {item.fileName}
        </Link>
        {item.confidence !== null && item.category ? (
          <span className="text-xs text-muted-foreground">AI’s best guess: {categories.find((c) => c.id === item.category)?.label ?? item.category} ({Math.round(item.confidence * 100)}% sure)</span>
        ) : null}
      </div>
      <p>{item.question}</p>
      {item.reason ? <p className="text-xs text-muted-foreground">Why: {item.reason}</p> : null}
      {writer ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-label={`What is ${item.fileName}?`}
            className="rounded-md border border-border bg-background px-2 py-1"
          >
            <option value="" disabled>
              Choose what this file is…
            </option>
            {categories.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <Button type="button" size="sm" disabled={!category || saving} onClick={() => void file()}>
            {saving ? 'Saving…' : 'File it'}
          </Button>
          {error ? <span className="text-xs text-red-700">{error}</span> : null}
        </div>
      ) : null}
    </li>
  );
}

function RequestButton({ dealId, items }: { dealId: string; items: readonly string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  if (state === 'sent') return <span className="text-xs text-muted-foreground">Request sent to the seller.</span>;
  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        Ask the seller
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Note for the seller (optional)" aria-label="Note for the seller" className="w-64 rounded-md border border-border bg-background px-2 py-1 text-xs" />
      <Button
        type="button"
        size="sm"
        disabled={state === 'sending'}
        onClick={() => {
          setState('sending');
          void requestFromSeller(dealId, items, note).then((result) => {
            if (result.kind === 'error') {
              setError(result.message);
              setState('idle');
            } else {
              setState('sent');
              router.refresh();
            }
          });
        }}
      >
        {state === 'sending' ? 'Sending…' : `Send request (${items.length} item${items.length === 1 ? '' : 's'})`}
      </Button>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </span>
  );
}

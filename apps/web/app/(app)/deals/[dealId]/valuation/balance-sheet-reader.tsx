'use client';

import type { BalanceSheetProposalsView } from '@pactlab/contracts';
import { Badge, Button } from '@pactlab/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { confirmBalanceSheetProposal, readBalanceSheet } from './balance-sheet-actions';

const KIND_LABEL = { CASH: 'Cash', DEBT: 'Debt', DEBT_LIKE: 'Debt-like' } as const;

/**
 * Read an uploaded balance sheet (T-094 B9): pick the document, review each
 * line Pactlab found, and confirm the ones that belong in the bridge. A
 * proposal is not stored and never touches the valuation until confirmed;
 * typing an item by hand stays available below.
 */
export function BalanceSheetReader({ dealId, documents, currency }: { dealId: string; documents: readonly { id: string; fileName: string }[]; currency: string }) {
  const router = useRouter();
  const guess = documents.find((doc) => /balance|financ|accounts/i.test(doc.fileName)) ?? documents[0];
  const [documentId, setDocumentId] = useState(guess?.id ?? '');
  const [view, setView] = useState<BalanceSheetProposalsView | null>(null);
  const [asOf, setAsOf] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Record<number, { amount: string; state: 'open' | 'saving' | 'saved' | 'error'; note?: string }>>({});

  const read = async () => {
    setBusy(true);
    setMessage(null);
    const result = await readBalanceSheet(dealId, documentId);
    setBusy(false);
    if (!result.ok) return setMessage(result.message);
    setView(result.view);
    setAsOf(result.view.asOf ?? '');
    setRows(Object.fromEntries(result.view.proposals.map((proposal, index) => [index, { amount: proposal.amount, state: 'open' as const }])));
    if (result.view.proposals.length === 0) setMessage(result.view.alreadyRecorded > 0 ? 'Every cash and debt line in this document is already recorded.' : 'No cash, debt or debt-like lines were found. Add items by hand below.');
  };

  const confirm = async (index: number) => {
    const proposal = view?.proposals[index];
    const row = rows[index];
    if (!proposal || !row) return;
    setRows((current) => ({ ...current, [index]: { ...row, state: 'saving' } }));
    const result = await confirmBalanceSheetProposal(dealId, documentId, {
      kind: proposal.kind,
      category: proposal.category,
      label: proposal.label,
      amount: row.amount,
      currency: proposal.currency ?? currency,
      asOf,
      pageNumber: String(proposal.pageNumber),
      quote: proposal.quote,
      ...(proposal.lender ? { lender: proposal.lender } : {}),
    });
    setRows((current) => ({ ...current, [index]: { ...row, state: result.ok ? 'saved' : 'error', ...(result.ok ? {} : { note: result.message }) } }));
    if (result.ok) router.refresh();
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-navy/15 p-4 text-sm">
      <p className="font-bold">Read a balance sheet</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Uploaded document</span>
          <select value={documentId} onChange={(event) => setDocumentId(event.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5">
            {documents.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.fileName}
              </option>
            ))}
          </select>
        </label>
        <Button type="button" size="sm" variant="outline" disabled={busy || !documentId} onClick={() => void read()}>
          {busy ? 'Reading…' : 'Find cash and debt lines'}
        </Button>
      </div>
      {message ? <p className="text-muted-foreground">{message}</p> : null}
      {view && view.proposals.length > 0 ? (
        <>
          <label className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Balance sheet date</span>
            <input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} className="rounded-md border border-border bg-background px-2 py-1" />
          </label>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border" aria-label="Lines found">
            {view.proposals.map((proposal, index) => {
              const row = rows[index];
              return (
                <li key={`${proposal.pageNumber}:${proposal.quote}`} className="flex flex-col gap-2 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{KIND_LABEL[proposal.kind]}</Badge>
                    <span className="font-medium">{proposal.label}</span>
                    <span className="text-muted-foreground">page {proposal.pageNumber}</span>
                  </div>
                  <q className="text-xs text-muted-foreground">{proposal.quote}</q>
                  {row?.state === 'saved' ? (
                    <Badge variant="reviewed">Recorded — now on the bridge</Badge>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-1">
                        <span className="text-xs">{proposal.currency ?? currency}</span>
                        <input
                          value={row?.amount ?? proposal.amount}
                          onChange={(event) => setRows((current) => ({ ...current, [index]: { amount: event.target.value, state: 'open' } }))}
                          inputMode="decimal"
                          aria-label={`Amount for ${proposal.label}`}
                          className="w-36 rounded-md border border-border bg-background px-2 py-1 tabular-nums"
                        />
                      </label>
                      <Button type="button" size="sm" disabled={row?.state === 'saving' || !asOf} onClick={() => void confirm(index)}>
                        {row?.state === 'saving' ? 'Recording…' : 'Confirm'}
                      </Button>
                      {!asOf ? <span className="text-xs text-muted-foreground">Set the balance sheet date first.</span> : null}
                    </div>
                  )}
                  {row?.note ? <p className="text-xs text-red-700">{row.note}</p> : null}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">Nothing here is recorded or reaches the valuation until you confirm it. Unconfirmed lines are simply not used.</p>
        </>
      ) : null}
    </div>
  );
}

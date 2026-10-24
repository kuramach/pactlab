'use client';

import { BALANCE_SHEET_CATEGORIES, type BalanceSheetItemView } from '@pactlab/contracts';
import { Button } from '@pactlab/ui';
import { useActionState, useState, useTransition } from 'react';
import { loadPageText } from './balance-sheet-actions';
import { CATEGORY_LABELS, EMPTY_ITEM_FORM, KIND_LABELS, type ItemFormState } from './balance-sheet-form-state';

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
const errorClass = 'border-red-500 ring-1 ring-red-500';

/**
 * Record or revise a cash, debt or debt-like item. A refused save keeps every
 * typed value and marks the field to fix; "Show page text" lists the page's
 * lines so the exact quote is picked, not retyped.
 */
export function BalanceSheetItemForm({
  action,
  dealId,
  documents,
  currency,
  item,
  submitLabel,
}: {
  action: (state: ItemFormState, data: FormData) => Promise<ItemFormState>;
  dealId: string;
  documents: readonly { id: string; fileName: string; pageCount: number }[];
  currency: string;
  item?: BalanceSheetItemView;
  submitLabel: string;
}) {
  const [state, formAction, saving] = useActionState(action, EMPTY_ITEM_FORM);
  const value = (field: string, fallback: string) => state.values?.[field] ?? fallback;
  const [documentId, setDocumentId] = useState(value('documentId', item?.citation.documentId ?? ''));
  const [pageNumber, setPageNumber] = useState(value('pageNumber', String(item?.citation.pageNumber ?? 1)));
  const [quote, setQuote] = useState(value('quote', item?.citation.quote ?? ''));
  const [lines, setLines] = useState<string[] | null>(null);
  const [pageMessage, setPageMessage] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const bad = (field: string) => (state.error?.field === field ? errorClass : '');

  const showPage = () =>
    startLoading(async () => {
      const result = await loadPageText(dealId, documentId, Number(pageNumber));
      if (!result.ok) {
        setLines(null);
        setPageMessage(result.message);
        return;
      }
      setPageMessage(null);
      setLines(result.text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length >= 12));
    });

  return (
    // Remount on each refusal so inputs show the values that were sent.
    <form key={JSON.stringify(state.values)} action={formAction} className="mt-3 grid gap-3 sm:grid-cols-2">
      {state.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 sm:col-span-2">
          Not saved. {state.error.message}
        </p>
      ) : null}
      {item ? (
        <input type="hidden" name="expectedVersion" value={item.version} />
      ) : (
        <label className="flex flex-col gap-1 text-sm font-medium">
          Kind
          <select name="kind" className={`${inputClass} ${bad('kind')}`} defaultValue={value('kind', 'DEBT')}>
            <option value="CASH">Cash — adds to equity value</option>
            <option value="DEBT">Debt — reduces equity value</option>
            <option value="DEBT_LIKE">Debt-like — reduces equity value</option>
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm font-medium">
        Category
        <select name="category" required className={`${inputClass} ${bad('category')}`} defaultValue={value('category', item?.category ?? 'TERM_LOAN')}>
          {(Object.keys(BALANCE_SHEET_CATEGORIES) as (keyof typeof BALANCE_SHEET_CATEGORIES)[])
            .filter((kind) => !item || kind === item.kind)
            .map((kind) => (
              <optgroup key={kind} label={KIND_LABELS[kind]}>
                {BALANCE_SHEET_CATEGORIES[kind].map((category) => (
                  <option key={category} value={category}>
                    {CATEGORY_LABELS[category]}
                  </option>
                ))}
              </optgroup>
            ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Label
        <input name="label" required maxLength={200} defaultValue={value('label', item?.label ?? '')} placeholder="e.g. Term loan — Lakeside Bank" className={`${inputClass} ${bad('label')}`} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Amount
        <input name="amount" required inputMode="decimal" defaultValue={value('amount', item?.amount ?? '')} placeholder="e.g. 450000 or 450,000.00" className={`${inputClass} ${bad('amount')}`} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Currency
        <input name="currency" required defaultValue={value('currency', item?.currency ?? currency)} className={`${inputClass} ${bad('currency')}`} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        As of
        <input name="asOf" type="date" required defaultValue={value('asOf', item?.asOf ?? '')} className={`${inputClass} ${bad('asOf')}`} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Note
        <input name="note" maxLength={1000} defaultValue={value('note', item?.note ?? '')} className={`${inputClass} ${bad('note')}`} />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Document
        <select name="documentId" required className={`${inputClass} ${bad('documentId')}`} value={documentId} onChange={(event) => setDocumentId(event.target.value)}>
          <option value="" disabled>
            Choose…
          </option>
          {documents.map((doc) => (
            <option key={doc.id} value={doc.id}>
              {doc.fileName} ({doc.pageCount} pp)
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Page
        <span className="flex gap-2">
          <input name="pageNumber" type="number" min={1} required value={pageNumber} onChange={(event) => setPageNumber(event.target.value)} className={`${inputClass} ${bad('pageNumber')}`} />
          <Button type="button" size="sm" variant="outline" onClick={showPage} disabled={!documentId || loading}>
            {loading ? 'Loading…' : 'Show page text'}
          </Button>
        </span>
      </label>
      {pageMessage ? <p className="text-sm text-muted-foreground sm:col-span-2">{pageMessage}</p> : null}
      {lines ? (
        <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2 text-sm sm:col-span-2">
          <span className="text-xs text-muted-foreground">Pick the line that states the figure:</span>
          {lines.map((line, index) => (
            <button
              key={`${index}-${line}`}
              type="button"
              onClick={() => setQuote(line)}
              className={`rounded px-2 py-1 text-left hover:bg-muted ${quote === line ? 'bg-indigo/10 font-semibold' : ''}`}
            >
              {line}
            </button>
          ))}
        </div>
      ) : null}
      <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
        Exact quote from the page
        <input
          name="quote"
          required
          minLength={12}
          maxLength={600}
          value={quote}
          onChange={(event) => setQuote(event.target.value)}
          placeholder="e.g. Term loan outstanding: USD 120,000 — or pick it with “Show page text”"
          className={`${inputClass} ${bad('quote')}`}
        />
      </label>
      {item ? (
        <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
          Why it changed
          <input name="reason" required minLength={3} maxLength={1000} defaultValue={value('reason', '')} className={`${inputClass} ${bad('reason')}`} />
        </label>
      ) : null}
      <div>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

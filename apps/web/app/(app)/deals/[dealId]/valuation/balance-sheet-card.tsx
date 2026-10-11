import { BALANCE_SHEET_CATEGORIES, type BalanceSheetItemView, type BalanceSheetView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Glossed, IconTile } from '@pactlab/ui';
import { Landmark } from 'lucide-react';
import Link from 'next/link';
import { citationHref } from '../../../documents/_lib/view';
import { formatMoney } from '../../../metrics/_lib/format';
import { DonutChart, CHART_COLORS } from '../../../_lib/charts';
import { addBalanceSheetItem, reviseBalanceSheetItem, withdrawBalanceSheetItem } from './balance-sheet-actions';

export const BALANCE_SHEET_OUTCOMES: Readonly<Record<string, string>> = {
  'ok-item': 'Item recorded with its citation. Link it to a scenario and re-run.',
  'ok-item-revised': 'Item revised. Scenarios that use it are stale until re-run.',
  'ok-item-withdrawn': 'Item withdrawn. Scenarios that used it need editing.',
  'item-citation': 'The quote was not found on that page (or the document is people data or unavailable). Copy the exact words from the page.',
  'item-invalid-quote': 'Quote at least a few words exactly as they appear on the page.',
  'item-invalid-amount': 'Enter the amount as a number, such as 120000.',
  'item-invalid-category': 'That category does not belong to the kind of item.',
  'item-invalid-reason': 'Say why, in a few words.',
  'item-invalid-documentId': 'Choose the document the figure comes from.',
  'item-invalid-form': 'Complete the item: kind, category, label, amount, date, document, page and quote.',
};

export const KIND_LABELS = { CASH: 'Cash', DEBT: 'Debt', DEBT_LIKE: 'Debt-like' } as const;

export const CATEGORY_LABELS: Record<string, string> = {
  CASH: 'Cash',
  TERM_LOAN: 'Term loan',
  REVOLVER: 'Revolving credit',
  SHAREHOLDER_LOAN: 'Shareholder loan',
  CONVERTIBLE_NOTE: 'Convertible note',
  OTHER_DEBT: 'Other debt',
  DEFERRED_REVENUE: 'Deferred revenue',
  UNPAID_TAX: 'Unpaid tax',
  ACCRUED_BONUS: 'Accrued bonuses',
  EARN_OUT: 'Earn-out from past acquisitions',
  LEASE: 'Leases',
  CUSTOMER_PREPAYMENT: 'Customer prepayments',
  TRANSACTION_COSTS: 'Seller’s transaction costs',
  OTHER_DEBT_LIKE: 'Other debt-like item',
};

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

function SourceFields({ view, item }: { view: BalanceSheetView; item?: BalanceSheetItemView }) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Document
        <select name="documentId" required className={inputClass} defaultValue={item?.citation.documentId ?? ''}>
          <option value="" disabled>
            Choose…
          </option>
          {view.documents.map((doc) => (
            <option key={doc.id} value={doc.id}>
              {doc.fileName} ({doc.pageCount} pp)
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Page
        <input name="pageNumber" type="number" min={1} required defaultValue={item?.citation.pageNumber ?? 1} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
        Exact quote from the page
        <input name="quote" required minLength={12} maxLength={600} defaultValue={item?.citation.quote} placeholder="e.g. Term loan outstanding: USD 120,000" className={inputClass} />
      </label>
    </>
  );
}

function ValueFields({ item, currency }: { item?: BalanceSheetItemView; currency: string }) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Category
        <select name="category" required className={inputClass} defaultValue={item?.category ?? 'TERM_LOAN'}>
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
        <input name="label" required maxLength={200} defaultValue={item?.label} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Amount
        <input name="amount" required inputMode="decimal" defaultValue={item?.amount} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Currency
        <input name="currency" required defaultValue={item?.currency ?? currency} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        As of
        <input name="asOf" type="date" required defaultValue={item?.asOf} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Note
        <input name="note" maxLength={1000} defaultValue={item?.note ?? ''} className={inputClass} />
      </label>
    </>
  );
}

/**
 * Cash, debt and debt-like items for the deal, each a person's figure backed
 * by an exact quote from a document page. Scenarios link them in the bridge.
 */
export function BalanceSheetCard({ dealId, view, currency }: { dealId: string; view: BalanceSheetView; currency: string }) {
  const debtLike = view.items.filter((item) => item.kind === 'DEBT_LIKE');
  const totals = view.totals;
  return (
    <Card id="balance-sheet">
      <CardHeader className="flex flex-row flex-wrap items-start gap-3">
        <IconTile accent="navy">
          <Landmark />
        </IconTile>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <CardTitle>Balance sheet: cash, debt and debt-like items</CardTitle>
          <CardDescription>
            <Glossed text="Each figure moves the equity price dollar for dollar, so each one quotes the document it comes from. Link them to a scenario's bridge." />
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {view.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No items yet. Upload the balance sheet or loan agreement on the{' '}
            <Link href={`/deals/${dealId}/documents`} className="font-semibold text-indigo-ink hover:underline">
              Documents
            </Link>{' '}
            tab, then record each item with a quote.
          </p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
            <div className="flex flex-col gap-3">
              {totals ? (
                <dl className="grid grid-cols-3 gap-2 text-sm" data-numeric>
                  {(
                    [
                      ['Cash', totals.cash],
                      ['Debt', totals.debt],
                      ['Debt-like', totals.debtLike],
                    ] as const
                  ).map(([label, amount]) => (
                    <div key={label} className="rounded-xl bg-mist p-3">
                      <dt className="text-xs font-bold uppercase tracking-wide text-slate-text">{label}</dt>
                      <dd className="font-mono text-sm font-bold">{formatMoney({ amount, currency: totals.currency })}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {debtLike.length > 0 ? (
                <DonutChart
                  label="Debt-like items by category"
                  slices={debtLike.map((item, index) => ({
                    name: item.label,
                    value: Number(item.amount),
                    color: [CHART_COLORS.amber, CHART_COLORS.rose, CHART_COLORS.indigo, CHART_COLORS.teal, CHART_COLORS.navy][index % 5],
                  }))}
                  centerLabel="Debt-like"
                  height={220}
                />
              ) : null}
            </div>
            <ul className="flex flex-col gap-3">
              {view.items.map((item) => (
                <li key={item.id} className="flex flex-col gap-2 rounded-2xl border border-navy/10 p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={item.kind === 'CASH' ? 'calculation' : item.kind === 'DEBT' ? 'danger' : 'draft'}>{KIND_LABELS[item.kind]}</Badge>
                    <span className="font-bold">{item.label}</span>
                    <span className="text-xs text-muted-foreground">{CATEGORY_LABELS[item.category]}</span>
                    <span className="ml-auto font-mono font-bold">{formatMoney({ amount: item.amount, currency: item.currency })}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Link href={citationHref(dealId, item.citation)}>
                      <Badge variant={item.citationValid ? 'evidence' : 'danger'}>
                        {item.citation.documentName ?? 'document'}, p. {item.citation.pageNumber}
                        {item.citationValid ? '' : ' — source unavailable'}
                      </Badge>
                    </Link>
                    <span className="text-muted-foreground">“{item.citation.quote}”</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    As of {item.asOf} · v{item.version} by {item.updatedByName ?? 'a team member'}
                    {item.history.length > 1 ? ` · ${item.history.map((entry) => `v${entry.version}: ${entry.reason}`).join(' · ')}` : ''}
                  </div>
                  {view.canEdit ? (
                    <details className="text-sm">
                      <summary className="cursor-pointer font-semibold text-indigo-ink">Revise or withdraw</summary>
                      <form action={reviseBalanceSheetItem.bind(null, dealId, item.id)} className="mt-3 grid gap-3 sm:grid-cols-2">
                        <input type="hidden" name="expectedVersion" value={item.version} />
                        <ValueFields item={item} currency={currency} />
                        <SourceFields view={view} item={item} />
                        <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
                          Why it changed
                          <input name="reason" required minLength={3} maxLength={1000} className={inputClass} />
                        </label>
                        <div>
                          <Button type="submit" size="sm">
                            Save revision
                          </Button>
                        </div>
                      </form>
                      <form action={withdrawBalanceSheetItem.bind(null, dealId, item.id)} className="mt-3 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="expectedVersion" value={item.version} />
                        <input name="reason" required minLength={3} placeholder="Why it no longer applies" className={`${inputClass} max-w-sm`} />
                        <Button type="submit" size="sm" variant="outline">
                          Withdraw
                        </Button>
                      </form>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        {view.canEdit ? (
          view.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Upload a balance sheet or loan agreement first — every item must quote its source.</p>
          ) : (
            <details className="rounded-2xl border border-dashed border-navy/20 p-4">
              <summary className="cursor-pointer text-sm font-bold text-indigo-ink">Add an item</summary>
              <form action={addBalanceSheetItem.bind(null, dealId)} className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Kind
                  <select name="kind" className={inputClass} defaultValue="DEBT">
                    <option value="CASH">Cash — adds to equity value</option>
                    <option value="DEBT">Debt — reduces equity value</option>
                    <option value="DEBT_LIKE">Debt-like — reduces equity value</option>
                  </select>
                </label>
                <ValueFields currency={currency} />
                <SourceFields view={view} />
                <div>
                  <Button type="submit" size="sm">
                    Record item
                  </Button>
                </div>
              </form>
            </details>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

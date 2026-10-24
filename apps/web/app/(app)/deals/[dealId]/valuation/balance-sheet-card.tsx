import type { BalanceSheetView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Glossed, IconTile } from '@pactlab/ui';
import { Landmark } from 'lucide-react';
import Link from 'next/link';
import { citationHref } from '../../../documents/_lib/view';
import { formatMoney } from '../../../metrics/_lib/format';
import { DonutChart, CHART_COLORS } from '../../../_lib/charts';
import { addBalanceSheetItem, reviseBalanceSheetItem, withdrawBalanceSheetItem } from './balance-sheet-actions';
import { BalanceSheetItemForm } from './balance-sheet-form';
import { KIND_LABELS, CATEGORY_LABELS } from './balance-sheet-form-state';

export const BALANCE_SHEET_OUTCOMES: Readonly<Record<string, string>> = {
  'ok-item': 'Item recorded with its citation. Link it to a scenario and re-run.',
  'ok-item-revised': 'Item revised. Scenarios that use it are stale until re-run.',
  'ok-item-withdrawn': 'Item withdrawn. Scenarios that used it need editing.',
  'item-invalid-quote': 'Quote at least a few words exactly as they appear on the page.',
  'item-invalid-amount': 'Enter the amount as a number, such as 120000.',
  'item-invalid-category': 'That category does not belong to the kind of item.',
  'item-invalid-reason': 'Say why, in a few words.',
  'item-invalid-documentId': 'Choose the document the figure comes from.',
  'item-invalid-form': 'Complete the item: kind, category, label, amount, date, document, page and quote.',
};

export { CATEGORY_LABELS, KIND_LABELS } from './balance-sheet-form-state';

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

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
                      <BalanceSheetItemForm
                        action={reviseBalanceSheetItem.bind(null, dealId, item.id)}
                        dealId={dealId}
                        documents={view.documents}
                        currency={currency}
                        item={item}
                        submitLabel="Save revision"
                      />
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
              <BalanceSheetItemForm
                action={addBalanceSheetItem.bind(null, dealId)}
                dealId={dealId}
                documents={view.documents}
                currency={currency}
                submitLabel="Record item"
              />
            </details>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

import type { BalanceSheetView } from '@pactlab/contracts';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, IconTile } from '@pactlab/ui';
import { Landmark } from 'lucide-react';
import Link from 'next/link';
import { citationHref } from '../../../documents/_lib/view';
import { formatMoney } from '../../../metrics/_lib/format';
import { CATEGORY_LABELS, percentOf, REPAYMENT_LABELS } from '../valuation/balance-sheet-form-state';

/** Whole days from `from` to `to` (both `YYYY-MM-DD`), in UTC. */
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Debt & cash on Finances (pilot bug 12): the cited balance-sheet items with
 * their loan terms, and a debt schedule. Recorded and edited on Valuation;
 * nothing here is computed from terms.
 */
export function DebtAndCashCard({ dealId, view }: { dealId: string; view: BalanceSheetView }) {
  const debt = view.items.filter((item) => item.kind === 'DEBT').sort((a, b) => (a.terms.maturityDate ?? '9999').localeCompare(b.terms.maturityDate ?? '9999'));
  const totals = view.totals;
  return (
    <Card aria-labelledby="debt-and-cash">
      <CardHeader className="flex flex-row items-start gap-3">
        <IconTile accent="navy">
          <Landmark />
        </IconTile>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <CardTitle id="debt-and-cash">Debt &amp; cash</CardTitle>
          <CardDescription>
            Cash, debt and debt-like items, each quoting its document.{' '}
            <Link href={`/deals/${dealId}/valuation#balance-sheet`} className="font-semibold text-indigo-ink hover:underline">
              Read an uploaded balance sheet, or record an item by hand →
            </Link>
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        {view.items.length === 0 ? (
          <p className="text-muted-foreground">No cash or debt recorded yet. Upload the balance sheet on Documents, then confirm its lines on Valuation.</p>
        ) : (
          <>
            {totals ? (
              <dl className="grid grid-cols-3 gap-2" data-numeric>
                {(
                  [
                    ['Cash', totals.cash],
                    ['Debt', totals.debt],
                    ['Debt-like', totals.debtLike],
                  ] as const
                ).map(([label, amount]) => (
                  <div key={label} className="rounded-xl bg-mist p-3">
                    <dt className="text-xs font-bold uppercase tracking-wide text-slate-text">{label}</dt>
                    <dd className="font-mono font-bold">{formatMoney({ amount, currency: totals.currency })}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-muted-foreground">Items are in more than one currency, so no totals are shown.</p>
            )}
            {debt.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left" aria-label="Debt schedule">
                  <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Debt</th>
                      <th className="py-2 pr-3 font-medium">Lender</th>
                      <th className="py-2 pr-3 text-right font-medium">Amount</th>
                      <th className="py-2 pr-3 font-medium">Rate</th>
                      <th className="py-2 pr-3 font-medium">Maturity</th>
                      <th className="py-2 pr-3 font-medium">Repayment</th>
                      <th className="py-2 font-medium">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {debt.map((item) => {
                      const soon = item.terms.maturityDate !== null && daysBetween(item.asOf, item.terms.maturityDate) <= 365;
                      return (
                        <tr key={item.id} className="align-top">
                          <td className="py-2 pr-3">
                            <span className="font-medium">{item.label}</span>
                            <span className="block text-xs text-muted-foreground">{CATEGORY_LABELS[item.category]}</span>
                            {item.terms.covenantNote ? <span className="block text-xs text-muted-foreground">Covenants: {item.terms.covenantNote}</span> : null}
                          </td>
                          <td className="py-2 pr-3">{item.terms.lender ?? '—'}</td>
                          <td className="py-2 pr-3 text-right font-mono">{formatMoney({ amount: item.amount, currency: item.currency })}</td>
                          <td className="py-2 pr-3">
                            {item.terms.interestRate !== null ? percentOf(item.terms.interestRate) : '—'}
                            {item.terms.rateType ? <span className="block text-xs text-muted-foreground">{item.terms.rateType === 'FIXED' ? 'Fixed' : 'Floating'}{item.terms.rateReference ? ` · ${item.terms.rateReference}` : ''}</span> : null}
                          </td>
                          <td className="py-2 pr-3">
                            {item.terms.maturityDate ?? '—'}
                            {soon ? <Badge variant="danger" className="ml-2">Within 12 months</Badge> : null}
                          </td>
                          <td className="py-2 pr-3">{item.terms.repayment ? REPAYMENT_LABELS[item.terms.repayment] : '—'}</td>
                          <td className="py-2">
                            <Link href={citationHref(dealId, item.citation)}>
                              <Badge variant={item.citationValid ? 'evidence' : 'danger'}>
                                {item.citation.documentName ?? 'document'}, p. {item.citation.pageNumber}
                              </Badge>
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

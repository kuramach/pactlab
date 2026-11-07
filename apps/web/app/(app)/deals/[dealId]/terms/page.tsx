import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, HumanBadge } from '@pactlab/ui';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { formatMoney } from '../../../metrics/_lib/format';
import { DECISION_LABELS, LEVER_LABELS, type SellerTermsView } from '../../../valuation/_lib/pricing';
import { parseDealParam } from '../../../valuation/_lib/view';
import { acceptAllTerms, respondToTerms } from './actions';

// Per-user: reads the session.
export const dynamic = 'force-dynamic';

const OUTCOMES: Record<string, string> = {
  'ok-sent': 'Your answer was sent to the buyer.',
  'counter-amount': 'Enter a counter amount as a number, e.g. 250,000.',
  'nothing-chosen': 'Choose Accept, Reject or Counter for at least one term.',
  'agreed-already': 'These terms are already agreed.',
  forbidden: 'Only the seller’s contributors can answer proposed terms.',
};

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/**
 * The terms the buyer proposed (T-105), as everyone on the pact sees them, and
 * where the seller answers (batch 1): accept, reject or counter each term.
 * Nothing about how the terms were priced reaches this page.
 */
export default async function ProposedTermsPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const dealId = parseDealParam((await params).dealId);
  const outcome = (await searchParams)['outcome'];
  if (!dealId) return <EmptyState title="Choose a deal" description="Open proposed terms from a deal." />;
  const result = await apiGet<SellerTermsView>(`/v1/deals/${encodeURIComponent(dealId)}/terms/proposed`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const proposed = result.data.proposed;
  if (!proposed) return <EmptyState title="No terms proposed yet" description="When the buyer proposes deal terms, they appear here, versioned." />;
  const open = proposed.canRespond;
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <OutcomeBanner outcome={typeof outcome === 'string' ? outcome : undefined} messages={OUTCOMES} />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start gap-2">
          <div className="mr-auto flex flex-col gap-1.5">
            <CardTitle>Proposed terms</CardTitle>
            <CardDescription>
              Version {proposed.version}, proposed on {proposed.proposedAt.slice(0, 10)}.{' '}
              {proposed.agreedAt
                ? `Agreed on ${proposed.agreedAt.slice(0, 10)}: these are the deal terms.`
                : open
                  ? 'Accept, reject or counter each term. The buyer sees your answers and may send a new version.'
                  : 'The seller’s contributors answer these terms.'}
            </CardDescription>
          </div>
          {proposed.agreedAt ? <HumanBadge>Agreed v{proposed.version}</HumanBadge> : <Badge variant="evidence">v{proposed.version}</Badge>}
        </CardHeader>
        <CardContent>
          <form action={respondToTerms.bind(null, dealId)} className="flex flex-col gap-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Term</th>
                  <th className="py-2 pr-4 font-medium">Amount</th>
                  <th className="py-2 pr-4 font-medium">Buyer’s note</th>
                  <th className="py-2 font-medium">{open ? 'Your answer' : 'Answer'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border align-top">
                {proposed.terms.map((term) => (
                  <tr key={term.ordinal}>
                    <td className="py-3 pr-4 font-medium">{LEVER_LABELS[term.lever]}</td>
                    <td className="py-3 pr-4">{formatMoney({ amount: term.amount, currency: term.currency })}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{term.sellerNote || '—'}</td>
                    <td className="py-3">
                      {term.response ? (
                        <p className="mb-2 text-xs">
                          <Badge variant={term.response.decision === 'ACCEPT' ? 'reviewed' : term.response.decision === 'REJECT' ? 'danger' : 'draft'}>{DECISION_LABELS[term.response.decision]}</Badge>
                          {term.response.counterAmount ? <span className="ml-2 font-medium">{formatMoney({ amount: term.response.counterAmount, currency: term.currency })}</span> : null}
                          {term.response.note ? <span className="ml-2 text-muted-foreground">“{term.response.note}”</span> : null}
                        </p>
                      ) : null}
                      {open ? (
                        <fieldset className="flex flex-col gap-2">
                          <legend className="sr-only">Answer for {LEVER_LABELS[term.lever]}</legend>
                          <div className="flex flex-wrap gap-3">
                            {(['ACCEPT', 'REJECT', 'COUNTER'] as const).map((decision) => (
                              <label key={decision} className="flex items-center gap-1.5">
                                <input type="radio" name={`decision-${term.ordinal}`} value={decision} className="h-4 w-4 accent-navy" />
                                {decision === 'ACCEPT' ? 'Accept' : decision === 'REJECT' ? 'Reject' : 'Counter'}
                              </label>
                            ))}
                          </div>
                          <input name={`counter-${term.ordinal}`} inputMode="decimal" placeholder={`Counter amount (${term.currency}), if countering`} className={inputClass} />
                          <input name={`note-${term.ordinal}`} maxLength={1000} placeholder="Note for the buyer (optional)" className={inputClass} />
                        </fieldset>
                      ) : !term.response ? (
                        <span className="text-xs text-muted-foreground">No answer yet</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {open ? (
              <div className="flex flex-wrap gap-2">
                <Button type="submit">Send answer</Button>
                <Button type="submit" variant="outline" formAction={acceptAllTerms.bind(null, dealId, proposed.terms.map((term) => term.ordinal))}>
                  Accept all terms
                </Button>
              </div>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

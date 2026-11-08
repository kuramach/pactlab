import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, HumanBadge } from '@pactlab/ui';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { formatMoney } from '../../../metrics/_lib/format';
import { DECISION_LABELS, LEVER_LABELS, type SellerTermsView } from '../../../valuation/_lib/pricing';
import { parseDealParam } from '../../../valuation/_lib/view';
import Link from 'next/link';
import { acceptAllTerms, acceptCounters, draftOwnTerms, proposeOwnTerms, respondToTerms } from './actions';

// Per-user: reads the session.
export const dynamic = 'force-dynamic';

const OUTCOMES: Record<string, string> = {
  'ok-sent': 'Your answer was sent to the buyer.',
  'counter-amount': 'Enter a counter amount as a number, e.g. 250,000.',
  'nothing-chosen': 'Choose Accept, Reject or Counter for at least one term.',
  'agreed-already': 'These terms are already agreed.',
  'ok-counters': 'The counters are in your next version. Check it and propose it.',
  'ok-drafted': 'Your version is drafted. Check it, then propose it.',
  'ok-proposed': 'Proposed. The other side answers it now.',
  'draft-invalid': 'Enter each amount as a number, e.g. 25,000,000.',
  'draft-price-first': 'Start with the purchase price.',
  forbidden: 'Only the other side answers these terms.',
};

const SIDE_NAMES = { BUYER: 'the buyer', SELLER: 'the seller' } as const;
const DRAFT_LEVERS = ['PURCHASE_PRICE', 'ESCROW', 'INDEMNITY', 'EARNOUT', 'SELLER_FINANCING', 'PRICE_REDUCTION', 'REMEDIATION_COST', 'RETENTION'] as const;

/** The seller's own version (T-107): a draft to check and propose, or a form to write one. */
function SellerVersion({ dealId, view, open }: { dealId: string; view: SellerTermsView; open: boolean }) {
  if (view.side !== 'SELLER') return null;
  if (view.draft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your draft, v{view.draft.version}</CardTitle>
          <CardDescription>Only your side sees it until you propose it.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {view.draft.terms.map((term) => (
                <tr key={term.ordinal}>
                  <td className="py-2 pr-4 font-medium">{LEVER_LABELS[term.lever]}</td>
                  <td className="py-2 pr-4">{formatMoney({ amount: term.amount, currency: term.currency })}</td>
                  <td className="py-2 text-muted-foreground">{term.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <form action={proposeOwnTerms.bind(null, dealId, view.draft.id)}>
            <Button type="submit">Propose v{view.draft.version} to the buyer</Button>
          </form>
        </CardContent>
      </Card>
    );
  }
  if (open && view.proposed?.initiatedBySide === 'SELLER') return null;
  const currency = view.proposed?.currency ?? 'USD';
  return (
    <details className="rounded-xl border border-dashed border-border p-4">
      <summary className="cursor-pointer font-semibold">Propose your own terms</summary>
      <form action={draftOwnTerms.bind(null, dealId)} className="mt-4 flex flex-col gap-3 text-sm">
        <input type="hidden" name="currency" value={currency} />
        <p className="text-muted-foreground">Start with the purchase price ({currency}); add any other terms you want. The buyer answers each one.</p>
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="grid gap-2 sm:grid-cols-[12rem_10rem_1fr]">
            <select name={`lever-${row}`} defaultValue={row === 0 ? 'PURCHASE_PRICE' : DRAFT_LEVERS[row] ?? 'ESCROW'} className={inputClass} aria-label={`Term ${row + 1}`} disabled={row === 0}>
              {DRAFT_LEVERS.map((lever) => (
                <option key={lever} value={lever}>
                  {LEVER_LABELS[lever]}
                </option>
              ))}
            </select>
            {row === 0 ? <input type="hidden" name="lever-0" value="PURCHASE_PRICE" /> : null}
            <input name={`amount-${row}`} inputMode="decimal" required={row === 0} placeholder={row === 0 ? 'Purchase price' : 'Amount (optional)'} className={inputClass} aria-label={`Amount for term ${row + 1}`} />
            <input name={`note-${row}`} maxLength={1000} placeholder="Note for the buyer (optional)" className={inputClass} aria-label={`Note for term ${row + 1}`} />
          </div>
        ))}
        <div>
          <Button type="submit" variant="outline">
            Draft my version
          </Button>
        </div>
      </form>
    </details>
  );
}

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
  const view = result.data;
  if (!proposed) {
    return (
      <div className="flex max-w-5xl flex-col gap-4">
        <OutcomeBanner outcome={typeof outcome === 'string' ? outcome : undefined} messages={OUTCOMES} />
        <EmptyState title="No terms proposed yet" description="When either side proposes deal terms, they appear here, versioned." />
        <SellerVersion dealId={dealId} view={view} open={false} />
      </div>
    );
  }
  const open = proposed.canRespond;
  const live = !proposed.agreedAt && !proposed.declinedAt;
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <OutcomeBanner outcome={typeof outcome === 'string' ? outcome : undefined} messages={OUTCOMES} />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start gap-2">
          <div className="mr-auto flex flex-col gap-1.5">
            <CardTitle>Proposed terms</CardTitle>
            <CardDescription>
              Version {proposed.version}, proposed by {SIDE_NAMES[proposed.initiatedBySide]} on {proposed.proposedAt.slice(0, 10)}.{' '}
              {proposed.declinedAt
                ? 'A signatory declined this version; a new one follows.'
                : proposed.agreedAt
                  ? `Agreed on ${proposed.agreedAt.slice(0, 10)}. Both signatories now sign it on the Closing tab.`
                  : open
                    ? `Accept, reject or counter each term. ${proposed.initiatedBySide === 'BUYER' ? 'The buyer' : 'The seller'} sees your answers and may send a new version.`
                    : `${proposed.initiatedBySide === 'BUYER' ? 'The seller' : 'The buyer'} answers these terms.`}
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
                  <th className="py-2 pr-4 font-medium">Note</th>
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
                          <input name={`note-${term.ordinal}`} maxLength={1000} placeholder={`Note for ${SIDE_NAMES[proposed.initiatedBySide]} (optional)`} className={inputClass} />
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
          {proposed.canAcceptCounters ? (
            <form action={acceptCounters.bind(null, dealId, proposed.id)} className="mt-4">
              <Button type="submit">Accept counters into your next version</Button>
            </form>
          ) : null}
          {proposed.agreedAt && !proposed.declinedAt ? (
            <Link href={`/deals/${dealId}/closing`} className="mt-4 inline-block font-semibold text-indigo-ink underline-offset-4 hover:underline">
              Sign and close on the Closing tab →
            </Link>
          ) : null}
        </CardContent>
      </Card>
      {!live || proposed.initiatedBySide === 'BUYER' ? <SellerVersion dealId={dealId} view={view} open={live} /> : null}
    </div>
  );
}

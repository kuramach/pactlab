import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from '@pactlab/ui';
import { apiGet } from '../../_lib/api';
import { ApiState } from '../../_lib/states';
import { formatMoney } from '../../../metrics/_lib/format';
import { LEVER_LABELS, type SellerTermsView } from '../../../valuation/_lib/pricing';
import { parseDealParam } from '../../../valuation/_lib/view';

// Per-user: reads the session.
export const dynamic = 'force-dynamic';

/**
 * The terms the buyer proposed (T-105), as everyone on the pact sees them, the
 * seller's contributors included: each lever, its amount and the buyer's note.
 * Nothing about how they were priced reaches this page.
 */
export default async function ProposedTermsPage({ params }: { params: Promise<{ dealId: string }> }) {
  const dealId = parseDealParam((await params).dealId);
  if (!dealId) return <EmptyState title="Choose a deal" description="Open proposed terms from a deal." />;
  const result = await apiGet<SellerTermsView>(`/v1/deals/${encodeURIComponent(dealId)}/terms/proposed`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const proposed = result.data.proposed;
  if (!proposed) return <EmptyState title="No terms proposed yet" description="When the buyer proposes deal terms, they appear here, versioned." />;
  return (
    <Card className="max-w-4xl">
      <CardHeader className="flex flex-row flex-wrap items-start gap-2">
        <div className="mr-auto flex flex-col gap-1.5">
          <CardTitle>Proposed terms</CardTitle>
          <CardDescription>Version {proposed.version}, proposed on {proposed.proposedAt.slice(0, 10)}. A new proposal replaces this one as a new version.</CardDescription>
        </div>
        <Badge variant="evidence">v{proposed.version}</Badge>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Term</th>
              <th className="py-2 pr-4 font-medium">Amount</th>
              <th className="py-2 font-medium">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {proposed.terms.map((term, index) => (
              <tr key={index}>
                <td className="py-2 pr-4 font-medium">{LEVER_LABELS[term.lever]}</td>
                <td className="py-2 pr-4">{formatMoney({ amount: term.amount, currency: term.currency })}</td>
                <td className="py-2 text-muted-foreground">{term.sellerNote || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

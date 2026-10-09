import { Badge, buttonVariants, Card, EmptyState, PageHeader } from '@pactlab/ui';
import { ArrowRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { dealsApi, type DealListItem } from './_lib/api';
import { DEAL_TYPE_LABELS, partyLabel, STAGE_LABELS } from './_lib/labels';
import { ApiState } from './_lib/states';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

function StartPactLink() {
  return (
    <Link href="/pacts/new" className={buttonVariants()}>
      <Plus aria-hidden className="h-4 w-4" />
      Start a Pact
    </Link>
  );
}

/** "Buyer → Seller" when the deal was started as a Pact; otherwise the target name. */
function partiesLine(deal: DealListItem): string {
  const buyer = deal.parties?.find((party) => party.role === 'BUYER');
  const seller = deal.parties?.find((party) => party.role === 'SELLER');
  return buyer && seller ? `${partyLabel(buyer)} → ${partyLabel(seller)}` : deal.targetName;
}

export default async function DealsPage() {
  const result = await dealsApi.list();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ href: '/', label: 'Home' }, { label: 'My deals' }]}
        title="My deals"
        description="Every Pact you are a member of. Open one to collect evidence, review findings and value it."
        actions={<StartPactLink />}
      />
      {result.kind !== 'ok' ? (
        <ApiState result={result} />
      ) : result.data.items.length === 0 ? (
        <EmptyState
          title="No deals yet"
          description="Start a Pact to open your first deal, or ask a deal lead to add you."
          action={<StartPactLink />}
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Deal</th>
                <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">Type</th>
                <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">Stage</th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {result.data.items.map((deal) => (
                <tr key={deal.id} className="group hover:bg-muted/60">
                  <td className="px-4 py-3">
                    <Link href={`/deals/${deal.id}`} className="flex flex-col">
                      <span className="font-medium group-hover:text-indigo-ink">{deal.name}</span>
                      <span className="text-muted-foreground">{partiesLine(deal)}</span>
                    </Link>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <Badge>{DEAL_TYPE_LABELS[deal.transactionType] ?? deal.transactionType}</Badge>
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">{STAGE_LABELS[deal.stage] ?? deal.stage}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/deals/${deal.id}`} aria-label={`Open ${deal.name}`} className="inline-flex">
                      <ArrowRight aria-hidden className="h-4 w-4 text-muted-foreground group-hover:text-indigo-ink" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

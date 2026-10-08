import { Badge, buttonVariants, Card, CardContent, EmptyState } from '@pactlab/ui';
import Link from 'next/link';
import { dealsApi } from './_lib/api';
import { ApiState } from './_lib/states';
import type { DealListItem } from './_lib/api';

function StartPactLink() {
  return (
    <Link href="/pacts/new" className={buttonVariants()}>
      Start a Pact
    </Link>
  );
}

/** "Buyer → Seller" when the deal was started as a Pact; otherwise the target name. */
function partiesLine(deal: DealListItem): string {
  const buyer = deal.parties?.find((party) => party.role === 'BUYER');
  const seller = deal.parties?.find((party) => party.role === 'SELLER');
  const label = (party: { name: string; ticker: string | null }) => (party.ticker ? `${party.name} (${party.ticker})` : party.name);
  return buyer && seller ? `${label(buyer)} → ${label(seller)}` : deal.targetName;
}

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

export default async function DealsPage() {
  const result = await dealsApi.list();
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Deals</h1>
          <p className="text-sm text-muted-foreground">
            Deals you are a member of. Open one to see its sources and evidence.
          </p>
        </div>
        <StartPactLink />
      </header>
      {result.kind !== 'ok' ? (
        <ApiState result={result} />
      ) : result.data.items.length === 0 ? (
        <EmptyState
          title="No deals yet"
          description="Start a Pact to open your first deal, or ask a deal lead to add you."
          action={<StartPactLink />}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {result.data.items.map((deal) => (
                <li key={deal.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="flex flex-col">
                    <Link
                      href={`/deals/${deal.id}/sources`}
                      className="font-medium hover:underline"
                    >
                      {deal.name}
                    </Link>
                    <span className="text-sm text-muted-foreground">{partiesLine(deal)}</span>
                    <span className="mt-1 flex gap-3 text-sm">
                      <Link href={`/deals/${deal.id}/sources`} className="text-indigo-ink hover:underline">
                        Sources
                      </Link>
                      <Link href={`/deals/${deal.id}/evidence`} className="text-indigo-ink hover:underline">
                        Evidence
                      </Link>
                      <Link href={`/metrics/${deal.id}`} className="text-indigo-ink hover:underline">
                        Finances
                      </Link>
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Badge>{deal.transactionType.replaceAll('_', ' ').toLowerCase()}</Badge>
                    <Badge>{deal.stage.toLowerCase()}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

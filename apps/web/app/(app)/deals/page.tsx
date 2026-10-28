import { DEAL_PHASE_LABELS, DEAL_PHASES, type DealPhase } from '@pactlab/domain';
import { Badge, buttonVariants, Card, EmptyState, IconTile, PageHeader } from '@pactlab/ui';
import { ArrowRight, Building2, Plus } from 'lucide-react';
import Link from 'next/link';
import { dealsApi, type DealListItem } from './_lib/api';
import { DEAL_TYPE_LABELS, partyLabel, STAGE_LABELS } from './_lib/labels';
import { EmptyMarkIcon } from './_lib/empty-marks';
import { ApiState } from './_lib/states';
import { formatMoney } from '../metrics/_lib/format';
import { getSessionContext } from '../../../lib/session';

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

export default async function DealsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Guests on another organization's pacts never start one there (ADR 0014; the API refuses too).
  const session = await getSessionContext();
  const guest = session.kind === 'signed-in' && session.guest;
  const phaseParam = (await searchParams)['phase'];
  const phase = typeof phaseParam === 'string' && (DEAL_PHASES as readonly string[]).includes(phaseParam) ? (phaseParam as DealPhase) : null;
  const listed = await dealsApi.list();
  // The phase filter is a view over the list (the phase is derived from each deal's stage).
  const result = listed.kind === 'ok' && phase ? { ...listed, data: { items: listed.data.items.filter((deal) => deal.phase === phase) } } : listed;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        tone="navy"
        breadcrumbs={[{ href: '/', label: 'Home' }, { label: 'My deals' }]}
        title="My deals"
        description="Every Pact you are a member of. Open one to collect evidence, review findings and value it."
        actions={guest ? undefined : <StartPactLink />}
      />
      <nav aria-label="Filter by phase" className="flex flex-wrap gap-2 text-sm">
        {[null, ...DEAL_PHASES].map((option) => (
          <Link
            key={option ?? 'all'}
            href={option ? `/deals?phase=${option}` : '/deals'}
            aria-current={option === phase ? 'page' : undefined}
            className={`rounded-full border px-3 py-1 ${option === phase ? 'border-indigo-ink bg-muted font-semibold' : 'border-border text-muted-foreground'}`}
          >
            {option ? DEAL_PHASE_LABELS[option] : 'All phases'}
          </Link>
        ))}
      </nav>
      {result.kind !== 'ok' ? (
        <ApiState result={result} />
      ) : result.data.items.length === 0 ? (
        <EmptyState
          icon={<EmptyMarkIcon name="deals" />}
          title="No deals yet"
          description="Start a Pact to open your first deal, or ask a deal lead to add you."
          action={guest ? undefined : <StartPactLink />}
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Deal</th>
                <th scope="col" className="hidden px-4 py-3 text-right font-medium lg:table-cell">Asking price</th>
                <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">Type</th>
                <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">Phase · stage</th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {result.data.items.map((deal) => (
                <tr key={deal.id} className="group hover:bg-muted/60">
                  <td className="px-4 py-3">
                    <Link href={`/deals/${deal.id}`} className="flex items-center gap-3">
                      <IconTile accent="navy" className="h-10 w-10">
                        <Building2 />
                      </IconTile>
                      <span className="flex flex-col">
                        <span className="font-bold group-hover:text-indigo-ink">{deal.name}</span>
                        <span className="text-muted-foreground">{partiesLine(deal)}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="hidden px-4 py-3 text-right font-mono lg:table-cell" data-numeric>
                    {deal.askingPrice ? formatMoney({ amount: deal.askingPrice.amount, currency: deal.askingPrice.currency }) : '—'}
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <Badge>{DEAL_TYPE_LABELS[deal.transactionType] ?? deal.transactionType}</Badge>
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <span className="font-medium">{DEAL_PHASE_LABELS[deal.phase]}</span>
                    <span className="block text-xs text-muted-foreground">
                      {STAGE_LABELS[deal.stage] ?? deal.stage}
                      {deal.status === 'ARCHIVED' ? ' · archived' : ''}
                    </span>
                  </td>
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

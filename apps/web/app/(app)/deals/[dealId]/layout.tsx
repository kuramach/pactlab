import { DEAL_PHASE_LABELS } from '@pactlab/domain';
import { Badge, PageHeader } from '@pactlab/ui';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { dealsApi } from '../_lib/api';
import { DealTabs } from '../_lib/deal-tabs';
import { isUuidParam } from '../_lib/filters';
import { DEAL_TYPE_LABELS, partyLabel, STAGE_LABELS } from '../_lib/labels';
import { ApiState } from '../_lib/states';

/**
 * Deal workspace: who is buying whom, the deal type and stage, and tabs for
 * every part of the diligence. Breadcrumbs always lead back to Home and My deals.
 */
export default async function DealLayout({ children, params }: { children: ReactNode; params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  if (!isUuidParam(dealId)) notFound();
  const [deal, parties] = await Promise.all([dealsApi.get(dealId), dealsApi.parties(dealId)]);
  if (deal.kind !== 'ok') {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader breadcrumbs={[{ href: '/', label: 'Home' }, { href: '/deals', label: 'My deals' }, { label: 'Deal' }]} title="Deal" />
        <ApiState result={deal} />
      </div>
    );
  }
  const buyer = parties.kind === 'ok' ? parties.data.items.find((party) => party.role === 'BUYER') : undefined;
  const seller = parties.kind === 'ok' ? parties.data.items.find((party) => party.role === 'SELLER') : undefined;
  // Founder-side (T-083): the seller is the founder's own startup, raising a round.
  const venture = seller?.companyType === 'VENTURE_RAISE';

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageHeader
          tone="navy"
          eyebrow="Deal workspace"
          breadcrumbs={[{ href: '/', label: 'Home' }, { href: '/deals', label: 'My deals' }, { label: deal.data.name }]}
          title={deal.data.name}
          description={
            venture && seller ? (
              <>
                <span className="font-semibold text-white">{partyLabel(seller)}</span> raising a round
              </>
            ) : buyer && seller ? (
              <>
                <span className="font-semibold text-white">{partyLabel(buyer)}</span> acquiring{' '}
                <span className="font-semibold text-white">{partyLabel(seller)}</span>
              </>
            ) : (
              deal.data.targetName
            )
          }
          meta={
            <>
              <Badge className="border-white/20 bg-white/10 text-white">{DEAL_TYPE_LABELS[deal.data.transactionType] ?? deal.data.transactionType}</Badge>
              <Badge className="border-teal/40 bg-teal/20 text-white" title="Phase of the pact">
                {DEAL_PHASE_LABELS[deal.data.phase]}
              </Badge>
              <Badge className="border-indigo/40 bg-indigo/20 text-white">{STAGE_LABELS[deal.data.stage] ?? deal.data.stage}</Badge>
              {deal.data.status === 'ARCHIVED' ? <Badge className="border-white/20 bg-white/10 text-white">Archived</Badge> : null}
            </>
          }
        />
        <DealTabs dealId={dealId} venture={venture} />
      </div>
      {children}
    </div>
  );
}

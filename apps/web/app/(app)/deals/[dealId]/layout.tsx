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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageHeader
          breadcrumbs={[{ href: '/', label: 'Home' }, { href: '/deals', label: 'My deals' }, { label: deal.data.name }]}
          title={deal.data.name}
          description={
            buyer && seller ? (
              <>
                <span className="font-medium text-foreground">{partyLabel(buyer)}</span> acquiring{' '}
                <span className="font-medium text-foreground">{partyLabel(seller)}</span>
              </>
            ) : (
              deal.data.targetName
            )
          }
          meta={
            <>
              <Badge>{DEAL_TYPE_LABELS[deal.data.transactionType] ?? deal.data.transactionType}</Badge>
              <Badge>{STAGE_LABELS[deal.data.stage] ?? deal.data.stage}</Badge>
            </>
          }
        />
        <DealTabs dealId={dealId} />
      </div>
      {children}
    </div>
  );
}

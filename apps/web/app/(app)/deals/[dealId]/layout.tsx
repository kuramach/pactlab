import type { CompanyType } from '@pactlab/domain';
import { Badge, Button, PageHeader } from '@pactlab/ui';
import { FileText } from 'lucide-react';
import { generateReport } from '../../reports/actions';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { apiGet, dealsApi } from '../_lib/api';
import { guideHidden } from '../../_lib/guide-actions';
import { DealTabs } from '../_lib/deal-tabs';
import { Showcase } from '../_lib/showcase';
import { isUuidParam } from '../_lib/filters';
import { partyLabel } from '../_lib/labels';
import { getI18n } from '../../../../lib/i18n/server';
import { ApiState } from '../_lib/states';
import { TeamButton } from '../_lib/team-button';
import { dealViewer } from '../_lib/viewer';

/**
 * Deal workspace: who is buying whom, the deal type and stage, and tabs for
 * every part of the diligence. Breadcrumbs always lead back to Home and My deals.
 */
export default async function DealLayout({ children, params }: { children: ReactNode; params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  if (!isUuidParam(dealId)) notFound();
  const t = await getI18n();
  const words = t.m.pact;
  const crumbs = words.breadcrumbs;
  const [deal, parties, members, viewer, suggestions] = await Promise.all([
    dealsApi.get(dealId),
    dealsApi.parties(dealId),
    dealsApi.members(dealId),
    dealViewer(dealId),
    // Connected apps' suggestions (T-084b): buyer side only; the API refuses anyone else.
    apiGet<{ total: number; connectable: boolean }>(`/v1/deals/${dealId}/agent-proposals?status=PENDING&limit=1`),
  ]);
  // The tab shows where suggestions can arrive (apps may connect) or some already have.
  const pendingSuggestions = suggestions.kind === 'ok' && (suggestions.data.connectable || suggestions.data.total > 0) ? suggestions.data.total : null;
  if (deal.kind !== 'ok') {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader breadcrumbs={[{ href: '/', label: crumbs.home }, { href: '/deals', label: crumbs.deals }, { label: crumbs.deal }]} title={crumbs.deal} />
        <ApiState result={deal} t={t} />
      </div>
    );
  }
  const buyer = parties.kind === 'ok' ? parties.data.items.find((party) => party.role === 'BUYER') : undefined;
  const seller = parties.kind === 'ok' ? parties.data.items.find((party) => party.role === 'SELLER') : undefined;
  // Founder-side (T-083): the seller is the founder's own startup, raising a round.
  const venture = seller?.companyType === 'VENTURE_RAISE';
  const sellerLed = deal.data.initiatedBy === 'SELLER';

  // An investor in a pooled vehicle (T-141): their own seat and the published investor view, no deal tabs.
  if (viewer.role === 'INVESTOR') {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader tone="navy" eyebrow={words.eyebrow.investment} breadcrumbs={[{ href: '/', label: crumbs.home }, { label: deal.data.name }]} title={deal.data.name} description={t.fill(words.description.pooled, { target: deal.data.targetName })} />
        {children}
      </div>
    );
  }

  // A bidder (T-097) works in their own bid only: no deal tabs, no team, nothing of the seller's side.
  if (viewer.role === 'BIDDER') {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          tone="navy"
          eyebrow={words.eyebrow.bid}
          breadcrumbs={[{ href: '/', label: crumbs.home }, { label: deal.data.name }]}
          title={deal.data.name}
          description={t.fill(venture ? words.description.raisingRound : words.description.forSale, { target: deal.data.targetName })}
        />
        {children}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageHeader
          tone="navy"
          eyebrow={words.eyebrow.workspace}
          breadcrumbs={[{ href: '/', label: crumbs.home }, { href: '/deals', label: crumbs.deals }, { label: deal.data.name }]}
          title={deal.data.name}
          description={
            sellerLed && seller ? (
              <>
                <span className="font-semibold text-white">{partyLabel(seller)}</span> {venture ? words.description.raisingFromInvestors : words.description.forSaleToBidders}
              </>
            ) : venture && seller ? (
              <>
                <span className="font-semibold text-white">{partyLabel(seller)}</span> {words.description.raising}
              </>
            ) : buyer && seller ? (
              <>
                <span className="font-semibold text-white">{partyLabel(buyer)}</span> {words.description.acquiring}{' '}
                <span className="font-semibold text-white">{partyLabel(seller)}</span>
              </>
            ) : (
              deal.data.targetName
            )
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {/* The complete record of this pact as a versioned PDF (T-110). */}
              <form action={generateReport.bind(null, 'PACT', dealId)}>
                <Button type="submit" variant="outline" size="sm">
                  <FileText aria-hidden className="h-4 w-4" /> {words.report}
                </Button>
              </form>
              {members.kind === 'ok' ? <TeamButton dealId={dealId} members={members.data.items.filter((member) => member.status === 'ACTIVE')} /> : null}
            </div>
          }
          meta={
            <>
              <Badge className="border-white/20 bg-white/10 text-white">{(t.m.common.dealTypes as Record<string, string>)[deal.data.transactionType] ?? deal.data.transactionType}</Badge>
              <Badge className="border-teal/40 bg-teal/20 text-white" title={words.phaseTitle}>
                {t.m.common.phases[deal.data.phase]}
              </Badge>
              <Badge className="border-indigo/40 bg-indigo/20 text-white">{(t.m.common.stages as Record<string, string>)[deal.data.stage] ?? deal.data.stage}</Badge>
              {deal.data.status === 'ARCHIVED' ? <Badge className="border-white/20 bg-white/10 text-white">{words.archived}</Badge> : null}
            </>
          }
        />
        <DealTabs dealId={dealId} companyType={(seller?.companyType as CompanyType | null | undefined) ?? null} sellerLed={sellerLed} counterparty={viewer.role === 'TARGET_CONTRIBUTOR'} pendingSuggestions={pendingSuggestions} words={words.tabs} />
      </div>
      {/* The guided tour and "Why this matters" (2026-11-13); each person can hide it. */}
      {(await guideHidden()) ? null : <Showcase dealId={dealId} companyType={(seller?.companyType as CompanyType | null | undefined) ?? null} sellerLed={sellerLed} />}
      {children}
    </div>
  );
}

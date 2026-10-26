import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet } from '../../../_lib/api';
import { isUuidParam } from '../../../_lib/filters';
import { ApiState } from '../../../_lib/states';
import { PrintButton } from './print-button';

export const dynamic = 'force-dynamic';

interface InvestorView {
  company: string;
  round: { roundType: string; currency: string; raiseAmount: string } | null;
  offer: { investorName: string; preMoney: string | null; amount: string | null; liquidationMultiple: string; participating: boolean } | null;
  verifiedClaims: { statement: string; evidenceCount: number }[];
  revenue: { month: string; currency: string; mrr: string; arr: string } | null;
  capTable: { sharesOutstanding: string; byHolderType: { holderType: string; shares: string; percent: string }[]; convertingInstruments: number; convertingPrincipal: string } | null;
  dataRoom: { item: string; evidence: string | null }[];
  excludes: string;
}

/**
 * The investor view (T-083): the one page meant to leave the founder's side.
 * It shows only what the API allow-lists — verified claims, billed revenue,
 * the cap table by holder type and the data room — never a finding.
 */
export default async function InvestorViewPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  if (!isUuidParam(dealId)) notFound();
  const offerId = (await searchParams)['offerId'];
  const query = typeof offerId === 'string' && isUuidParam(offerId) ? `?offerId=${offerId}` : '';
  const result = await apiGet<InvestorView>(`/v1/deals/${dealId}/venture/investor-view${query}`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/deals/${dealId}/raise`} className="text-sm font-semibold text-indigo-ink hover:underline">
          Back to the raise
        </Link>
        <PrintButton />
      </div>
      <div className="rounded-lg border border-teal/40 bg-teal/10 px-4 py-3 text-sm print:hidden">
        <Badge variant="calculation">Safe to share</Badge> {view.excludes}
      </div>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{view.company}</h2>
        {view.offer ? <p className="text-sm text-muted-foreground">Prepared for {view.offer.investorName}</p> : null}
      </div>

      {view.offer || view.round ? (
        <Card>
          <CardHeader>
            <CardTitle>The round</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {view.round ? (
              <p>
                Raising {view.round.currency} {view.round.raiseAmount}.
              </p>
            ) : null}
            {view.offer ? (
              <p>
                Your terms: pre-money {view.offer.preMoney ?? '—'}, amount {view.offer.amount ?? '—'}, {view.offer.liquidationMultiple}x {view.offer.participating ? 'participating' : 'non-participating'}.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Verified</CardTitle>
          <CardDescription>Claims checked against evidence.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {view.verifiedClaims.length === 0 ? <p className="text-muted-foreground">No verified claims yet.</p> : null}
          <ul className="flex flex-col gap-1">
            {view.verifiedClaims.map((claim) => (
              <li key={claim.statement}>
                “{claim.statement}” <span className="text-xs text-muted-foreground">({claim.evidenceCount} records)</span>
              </li>
            ))}
          </ul>
          {view.revenue ? (
            <p className="mt-3">
              Billed revenue, {view.revenue.month}: MRR {view.revenue.currency} {view.revenue.mrr} (ARR {view.revenue.currency} {view.revenue.arr}).
            </p>
          ) : null}
        </CardContent>
      </Card>

      {view.capTable ? (
        <Card>
          <CardHeader>
            <CardTitle>Capitalization</CardTitle>
            <CardDescription>{view.capTable.sharesOutstanding} shares and options outstanding, by holder type.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <ul className="flex flex-col gap-1">
              {view.capTable.byHolderType.map((entry) => (
                <li key={entry.holderType}>
                  <span className="capitalize">{entry.holderType}</span>: {entry.shares} ({entry.percent}%)
                </li>
              ))}
            </ul>
            <p className="mt-2">
              {view.capTable.convertingInstruments} SAFEs or notes ({view.capTable.convertingPrincipal}) convert in a priced round.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Data room</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <ul className="flex flex-col gap-1">
            {view.dataRoom.map((entry) => (
              <li key={entry.item}>
                {entry.item} <span className="text-xs text-muted-foreground">{entry.evidence}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

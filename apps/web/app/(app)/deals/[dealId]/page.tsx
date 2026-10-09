import { COMPANY_TYPE_LABELS } from '@pactlab/domain';
import { Badge, buttonVariants, Card, CardContent, CardHeader, CardTitle, Section, Stat } from '@pactlab/ui';
import { ArrowRight, CheckCircle2, Circle } from 'lucide-react';
import Link from 'next/link';
import { dealsApi } from '../_lib/api';
import { partyLabel } from '../_lib/labels';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

const number = new Intl.NumberFormat('en-US');

/** Deal overview: the parties, how far evidence collection has come, and where to go next. */
export default async function DealOverviewPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const [plan, sources, parties] = await Promise.all([
    dealsApi.sourcePlan(dealId),
    dealsApi.sources(dealId),
    dealsApi.parties(dealId),
  ]);
  const planned = plan.kind === 'ok' ? plan.data.sources : [];
  const connected = planned.filter((source) => source.status === 'CONNECTED').length;
  const evidence = sources.kind === 'ok' ? sources.data.items.reduce((total, source) => total + source.evidenceCount, 0) : 0;
  const failing = sources.kind === 'ok' ? sources.data.items.filter((source) => source.lastSyncRun?.status === 'FAILED').length : 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Sources connected" value={`${connected} of ${planned.length}`} hint={plan.kind === 'ok' && plan.data.note ? 'Industry pack planned' : undefined} />
        <Stat label="Evidence records" value={number.format(evidence)} hint="Every record traces back to its source" />
        <Stat label="Sources needing attention" value={failing} hint={failing > 0 ? 'Last sync failed' : 'All syncs healthy'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Section
          title="Evidence collection"
          description="The sources this deal needs. Connect each one through its API, or upload billing exports."
          actions={
            <Link href={`/deals/${dealId}/sources`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
              Open sources <ArrowRight aria-hidden className="h-4 w-4" />
            </Link>
          }
        >
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {planned.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No sources planned yet.</p>
              ) : (
                planned.map((source) => (
                  <div key={source.kind} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span className="flex items-center gap-3">
                      {source.status === 'CONNECTED' ? (
                        <CheckCircle2 aria-hidden className="h-5 w-5 text-emerald-600" />
                      ) : (
                        <Circle aria-hidden className="h-5 w-5 text-muted-foreground" />
                      )}
                      <span className="flex flex-col">
                        <span className="font-medium">
                          {source.label} · {source.providerLabel}
                        </span>
                        <span className="text-muted-foreground">{source.produces}</span>
                      </span>
                    </span>
                    <Badge variant={source.status === 'CONNECTED' ? 'calculation' : 'neutral'}>
                      {source.status === 'CONNECTED' ? 'Connected' : 'Not connected'}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </Section>

        <Section title="Parties">
          <Card>
            <CardContent className="flex flex-col gap-4 p-4 text-sm">
              {parties.kind === 'ok' && parties.data.items.length > 0 ? (
                parties.data.items.map((party) => (
                  <div key={party.role} className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {party.role === 'BUYER' ? 'Buyer' : 'Seller'}
                    </span>
                    <span className="font-medium">{partyLabel(party)}</span>
                    <span className="text-muted-foreground">
                      {party.ownership === 'PUBLIC' ? `Public${party.exchange ? ` · ${party.exchange}` : ''}` : 'Private'}
                      {party.companyType ? ` · ${COMPANY_TYPE_LABELS[party.companyType]}` : ''}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground">This deal was created before Pacts recorded buyer and seller.</p>
              )}
            </CardContent>
          </Card>
        </Section>
      </div>

      <Section title="Diligence">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { path: 'finances', title: 'Finances', body: 'ARR, retention and reconciliation from billing evidence.' },
            { path: 'findings', title: 'Findings', body: 'Technology findings awaiting review.' },
            { path: 'valuation', title: 'Valuation', body: 'Scenarios, bridge and frozen submissions.' },
            { path: 'documents', title: 'Documents', body: 'Contracts and filings with exact citations.' },
          ].map((item) => (
            <Link key={item.path} href={`/deals/${dealId}/${item.path}`} className="group">
              <Card className="h-full transition-colors group-hover:border-indigo">
                <CardHeader className="gap-1">
                  <CardTitle className="flex items-center justify-between text-base">
                    {item.title}
                    <ArrowRight aria-hidden className="h-4 w-4 text-muted-foreground group-hover:text-indigo-ink" />
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">{item.body}</p>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}

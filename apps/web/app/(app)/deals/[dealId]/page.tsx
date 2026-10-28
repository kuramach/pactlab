import { COMPANY_TYPE_LABELS, DEAL_PHASE_LABELS, DEAL_STAGES } from '@pactlab/domain';
import { moveStage } from './stage-actions';
import { Badge, buttonVariants, Card, CardContent, CardHeader, CardTitle, Glossed, IconTile, Section, Stat, type Accent } from '@pactlab/ui';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  Compass,
  Database,
  Factory,
  FileText,
  GitBranch,
  ListChecks,
  Plug,
  Receipt,
  SearchCheck,
  TrendingUp,
} from 'lucide-react';
import { BarChart, CHART_COLORS, DonutChart } from '../../_lib/charts';
import Link from 'next/link';
import { formatMoney } from '../../metrics/_lib/format';
import { BASIS_LABELS, describeGap, type ScenarioView } from '../../valuation/_lib/view';
import type { Finding } from '@pactlab/domain';
import type { AnchorsView, BenchmarkView } from '@pactlab/contracts';
import { apiGet, dealsApi } from '../_lib/api';
import { BENCHMARK_OUTCOMES, MultipleContext } from '../_lib/multiple-context';
import { ANCHOR_OUTCOMES, NegotiationAnchors } from '../_lib/negotiation-anchors';
import { OutcomeBanner } from '../_lib/outcome';
import { SextantExplanation } from '../_lib/sextant-explanation';
import { STAGE_LABELS } from '../_lib/labels';
import { can, dealViewer } from '../_lib/viewer';
import { partyLabel } from '../_lib/labels';
import { PipelineCard, pipelineSteps } from '../_lib/pipeline';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

const number = new Intl.NumberFormat('en-US');

const SOURCE_ICONS = { BILLING: Receipt, CODE: GitBranch, DELIVERY: ListChecks, DOCUMENTS: FileText, INDUSTRY: Factory } as const;
const AREAS: { path: string; title: string; body: string; icon: typeof TrendingUp; accent: Accent }[] = [
  { path: 'finances', title: 'Finances', body: 'ARR, retention and reconciliation from billing evidence.', icon: TrendingUp, accent: 'teal' },
  { path: 'findings', title: 'Findings', body: 'Technology findings awaiting review.', icon: SearchCheck, accent: 'rose' },
  { path: 'valuation', title: 'Valuation', body: 'Sextant scenarios, the bridge and the asking price.', icon: Compass, accent: 'indigo' },
  { path: 'documents', title: 'Documents', body: 'Contracts and filings with exact citations.', icon: FileText, accent: 'amber' },
];

/** Deal overview: the parties, how far evidence collection has come, and where to go next. */
export default async function DealOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { dealId } = await params;
  const outcome = (await searchParams)['outcome'];
  const [plan, sources, parties, asking, scenarios, viewer, accepted, deal, documentList, documentFindings] = await Promise.all([
    dealsApi.sourcePlan(dealId),
    dealsApi.sources(dealId),
    dealsApi.parties(dealId),
    dealsApi.askingPrice(dealId),
    apiGet<{ items: ScenarioView[] }>(`/v1/deals/${dealId}/valuation/scenarios`),
    dealViewer(dealId),
    apiGet<{ items: Finding[] }>(`/v1/deals/${dealId}/findings?status=ACCEPTED`),
    dealsApi.get(dealId),
    apiGet<{ items: { id: string }[] }>(`/v1/deals/${dealId}/documents`),
    apiGet<{ items: { status: string }[] }>(`/v1/deals/${dealId}/document-findings`),
  ]);
  const scenarioItems = scenarios.kind === 'ok' ? scenarios.data.items : [];
  const pipeline = pipelineSteps(dealId, {
    documents: documentList.kind === 'ok' ? documentList.data.items.length : 0,
    drafts: documentFindings.kind === 'ok' ? documentFindings.data.items.filter((item) => item.status === 'DRAFT').length : 0,
    accepted: accepted.kind === 'ok' ? accepted.data.items.length : 0,
    scenarios: scenarioItems.length,
    staleScenarios: scenarioItems.filter((view) => view.stale === true).length,
  });
  const current = asking.kind === 'ok' ? asking.data.current : null;
  // Headline scenario: the approved one if there is one, else the latest that has run.
  const compared = (scenarios.kind === 'ok' ? scenarios.data.items : []).filter((view) => view.askingComparison?.comparable);
  const headline = compared.find((view) => view.scenario.status === 'APPROVED') ?? compared[0];
  const comparison = headline?.askingComparison?.comparable ? headline.askingComparison : null;
  const [benchmark, anchors] =
    scenarios.kind === 'ok'
      ? await Promise.all([
          apiGet<BenchmarkView>(`/v1/deals/${dealId}/benchmark${headline ? `?scenarioId=${headline.scenario.id}` : ''}`),
          apiGet<AnchorsView>(`/v1/deals/${dealId}/anchors`),
        ])
      : [null, null];
  const planned = plan.kind === 'ok' ? plan.data.sources : [];
  const connected = planned.filter((source) => source.status === 'CONNECTED').length;
  const evidence = sources.kind === 'ok' ? sources.data.items.reduce((total, source) => total + source.evidenceCount, 0) : 0;
  const failing = sources.kind === 'ok' ? sources.data.items.filter((source) => source.lastSyncRun?.status === 'FAILED').length : 0;

  return (
    <div className="flex flex-col gap-8">
      <OutcomeBanner
        outcome={typeof outcome === 'string' ? outcome : undefined}
        messages={{
          ...BENCHMARK_OUTCOMES,
          ...ANCHOR_OUTCOMES,
          'ok-stage': 'Pipeline stage updated.',
          'stage-forbidden': 'Your role cannot move this pact along its pipeline.',
          'stage-error': 'The stage could not be changed. Try again.',
        }}
      />
      {deal.kind === 'ok' && can.draft(viewer.role) ? (
        <form action={moveStage.bind(null, dealId)} className="flex flex-wrap items-end gap-3 text-sm" aria-label="Pipeline stage">
          <label className="flex flex-col gap-1 font-medium">
            Pipeline stage <span className="text-xs font-normal text-muted-foreground">Phase: {DEAL_PHASE_LABELS[deal.data.phase]} · Screening → Pre-Diligence, Diligence to Signed → Diligence, Closed → Post-Close</span>
            <select name="stage" defaultValue={deal.data.stage} className="rounded-md border border-border bg-background px-2 py-1">
              {DEAL_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {STAGE_LABELS[stage] ?? stage}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-md border border-border px-3 py-1 font-medium">
            Move
          </button>
        </form>
      ) : null}
      <PipelineCard steps={pipeline} />
      {asking.kind === 'ok' ? (
        <Card className="border-indigo/30 bg-secondary/60">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
            {current ? (
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2" data-numeric>
                <span>
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">Asking</span>
                  <span className="ml-2 font-mono text-xl font-semibold">{formatMoney({ amount: current.amount, currency: current.currency })}</span>
                  <span className="ml-1 text-sm text-muted-foreground">{BASIS_LABELS[current.basis]}</span>
                </span>
                {comparison && headline ? (
                  <>
                    <span>
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">Sextant</span>
                      <span className="ml-2 font-mono text-xl font-semibold">{formatMoney(comparison.afterRisks.value)}</span>
                      <span className="ml-1 text-sm text-muted-foreground">
                        <Glossed text={`after accepted risks · ${headline.scenario.name}`} />
                      </span>
                    </span>
                    <Badge variant={comparison.afterRisks.verdict === 'BELOW' ? 'danger' : 'calculation'}>{describeGap(comparison.afterRisks)}</Badge>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">Run a Sextant scenario to test this price.</span>
                )}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">No asking price yet. Record the seller’s price to test it in Sextant.</span>
            )}
            <Link href={`/deals/${dealId}/valuation`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
              Open valuation <ArrowRight aria-hidden className="h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {headline ? (
        <SextantExplanation
          dealId={dealId}
          view={headline}
          viewer={viewer}
          findings={accepted.kind === 'ok' ? accepted.data.items : []}
          benchmark={benchmark?.kind === 'ok' ? benchmark.data : null}
        />
      ) : null}

      {benchmark?.kind === 'ok' && (current || benchmark.data.scenario) ? (
        <MultipleContext dealId={dealId} benchmark={benchmark.data} returnTo={`/deals/${dealId}`} />
      ) : null}

      {anchors?.kind === 'ok' && (anchors.data.items.length > 0 || anchors.data.canEdit) ? (
        <NegotiationAnchors dealId={dealId} view={anchors.data} returnTo={`/deals/${dealId}`} />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Sources connected" value={`${connected} of ${planned.length}`} icon={<Plug />} accent="indigo" />
        <Stat label="Evidence records" value={number.format(evidence)} hint="Every record traces back to its source" icon={<Database />} accent="teal" />
        <Stat
          label="Sources needing attention"
          value={failing}
          hint={failing > 0 ? 'Last sync failed' : 'All syncs healthy'}
          icon={<AlertTriangle />}
          accent={failing > 0 ? 'rose' : 'amber'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <IconTile accent="indigo">
              <Compass />
            </IconTile>
            <div>
              <CardTitle>Asking price vs Sextant</CardTitle>
              <p className="text-sm text-muted-foreground">
                <Glossed text={`${headline ? `${headline.scenario.name} · ` : ''}before and after accepted priced risks`} />
              </p>
            </div>
          </CardHeader>
          <CardContent>
            {current && comparison ? (
              <BarChart
                label="Asking price compared with Sextant before and after risks"
                categories={['Asking price', 'Sextant before risks', 'Sextant after risks']}
                currency={current.currency}
                series={[
                  {
                    name: 'Value',
                    values: [current.amount, comparison.beforeRisks.value.amount, comparison.afterRisks.value.amount],
                  },
                ]}
                height={240}
              />
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {current ? 'Run a Sextant scenario to compare it with the asking price.' : 'Record the asking price to compare it with Sextant.'}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <IconTile accent="teal">
              <Plug />
            </IconTile>
            <CardTitle>Evidence collection</CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart
              label="Sources connected and still to connect"
              centerLabel={`${connected}/${planned.length}`}
              slices={[
                {
                  name: 'Connected',
                  value: connected,
                  color: CHART_COLORS.teal,
                  items: planned
                    .filter((source) => source.status === 'CONNECTED')
                    .map((source) => `${source.label} · ${source.connections.map((connection) => connection.displayName).join(', ') || source.providerLabel}`),
                },
                {
                  name: 'To connect',
                  value: planned.length - connected,
                  color: '#cbd5e1',
                  items: planned
                    .filter((source) => source.status !== 'CONNECTED')
                    .map((source) => `${source.label} · ${source.providerLabel}`),
                },
              ]}
            />
            <ul className="mt-3 flex flex-col gap-1.5 text-sm">
              {planned.map((source) => (
                <li key={source.kind} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={`h-2.5 w-2.5 rounded-full ${source.status === 'CONNECTED' ? 'bg-teal' : 'bg-slate-300'}`}
                    />
                    {source.label} · {source.providerLabel}
                  </span>
                  <span className={source.status === 'CONNECTED' ? 'font-semibold text-teal' : 'text-muted-foreground'}>
                    {source.status === 'CONNECTED' ? 'Connected' : 'To connect'}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
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
                      {(() => {
                        const Icon = SOURCE_ICONS[source.kind];
                        return (
                          <IconTile accent={source.status === 'CONNECTED' ? 'teal' : 'indigo'} className="h-10 w-10">
                            <Icon />
                          </IconTile>
                        );
                      })()}
                      {source.status === 'CONNECTED' ? (
                        <CheckCircle2 aria-label="Connected" className="h-5 w-5 text-teal" />
                      ) : (
                        <Circle aria-label="Not connected" className="h-5 w-5 text-muted-foreground" />
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
                      {party.companyType ? (
                        <>
                          {' · '}
                          <Glossed text={COMPANY_TYPE_LABELS[party.companyType]} />
                        </>
                      ) : null}
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
          {AREAS.map((item) => (
            <Link key={item.path} href={`/deals/${dealId}/${item.path}`} className="group">
              <Card className="h-full transition hover:-translate-y-0.5 hover:border-indigo hover:shadow-lg hover:shadow-indigo/10">
                <CardHeader className="gap-3">
                  <IconTile accent={item.accent}>
                    <item.icon />
                  </IconTile>
                  <CardTitle className="flex items-center justify-between text-base">
                    {item.title}
                    <ArrowRight aria-hidden className="h-4 w-4 text-muted-foreground group-hover:text-indigo-ink" />
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    <Glossed text={item.body} />
                  </p>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}

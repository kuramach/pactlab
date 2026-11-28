import type { FinancingView } from '@pactlab/contracts';
import { redirect } from 'next/navigation';
import { DEAL_STAGES } from '@pactlab/domain';
import { moveStage } from './stage-actions';
import { Badge, buttonVariants, Card, CardContent, CardHeader, CardTitle, Glossed, IconTile, Section, Stat, type Accent, Button } from '@pactlab/ui';
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
import { metricsApi } from '../../metrics/_lib/api';
import type { DocumentRequestView } from './documents/requests-card';
import { PropertyMetricsCard } from '../_lib/property-metrics';
import { marketRentsOffer } from '../_lib/market-rents';
import { marketRentsStatus } from '../_lib/market-rents-actions';
import { BASIS_LABELS, describeGap, type ScenarioView } from '../../valuation/_lib/view';
import type { Finding } from '@pactlab/domain';
import type { AnchorsView, BenchmarkView } from '@pactlab/contracts';
import { apiGet, apiGetAll, dealsApi } from '../_lib/api';
import { FinancingPosture } from '../_lib/financing';
import { BENCHMARK_OUTCOMES, MultipleContext } from '../_lib/multiple-context';
import { ANCHOR_OUTCOMES, NegotiationAnchors } from '../_lib/negotiation-anchors';
import { OutcomeBanner } from '../_lib/outcome';
import { SextantExplanation } from '../_lib/sextant-explanation';
import { can, dealViewer } from '../_lib/viewer';
import { partyLabel } from '../_lib/labels';
import { PipelineCard, pipelineSteps } from '../_lib/pipeline';
import { getI18n } from '../../../../lib/i18n/server';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

const SOURCE_ICONS = { BILLING: Receipt, CODE: GitBranch, DELIVERY: ListChecks, DOCUMENTS: FileText, INDUSTRY: Factory } as const;
/** The diligence areas; their words are in the catalog (`home.diligence`). */
const AREAS: { path: 'finances' | 'findings' | 'valuation' | 'documents'; icon: typeof TrendingUp; accent: Accent }[] = [
  { path: 'finances', icon: TrendingUp, accent: 'teal' },
  { path: 'findings', icon: SearchCheck, accent: 'rose' },
  { path: 'valuation', icon: Compass, accent: 'indigo' },
  { path: 'documents', icon: FileText, accent: 'amber' },
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
  const t = await getI18n();
  const words = t.m.home;
  const outcome = (await searchParams)['outcome'];
  // A bidder's pact is their bid (T-097).
  const role = (await dealViewer(dealId)).role;
  if (role === 'BIDDER') redirect(`/deals/${dealId}/bid`);
  // An investor in a pooled vehicle (T-141) sees their own seat and the published investor view only.
  if (role === 'INVESTOR') redirect(`/deals/${dealId}/spv`);
  const [plan, sources, parties, asking, scenarios, viewer, accepted, deal, documentList, documentFindings, financing] = await Promise.all([
    dealsApi.sourcePlan(dealId),
    dealsApi.sources(dealId),
    dealsApi.parties(dealId),
    dealsApi.askingPrice(dealId),
    apiGet<{ items: ScenarioView[] }>(`/v1/deals/${dealId}/valuation/scenarios`),
    dealViewer(dealId),
    // Accepted findings are each reviewed by a person, so the set stays small: read every page (T-126).
    apiGetAll<Finding>(`/v1/deals/${dealId}/findings?status=ACCEPTED`),
    dealsApi.get(dealId),
    // Counts only: one row each, and the totals (T-126).
    apiGet<{ total: number }>(`/v1/deals/${dealId}/documents?limit=1`),
    apiGet<{ total: number }>(`/v1/deals/${dealId}/document-findings?status=DRAFT&limit=1`),
    apiGet<FinancingView>(`/v1/deals/${dealId}/financing`),
  ]);
  // The pack's metrics on Home, and what has already been asked of the seller (Kumar, 2026-11-25). The buyer side only:
  // the API refuses a counterparty, and the card is then left out.
  const [packMetrics, requests] = await Promise.all([metricsApi.pack(dealId), apiGet<{ items: DocumentRequestView[] }>(`/v1/deals/${dealId}/document-requests`)]);
  const requested = new Set(requests.kind === 'ok' ? requests.data.items.filter((request) => request.status === 'OPEN').flatMap((request) => request.items.filter((item) => !item.received).map((item) => item.id)) : []);
  // Market rents (T-158): offered on a multifamily pact's metrics to the buyer team's writers; the API re-checks.
  const marketStatus = packMetrics.kind === 'ok' && packMetrics.data.metrics.some((metric) => metric.key === 'market_rent_annual') && can.draft(viewer.role) ? await marketRentsStatus(dealId) : null;
  const marketRents = marketStatus?.kind === 'ok' ? marketRentsOffer(marketStatus.data) : null;
  const hasSeller = viewer.members.some((member) => member.role === 'TARGET_CONTRIBUTOR' && member.status === 'ACTIVE');
  const scenarioItems = scenarios.kind === 'ok' ? scenarios.data.items : [];
  const pipeline = pipelineSteps(dealId, {
    documents: documentList.kind === 'ok' ? documentList.data.total : 0,
    drafts: documentFindings.kind === 'ok' ? documentFindings.data.total : 0,
    accepted: accepted.kind === 'ok' ? accepted.data.items.length : 0,
    scenarios: scenarioItems.length,
    staleScenarios: scenarioItems.filter((view) => view.stale === true).length,
  }, t);
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
        messages={{ ...BENCHMARK_OUTCOMES, ...ANCHOR_OUTCOMES, ...words.outcomes }}
        t={t}
      />
      {deal.kind === 'ok' && can.draft(viewer.role) ? (
        <form action={moveStage.bind(null, dealId)} className="flex flex-wrap items-end gap-3 text-sm" aria-label={words.stage.form}>
          <label className="flex flex-col gap-1 font-medium">
            {words.stage.label} <span className="text-xs font-normal text-muted-foreground">{t.fill(words.stage.phase, { phase: t.m.common.phases[deal.data.phase] })}</span>
            <select name="stage" defaultValue={deal.data.stage} className="rounded-md border border-border bg-background px-2 py-1">
              {DEAL_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {t.m.common.stages[stage]}
                </option>
              ))}
            </select>
          </label>
          <Button variant="outline" size="sm" type="submit">
            {words.stage.move}
          </Button>
        </form>
      ) : null}
      <PipelineCard steps={pipeline} t={t} />
      {packMetrics.kind === 'ok' ? <PropertyMetricsCard dealId={dealId} report={packMetrics.data} canAsk={can.draft(viewer.role) && hasSeller} requested={requested} marketRents={marketRents} /> : null}
      {/* Certainty of close (T-117): how the buyer funds the deal, as attested; the seller's first question. */}
      {financing.kind === 'ok' && financing.data.side && financing.data.plans.some((entry) => entry.tranches.length > 0 || entry.escrow) ? (
        <Card>
          <CardContent className="flex flex-col gap-2 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{financing.data.plans.length > 1 ? words.financing.bidders : words.financing.buyer}</p>
              <Link href={`/deals/${dealId}/financing`} className="text-sm underline underline-offset-4">
                {words.financing.open}
              </Link>
            </div>
            {financing.data.plans.map((entry) => (
              <div key={entry.bidId ?? 'plan'} className="flex flex-wrap items-center gap-2">
                {entry.firmName ? <span className="text-sm font-medium">{entry.firmName}:</span> : null}
                <FinancingPosture posture={entry.posture} compact />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
      {asking.kind === 'ok' ? (
        <Card className="border-indigo/30 bg-secondary/60">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
            {current ? (
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2" data-numeric>
                <span>
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">{words.asking.asking}</span>
                  <span className="ml-2 font-mono text-xl font-semibold">{t.money({ amount: current.amount, currency: current.currency })}</span>
                  <span className="ml-1 text-sm text-muted-foreground">{BASIS_LABELS[current.basis]}</span>
                </span>
                {comparison && headline ? (
                  <>
                    <span>
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">{words.asking.sextant}</span>
                      <span className="ml-2 font-mono text-xl font-semibold">{t.money(comparison.afterRisks.value)}</span>
                      <span className="ml-1 text-sm text-muted-foreground">
                        <Glossed text={t.fill(words.asking.afterRisks, { scenario: headline.scenario.name })} />
                      </span>
                    </span>
                    <Badge variant={comparison.afterRisks.verdict === 'BELOW' ? 'danger' : 'calculation'}>{describeGap(comparison.afterRisks)}</Badge>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">{words.asking.runScenario}</span>
                )}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">{words.asking.none}</span>
            )}
            <Link href={`/deals/${dealId}/valuation`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
              {words.asking.openValuation} <ArrowRight aria-hidden className="h-4 w-4" />
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
        <Stat label={words.stats.connected} value={t.fill(words.stats.connectedValue, { connected: t.number(connected), planned: t.number(planned.length) })} icon={<Plug />} accent="indigo" />
        <Stat label={words.stats.evidence} value={t.number(evidence)} hint={words.stats.evidenceHint} icon={<Database />} accent="teal" />
        <Stat
          label={words.stats.attention}
          value={t.number(failing)}
          hint={failing > 0 ? words.stats.failed : words.stats.healthy}
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
              <CardTitle>{words.chart.title}</CardTitle>
              <p className="text-sm text-muted-foreground">
                <Glossed text={headline ? t.fill(words.chart.subtitleScenario, { scenario: headline.scenario.name }) : words.chart.subtitle} />
              </p>
            </div>
          </CardHeader>
          <CardContent>
            {current && comparison ? (
              <BarChart
                label={words.chart.label}
                categories={[words.chart.categories.asking, words.chart.categories.before, words.chart.categories.after]}
                currency={current.currency}
                series={[
                  {
                    name: words.chart.series,
                    values: [current.amount, comparison.beforeRisks.value.amount, comparison.afterRisks.value.amount],
                  },
                ]}
                height={240}
              />
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {current ? words.chart.runScenario : words.chart.recordAsking}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <IconTile accent="teal">
              <Plug />
            </IconTile>
            <CardTitle>{words.collection.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart
              label={words.collection.donut}
              centerLabel={`${connected}/${planned.length}`}
              slices={[
                {
                  name: words.collection.connected,
                  value: connected,
                  color: CHART_COLORS.teal,
                  items: planned
                    .filter((source) => source.status === 'CONNECTED')
                    .map((source) => `${source.label} · ${source.connections.map((connection) => connection.displayName).join(', ') || source.providerLabel}`),
                },
                {
                  name: words.collection.toConnect,
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
                    {source.status === 'CONNECTED' ? words.collection.connected : words.collection.toConnect}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Section
          title={words.collection.title}
          description={words.collection.description}
          actions={
            <Link href={`/deals/${dealId}/sources`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
              {words.collection.openSources} <ArrowRight aria-hidden className="h-4 w-4" />
            </Link>
          }
        >
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {planned.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">{words.collection.none}</p>
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
                        <CheckCircle2 aria-label={words.collection.connected} className="h-5 w-5 text-teal" />
                      ) : (
                        <Circle aria-label={words.collection.notConnected} className="h-5 w-5 text-muted-foreground" />
                      )}
                      <span className="flex flex-col">
                        <span className="font-medium">
                          {source.label} · {source.providerLabel}
                        </span>
                        <span className="text-muted-foreground">{source.produces}</span>
                      </span>
                    </span>
                    <Badge variant={source.status === 'CONNECTED' ? 'calculation' : 'neutral'}>
                      {source.status === 'CONNECTED' ? words.collection.connected : words.collection.notConnected}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </Section>

        <Section title={words.parties.title}>
          <Card>
            <CardContent className="flex flex-col gap-4 p-4 text-sm">
              {parties.kind === 'ok' && parties.data.items.length > 0 ? (
                parties.data.items.map((party) => (
                  <div key={party.role} className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {party.role === 'BUYER' ? words.parties.buyer : words.parties.seller}
                    </span>
                    <span className="font-medium">{partyLabel(party)}</span>
                    <span className="text-muted-foreground">
                      {party.ownership === 'PUBLIC' ? (party.exchange ? t.fill(words.parties.publicOn, { exchange: party.exchange }) : words.parties.public) : words.parties.private}
                      {party.companyType ? (
                        <>
                          {' · '}
                          <Glossed text={t.m.common.companyTypes[party.companyType]} />
                        </>
                      ) : null}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground">{words.parties.legacy}</p>
              )}
            </CardContent>
          </Card>
        </Section>
      </div>

      <Section title={words.diligence.title}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {AREAS.map((item) => (
            <Link key={item.path} href={`/deals/${dealId}/${item.path}`} className="group">
              <Card className="h-full transition hover:-translate-y-0.5 hover:border-indigo hover:shadow-lg hover:shadow-indigo/10">
                <CardHeader className="gap-3">
                  <IconTile accent={item.accent}>
                    <item.icon />
                  </IconTile>
                  <CardTitle className="flex items-center justify-between text-base">
                    {words.diligence[item.path].title}
                    <ArrowRight aria-hidden className="h-4 w-4 text-muted-foreground group-hover:text-indigo-ink" />
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    <Glossed text={words.diligence[item.path].body} />
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

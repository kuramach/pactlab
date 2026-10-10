import { Badge, buttonVariants, Card, CardContent, CardHeader, CardTitle, EmptyState, Glossed, IconTile, PageHeader, Section, Stat } from '@pactlab/ui';
import { Activity, ArrowRight, Briefcase, Building2, Compass, Plus, Scale, Search } from 'lucide-react';
import Link from 'next/link';
import { getSessionContext } from '../../lib/session';
import { BarChart, CHART_COLORS, DonutChart } from './_lib/charts';
import { apiGet, dealsApi, type DealListItem } from './deals/_lib/api';
import { DEAL_TYPE_LABELS, partyLabel, STAGE_LABELS } from './deals/_lib/labels';
import { formatMoney } from './metrics/_lib/format';
import type { ScenarioView } from './valuation/_lib/view';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

const LOOP = ['Source evidence', 'Normalized evidence', 'Reviewable finding', 'Explicit assumption', 'Valuation scenario', 'Proposed deal term', 'Approved action'];
const STAGE_COLORS: Record<string, string> = {
  SCREENING: CHART_COLORS.slate,
  DILIGENCE: CHART_COLORS.indigo,
  NEGOTIATION: CHART_COLORS.amber,
  SIGNED: CHART_COLORS.teal,
  CLOSED: CHART_COLORS.navy,
};

/** Sextant's headline value per deal: the approved scenario, else the latest run, after accepted risks. */
async function sextantValue(deal: DealListItem): Promise<string | null> {
  if (!deal.askingPrice) return null;
  const scenarios = await apiGet<{ items: ScenarioView[] }>(`/v1/deals/${deal.id}/valuation/scenarios`);
  if (scenarios.kind !== 'ok') return null;
  const compared = scenarios.data.items.filter((view) => view.askingComparison?.comparable);
  const headline = compared.find((view) => view.scenario.status === 'APPROVED') ?? compared[0];
  return headline?.askingComparison?.comparable ? headline.askingComparison.afterRisks.value.amount : null;
}

/** Home: your deals at a glance, in pictures first. */
export default async function HomePage() {
  const session = await getSessionContext();
  if (session.kind !== 'signed-in') {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader tone="navy" title="Welcome to Pactlab" description="Test the pact before you sign it." />
        <EmptyState
          title="Sign in to see your deals"
          description="Pactlab keeps every result traceable to source evidence and a reviewer decision."
          action={
            <a href="/login" className={buttonVariants()}>
              Sign in
            </a>
          }
        />
      </div>
    );
  }
  const deals = await dealsApi.list();
  const items = deals.kind === 'ok' ? deals.data.items : [];
  const firstName = session.displayName.replace(/\(.*?\)/g, '').trim().split(/\s+/)[0] ?? '';
  // One chart, one currency: the first priced deal's.
  const currency = items.find((deal) => deal.askingPrice)?.askingPrice?.currency ?? 'USD';
  const priced = items.filter((deal) => deal.askingPrice?.currency === currency).slice(0, 8);
  const sextant = await Promise.all(priced.map(sextantValue));
  const stages = Object.entries(
    items.reduce<Record<string, number>>((counts, deal) => ({ ...counts, [deal.stage]: (counts[deal.stage] ?? 0) + 1 }), {}),
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        tone="navy"
        eyebrow={session.organization?.name}
        title={firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
        description="Test the pact before you sign it. Every number traces back to its source, and every decision is signed by a person."
        actions={
          <Link href="/pacts/new" className={buttonVariants()}>
            <Plus aria-hidden className="h-4 w-4" />
            Start a Pact
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="My deals" value={items.length} icon={<Briefcase />} accent="indigo" />
        <Stat label="Active" value={items.filter((deal) => deal.status === 'ACTIVE').length} icon={<Activity />} accent="teal" />
        <Stat label="In diligence" value={items.filter((deal) => deal.stage === 'DILIGENCE').length} icon={<Search />} accent="amber" />
        <Stat
          label="Asking prices tested"
          value={priced.length}
          hint="Deals with a seller’s price to vet"
          icon={<Scale />}
          accent="navy"
        />
      </div>

      {items.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <Card>
            <CardHeader className="flex flex-row items-center gap-3">
              <IconTile accent="indigo">
                <Compass />
              </IconTile>
              <div>
                <CardTitle>Asking price vs Sextant</CardTitle>
                <p className="text-sm text-muted-foreground">Sextant’s value after accepted risks, on each price’s basis.</p>
              </div>
            </CardHeader>
            <CardContent>
              {priced.length === 0 ? (
                <p className="text-sm text-muted-foreground">Record asking prices on your deals to compare them here.</p>
              ) : (
                <BarChart
                  label="Asking price and Sextant value by deal"
                  categories={priced.map((deal) => deal.name)}
                  currency={currency}
                  series={[
                    { name: 'Asking price', values: priced.map((deal) => deal.askingPrice?.amount ?? null), color: CHART_COLORS.amber },
                    { name: 'Sextant (after risks)', values: sextant, color: CHART_COLORS.indigo },
                  ]}
                />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center gap-3">
              <IconTile accent="teal">
                <Activity />
              </IconTile>
              <CardTitle>Deals by stage</CardTitle>
            </CardHeader>
            <CardContent>
              <DonutChart
                label="Number of deals in each stage"
                centerLabel={String(items.length)}
                slices={stages.map(([stage, count]) => ({ name: STAGE_LABELS[stage] ?? stage, value: count, color: STAGE_COLORS[stage] ?? CHART_COLORS.slate }))}
              />
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Section
        title="Recent deals"
        actions={
          <Link href="/deals" className="flex items-center gap-1 text-sm font-bold text-indigo-ink hover:underline">
            All deals <ArrowRight aria-hidden className="h-4 w-4" />
          </Link>
        }
      >
        {items.length === 0 ? (
          <EmptyState
            title="No deals yet"
            description="Start a Pact: describe the buyer and seller, and Pactlab switches on the sources to collect."
            action={
              <Link href="/pacts/new" className={buttonVariants()}>
                Start a Pact
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.slice(0, 6).map((deal) => {
              const buyer = deal.parties?.find((party) => party.role === 'BUYER');
              const seller = deal.parties?.find((party) => party.role === 'SELLER');
              return (
                <Link key={deal.id} href={`/deals/${deal.id}`} className="group">
                  <Card className="h-full transition hover:-translate-y-0.5 hover:border-indigo hover:shadow-lg hover:shadow-indigo/10">
                    <CardContent className="flex h-full flex-col gap-4 p-5">
                      <div className="flex items-start gap-3">
                        <IconTile accent="navy">
                          <Building2 />
                        </IconTile>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="font-bold group-hover:text-indigo-ink">{deal.name}</span>
                          <span className="truncate text-sm text-muted-foreground">
                            {buyer && seller ? `${partyLabel(buyer)} → ${partyLabel(seller)}` : deal.targetName}
                          </span>
                        </div>
                        <Badge>{STAGE_LABELS[deal.stage] ?? deal.stage}</Badge>
                      </div>
                      <div className="mt-auto flex items-end justify-between gap-2 border-t border-navy/10 pt-3">
                        <span className="text-xs font-semibold text-slate-text">{DEAL_TYPE_LABELS[deal.transactionType] ?? deal.transactionType}</span>
                        {deal.askingPrice ? (
                          <span className="flex flex-col items-end">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-text">Asking</span>
                            <span className="font-mono text-base font-bold" data-numeric>
                              {formatMoney({ amount: deal.askingPrice.amount, currency: deal.askingPrice.currency })}
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">No asking price</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="How Pactlab works" description="Every result stays traceable to source evidence and a reviewer decision.">
        <ol className="flex flex-wrap items-center gap-2 text-sm">
          {LOOP.map((step, index) => (
            <li key={step} className="flex items-center gap-2">
              <span className="rounded-full border border-indigo/30 bg-white px-3 py-1.5 font-semibold text-navy shadow-sm">
                <Glossed text={step} />
              </span>
              {index < LOOP.length - 1 ? <ArrowRight aria-hidden className="h-3.5 w-3.5 text-indigo" /> : null}
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}

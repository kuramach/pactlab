import type { BenchmarkView } from '@pactlab/contracts';
import type { Finding } from '@pactlab/domain';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Glossed, IconTile, Term } from '@pactlab/ui';
import { BadgeCheck, Calculator, Compass, Landmark, ShieldAlert, Wallet } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatMoney } from '../../metrics/_lib/format';
import { fractionToPercent } from '../../valuation/_lib/form';
import { BASIS_LABELS, ENTERED_BRIDGE_KINDS, describeGap, type ScenarioView } from '../../valuation/_lib/view';
import { WaterfallChart } from '../../_lib/charts';
import { MultipleContextLine } from './multiple-context';
import type { DealViewer } from './viewer';

const RISK_LABELS: Record<string, string> = {
  PRICE_REDUCTION: 'Price reduction',
  ESCROW: 'Escrow',
  INDEMNITY: 'Indemnity',
  REMEDIATION_COST: 'Remediation cost',
};
const POINT_LABELS = { LOW: 'low end', MID: 'midpoint', HIGH: 'high end' } as const;
const EQUITY_STEPS = new Set(['CASH', 'CASH_ITEM', 'DEBT', 'DEBT_ITEM', 'DEBT_LIKE_ITEMS', 'DEBT_LIKE_ITEM', 'WORKING_CAPITAL']);

const money = (amount: string, currency: string) => formatMoney({ amount, currency });
const pct = (fraction: string) => `${fractionToPercent(fraction)}%`;

function Step({ number, icon, title, children }: { number: number; icon: ReactNode; title: ReactNode; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <div className="flex flex-col items-center">
        <IconTile accent="indigo">{icon}</IconTile>
        <span aria-hidden className="mt-1 w-px flex-1 bg-indigo/20" />
      </div>
      <div className="flex flex-col gap-1 pb-5">
        <span className="text-xs font-bold uppercase tracking-widest text-indigo-ink">Step {number}</span>
        <span className="font-bold">{title}</span>
        <div className="text-sm leading-relaxed text-slate-text">{children}</div>
      </div>
    </li>
  );
}

/**
 * How Sextant reached its value, and why it differs from the asking price:
 * the method and its inputs, the bridge to equity where the price is quoted
 * on equity, each accepted risk with its range and basis, and who ran and
 * approved it. Every figure comes from the stored run; nothing is recomputed
 * here.
 */
export function SextantExplanation({
  dealId,
  view,
  viewer,
  findings,
  benchmark = null,
}: {
  dealId: string;
  view: ScenarioView;
  viewer: DealViewer;
  findings: readonly Pick<Finding, 'id' | 'title'>[];
  /** Comparables context for the multiple, when the viewer may see it. */
  benchmark?: BenchmarkView | null;
}) {
  const run = view.latestRun;
  const comparison = view.askingComparison;
  if (!run || !comparison?.comparable) return null;
  const { result } = run;
  const currency = comparison.asking.currency;
  const titles = new Map(findings.map((finding) => [finding.id, finding.title]));
  const adjustments = run.inputs?.adjustments ?? [];
  const priced = comparison.riskAdjustments;
  const approval = view.decisions.find((decision) => decision.decision === 'APPROVED');
  const equityBasis = comparison.basis === 'EQUITY_VALUE';
  let step = 0;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start gap-3">
        <IconTile accent="navy">
          <Compass />
        </IconTile>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <CardTitle>How Sextant reached this value</CardTitle>
          <CardDescription>
            {view.scenario.name} · Sextant values the target at {money(comparison.afterRisks.value.amount, currency)} on an{' '}
            {BASIS_LABELS[comparison.basis]} basis — {describeGap(comparison.afterRisks)} of {money(comparison.asking.amount, currency)}.
          </CardDescription>
        </div>
        <Link href={`/deals/${dealId}/valuation`} className="text-sm font-bold text-indigo-ink hover:underline">
          Open in Valuation →
        </Link>
      </CardHeader>
      <CardContent className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-bold">From the asking price to Sextant’s value</span>
          <WaterfallChart
            label="From the asking price to Sextant's value, step by step"
            currency={currency}
            height={300}
            steps={[
              { name: 'Asking price', amount: comparison.asking.amount, kind: 'total' },
              { name: equityBasis ? 'Valuation & bridge' : 'Valuation', amount: comparison.beforeRisks.gap.amount, kind: 'step' },
              ...priced.map((line) => ({ name: titles.get(line.findingId) ?? line.label, amount: line.amount.amount, kind: 'step' as const })),
              { name: 'Sextant', amount: comparison.afterRisks.value.amount, kind: 'total' },
            ]}
          />
          <dl className="grid grid-cols-2 gap-3 text-sm" data-numeric>
            <div className="rounded-xl bg-mist p-3">
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-text">Valuation vs ask</dt>
              <dd className="font-mono font-bold">{money(comparison.beforeRisks.gap.amount, currency)}</dd>
              <dd className="text-xs text-muted-foreground">{describeGap(comparison.beforeRisks)} before any risk</dd>
            </div>
            <div className="rounded-xl bg-mist p-3">
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-text">Total gap to ask</dt>
              <dd className="font-mono font-bold">{money(comparison.afterRisks.gap.amount, currency)}</dd>
              <dd className="text-xs text-muted-foreground">
                {describeGap(comparison.afterRisks)} after{' '}
                {priced.length === 0
                  ? 'risks (no price reductions applied)'
                  : `${priced.length} accepted price reduction${priced.length === 1 ? '' : 's'}`}
              </dd>
            </div>
          </dl>
        </div>

        <ol className="flex flex-col">
          <Step number={++step} icon={<Calculator />} title={<>Value the business ({result.method.method === 'DCF' ? <Term term="DCF" /> : <><Term term="ARR" /> multiple</>})</>}>
            {run.inputs?.assumptions.method === 'ARR_MULTIPLE' ? (
              <p>
                <Link href={`/deals/${dealId}/finances`} className="font-semibold text-indigo-ink hover:underline">
                  <Term term="ARR" /> {money(run.inputs.assumptions.arr, currency)}
                </Link>{' '}
                × a multiple of <b>{run.inputs.assumptions.multiple}×</b> = enterprise value <b>{formatMoney(result.enterpriseValue)}</b>. The
                multiple is the main judgement call: each 1× is worth {money(run.inputs.assumptions.arr, currency)}.
              </p>
            ) : null}
            {benchmark && run.inputs?.assumptions.method === 'ARR_MULTIPLE' && benchmark.scenario?.id === view.scenario.id ? (
              <MultipleContextLine benchmark={benchmark} />
            ) : null}
            {run.inputs?.assumptions.method === 'ARR_MULTIPLE' ? null : run.inputs?.assumptions.method === 'DCF' ? (
              <p>
                Base revenue <b>{money(run.inputs.assumptions.baseRevenue, currency)}</b>, a {run.inputs.assumptions.years.length}-year forecast
                with growth of {run.inputs.assumptions.years.map((year) => pct(year.growth)).join(', ')} and free-cash-flow margins of{' '}
                {run.inputs.assumptions.years.map((year) => pct(year.fcfMargin)).join(', ')}, discounted at{' '}
                <b>{pct(run.inputs.assumptions.discountRate)}</b>
                {run.inputs.assumptions.terminal.kind === 'GORDON'
                  ? `, with ${pct(run.inputs.assumptions.terminal.growth)} growth after that`
                  : `, sold at ${run.inputs.assumptions.terminal.revenueMultiple}× revenue at the end`}
                . Enterprise value <b>{formatMoney(result.enterpriseValue)}</b>
                {result.method.method === 'DCF'
                  ? `, of which ${formatMoney(result.method.presentValueOfTerminal)} comes from the terminal value.`
                  : '.'}
              </p>
            ) : (
              <p>Enterprise value {formatMoney(result.enterpriseValue)}.</p>
            )}
          </Step>

          {equityBasis ? (
            <Step number={++step} icon={<Landmark />} title="Bridge to equity value">
              <p>The asking price is for the shares, so cash and debt are taken into account:</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {result.bridge.lines
                  // Typed amounts of zero add nothing; cited items and the working capital always show.
                  .filter((line) => EQUITY_STEPS.has(line.kind) && !(ENTERED_BRIDGE_KINDS.has(line.kind) && /^-?0(\.0+)?$/.test(line.amount.amount)))
                  .map((line, index) => (
                    <li key={`${line.kind}-${index}`} className="flex justify-between gap-4">
                      <span>
                        {line.label}
                        {line.balanceSheetItemId ? (
                          <Badge variant="evidence" className="ml-2">
                            cited
                          </Badge>
                        ) : ENTERED_BRIDGE_KINDS.has(line.kind) ? (
                          <Badge variant="draft" className="ml-2">
                            no evidence
                          </Badge>
                        ) : null}
                      </span>
                      <span className="font-mono">{formatMoney(line.amount)}</span>
                    </li>
                  ))}
              </ul>
              <p className="mt-1">
                Equity value before risks: <b>{comparison.beforeRisks.value.amount && money(comparison.beforeRisks.value.amount, currency)}</b>.
              </p>
            </Step>
          ) : null}

          <Step number={++step} icon={<ShieldAlert />} title="Price the accepted risks">
            {adjustments.filter((adjustment) => adjustment.type !== 'ESCROW').length === 0 ? (
              <p>No accepted price reductions are linked to this scenario, so the risks don’t change the price.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {adjustments
                  .filter((adjustment) => adjustment.type !== 'ESCROW')
                  .map((adjustment) => {
                    const line = priced.find((entry) => entry.findingId === adjustment.findingId);
                    return (
                      <li key={adjustment.findingId} className="rounded-xl border border-navy/10 p-3">
                        <Link href={`/deals/${dealId}/findings/${adjustment.findingId}`} className="font-semibold text-indigo-ink hover:underline">
                          {titles.get(adjustment.findingId) ?? 'Accepted finding'}
                        </Link>
                        <div>
                          {RISK_LABELS[adjustment.type] ?? adjustment.type}: range {money(adjustment.low, adjustment.currency)}–
                          {money(adjustment.high, adjustment.currency)}, {POINT_LABELS[adjustment.point]} applied
                          {line ? (
                            <>
                              {' '}= <b className="font-mono">{formatMoney(line.amount)}</b>
                            </>
                          ) : null}
                          .
                        </div>
                        <div className="text-xs">
                          <Glossed text={`Basis: ${adjustment.basis}`} />
                        </div>
                      </li>
                    );
                  })}
              </ul>
            )}
            {comparison.holdbacks.length > 0 ? (
              <p className="mt-2 flex items-start gap-2">
                <Wallet aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
                <span>
                  {comparison.holdbacks
                    .map((line) => `${titles.get(line.findingId) ?? line.label}: ${money(line.amount.amount.replace(/^-/, ''), currency)}`)
                    .join('; ')}{' '}
                  {comparison.holdbacks.length === 1 ? 'is' : 'are'} held back in escrow from cash at close — protecting the buyer without changing the
                  price.
                </span>
              </p>
            ) : null}
          </Step>

          <Step number={step + 1} icon={<BadgeCheck />} title="Checked by people">
            <p>
              Run by {viewer.name(run.ranBy)} on {run.ranAt.slice(0, 10)} with assumptions v{run.assumptionVersion} (engine{' '}
              <span className="font-mono">{result.engineVersion}</span>).{' '}
              {approval ? (
                <>
                  Approved by {approval.decidedBy ? viewer.name(approval.decidedBy) : 'a reviewer'} on {approval.decidedAt.slice(0, 10)}: “
                  {approval.rationale}”.
                </>
              ) : (
                <>Not yet approved — submit it for a second person’s decision.</>
              )}
            </p>
            {view.stale ? (
              <Badge variant="danger" className="mt-2">
                Stale: inputs changed since this run — re-run to refresh
              </Badge>
            ) : null}
          </Step>
        </ol>
      </CardContent>
    </Card>
  );
}

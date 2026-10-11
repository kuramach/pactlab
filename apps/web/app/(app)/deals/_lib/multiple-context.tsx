import type { BenchmarkView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Glossed, IconTile, Term } from '@pactlab/ui';
import { ArrowDownRight, ArrowUpRight, Gavel, Library, Minus, Scale } from 'lucide-react';
import Link from 'next/link';
import {
  DRIVER_LABELS,
  ORIGIN_LABELS,
  VERDICT_LABELS,
  describeDriver,
  describeAskPlacement,
  describePlacement,
  describeSet,
  driverSignal,
  formatMultiple,
  fractionToPercentLabel,
} from '../../comparables/_lib/view';
import { CHART_COLORS, MultipleRangeChart } from '../../_lib/charts';
import { addDealToPrecedents, recordMultipleJudgement } from '../[dealId]/benchmark-actions';

const VERDICT_VARIANT = { IN_RANGE: 'calculation', HIGH: 'danger', LOW: 'evidence' } as const;
const SIGNAL_TEXT = {
  UPPER: 'The target’s measured drivers are stronger than the comparables’ — evidence for the upper half of the range.',
  LOWER: 'The target’s measured drivers are weaker than the comparables’ — evidence for the lower half of the range.',
  MIXED: 'The target’s drivers are mixed against the comparables — no clear pull either way.',
} as const;

/** Messages for the judgement and precedent actions' outcomes. */
export const BENCHMARK_OUTCOMES: Readonly<Record<string, string>> = {
  'ok-judged': 'Judgement recorded against the current comparables.',
  'ok-precedent': 'Added to your firm’s precedents.',
  'precedent-exists': 'This deal is already one of your precedents.',
  'judgement-rationale': 'Choose in range, high or low, and say why in a sentence.',
  invalid: 'Record the asking price first, or approve a valuation before adding this deal to the precedents.',
  forbidden: 'Only the deal lead can do that.',
};

const inputClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/** One line in Step 1 of the Sextant explanation: where the chosen multiple sits. */
export function MultipleContextLine({ benchmark }: { benchmark: BenchmarkView }) {
  if (!benchmark.stats || !benchmark.chosen) {
    return (
      <p className="mt-1">
        No comparables to compare this multiple with yet — <Link href="/comparables" className="font-semibold text-indigo-ink hover:underline">add some</Link>.
      </p>
    );
  }
  return (
    <p className="mt-1">
      <a href="#multiple-context" className="font-semibold text-indigo-ink hover:underline">
        {describePlacement(benchmark.chosen)}
      </a>{' '}
      of {describeSet(benchmark)} (median {formatMultiple(benchmark.stats.median)}).
      {benchmark.askingImplied ? <> The asking price implies {formatMultiple(benchmark.askingImplied.multiple)}.</> : null}
    </p>
  );
}

/**
 * The multiple in context: comparable EV ÷ ARR multiples, where the
 * scenario's multiple and the asking price's implied multiple sit among
 * them, how the target's measured drivers compare, and the deal lead's
 * judgement of the ask. Figures come from the deterministic benchmark;
 * the verdict is a person's.
 */
export function MultipleContext({ dealId, benchmark, returnTo }: { dealId: string; benchmark: BenchmarkView; returnTo: string }) {
  const { stats, chosen, askingImplied, judgement } = benchmark;
  const signal = driverSignal(benchmark.drivers);
  const origins = (Object.keys(benchmark.byOrigin) as (keyof typeof benchmark.byOrigin)[]).filter((origin) => benchmark.byOrigin[origin] > 0);
  const marks = [
    ...(chosen ? [{ name: 'Sextant', multiple: chosen.multiple, color: CHART_COLORS.indigoInk }] : []),
    ...(askingImplied ? [{ name: 'Ask', multiple: askingImplied.multiple, color: CHART_COLORS.rose }] : []),
  ];
  const filterFields = (
    <>
      {benchmark.scenario ? <input type="hidden" name="scenarioId" value={benchmark.scenario.id} /> : null}
      <input type="hidden" name="companyType" value={benchmark.filter.companyType} />
      <input type="hidden" name="years" value={benchmark.filter.years} />
      <input type="hidden" name="synthetic" value={benchmark.filter.synthetic} />
    </>
  );

  return (
    <Card id="multiple-context">
      <CardHeader className="flex flex-row flex-wrap items-start gap-3">
        <IconTile accent="teal">
          <Scale />
        </IconTile>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <CardTitle>Is the multiple in range?</CardTitle>
          <CardDescription>
            <Glossed
              text={`EV ÷ ARR multiples of ${describeSet(benchmark)}${benchmark.scenario ? `, against “${benchmark.scenario.name}”` : ''}. Sextant describes; the deal lead decides.`}
            />
          </CardDescription>
        </div>
        <Link href="/comparables" className="text-sm font-bold text-indigo-ink hover:underline">
          Manage comparables →
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-wrap gap-2">
          {origins.map((origin) => (
            <Badge key={origin} variant={origin === 'SYNTHETIC' ? 'draft' : origin === 'OWN_DEAL' ? 'reviewed' : 'evidence'}>
              {benchmark.byOrigin[origin]} · {ORIGIN_LABELS[origin]}
            </Badge>
          ))}
          {!benchmark.sufficient ? <Badge variant="danger">Thin set — fewer than 3 comparables</Badge> : null}
          {benchmark.syntheticCount > 0 ? (
            <span className="text-xs text-muted-foreground">Synthetic comparables are invented for demos — never use them for a real price.</span>
          ) : null}
        </div>

        {!stats ? (
          <p className="text-sm text-slate-text">
            No comparables match this filter yet. Add precedent transactions or public peers with their source on the{' '}
            <Link href="/comparables" className="font-semibold text-indigo-ink hover:underline">
              Comparables
            </Link>{' '}
            page, or add an approved deal of your own.
          </p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <div className="flex flex-col gap-3">
              <MultipleRangeChart
                label="Comparable multiples with the middle half shaded, the median, Sextant's multiple and the asking price's implied multiple"
                comparables={benchmark.comparables.map((c) => ({ name: c.name, multiple: c.multiple, origin: c.origin, originLabel: ORIGIN_LABELS[c.origin] }))}
                stats={stats}
                marks={marks}
              />
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4" data-numeric>
                {(
                  [
                    ['Lowest', stats.min],
                    ['Lower quarter', stats.p25],
                    ['Median', stats.median],
                    ['Upper quarter', stats.p75],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-mist p-3">
                    <dt className="text-xs font-bold uppercase tracking-wide text-slate-text">{label}</dt>
                    <dd className="font-mono font-bold">{formatMultiple(value)}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-muted-foreground">
                The shaded band is the middle half of the comparables (25th to 75th percentile); the highest is {formatMultiple(stats.max)}.
              </p>
            </div>

            <div className="flex flex-col gap-3 text-sm">
              {chosen ? (
                <div className="rounded-xl border border-indigo/20 bg-secondary/60 p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-indigo-ink">Sextant’s multiple</div>
                  <div>{describePlacement(chosen)}.</div>
                </div>
              ) : null}
              {askingImplied ? (
                <div className="rounded-xl border border-rose/25 bg-rose/5 p-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-rose">The asking price</div>
                  <div>
                    {describeAskPlacement(askingImplied)}
                    {benchmark.asking?.basis === 'EQUITY_VALUE' ? ' (moved from equity to enterprise value with the scenario’s cash and debt)' : ''}.
                  </div>
                </div>
              ) : benchmark.asking ? null : (
                <p className="text-muted-foreground">Record the asking price to see where it sits.</p>
              )}

              <table className="w-full text-left">
                <thead className="text-xs uppercase tracking-wide text-slate-text">
                  <tr>
                    <th className="py-1 font-bold">Driver</th>
                    <th className="py-1 font-bold">Target</th>
                    <th className="py-1 font-bold">Peers’ median</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {benchmark.drivers.map((driver) => (
                    <tr key={driver.key} className="border-t border-navy/5">
                      <td className="py-1.5 font-semibold">
                        <Glossed text={DRIVER_LABELS[driver.key]} />
                      </td>
                      <td className="py-1.5 font-mono">{fractionToPercentLabel(driver.target)}</td>
                      <td className="py-1.5 font-mono">{fractionToPercentLabel(driver.median)}</td>
                      <td className="py-1.5" title={describeDriver(driver)}>
                        {driver.comparison === 'STRONGER' ? (
                          <ArrowUpRight aria-label="Stronger than peers" className="h-4 w-4 text-teal" />
                        ) : driver.comparison === 'WEAKER' ? (
                          <ArrowDownRight aria-label="Weaker than peers" className="h-4 w-4 text-rose" />
                        ) : driver.comparison === 'SIMILAR' ? (
                          <Minus aria-label="In line with peers" className="h-4 w-4 text-slate-text" />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground">
                {signal ? SIGNAL_TEXT[signal] : 'Connect billing to measure the target’s growth and retention.'}{' '}
                {benchmark.target.asOfMonth ? `Target measured at ${benchmark.target.asOfMonth} from billing evidence.` : ''}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-2xl border border-navy/10 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Gavel aria-hidden className="h-4 w-4 text-indigo-ink" />
            <span className="font-bold">Deal lead’s judgement of the asking price</span>
            {judgement ? <Badge variant={VERDICT_VARIANT[judgement.verdict]}>{VERDICT_LABELS[judgement.verdict]}</Badge> : null}
            {judgement && !judgement.current ? <Badge variant="draft">Out of date — the ask or the comparables changed</Badge> : null}
          </div>
          {judgement ? (
            <p className="text-sm text-slate-text">
              “{judgement.rationale}” — {judgement.decidedByName ?? 'the deal lead'}, {judgement.decidedAt.slice(0, 10)}, against {judgement.comparableCount}{' '}
              comparables
              {judgement.askingMultiple ? ` with the ask at ${formatMultiple(judgement.askingMultiple)}` : ''}.
            </p>
          ) : (
            <p className="text-sm text-slate-text">
              {benchmark.canJudge ? 'Not judged yet. Is the seller’s asking price in range, high or low against these comparables?' : 'Waiting for the deal lead’s judgement.'}
            </p>
          )}
          {benchmark.canJudge && benchmark.asking ? (
            <form action={recordMultipleJudgement.bind(null, dealId, returnTo)} className="flex flex-col gap-2">
              {filterFields}
              <fieldset className="flex flex-wrap gap-2">
                <legend className="sr-only">Verdict</legend>
                {(['IN_RANGE', 'HIGH', 'LOW'] as const).map((verdict) => (
                  <label key={verdict} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm has-[:checked]:border-indigo has-[:checked]:bg-secondary">
                    <input type="radio" name="verdict" value={verdict} required defaultChecked={judgement?.verdict === verdict} />
                    {VERDICT_LABELS[verdict]}
                  </label>
                ))}
              </fieldset>
              <textarea name="rationale" required minLength={3} maxLength={2000} rows={2} placeholder="Why — e.g. growth below peers priced at this multiple" className={inputClass} />
              <div>
                <Button type="submit" size="sm">
                  {judgement ? 'Record a new judgement' : 'Record judgement'}
                </Button>
              </div>
            </form>
          ) : null}
        </div>

        {benchmark.canJudge && benchmark.ownDeal.eligible ? (
          benchmark.ownDeal.added ? (
            <p className="flex items-center gap-2 text-sm text-slate-text">
              <Library aria-hidden className="h-4 w-4 text-indigo-ink" /> This deal is one of your firm’s precedents.
            </p>
          ) : (
            <form action={addDealToPrecedents.bind(null, dealId, returnTo)} className="flex flex-wrap items-center gap-3 text-sm">
              <Library aria-hidden className="h-4 w-4 text-indigo-ink" />
              <span className="text-slate-text">
                Approved: add this deal’s risk-adjusted <Term term="EV" /> and <Term term="ARR" /> to your firm’s precedents for future deals.
              </span>
              <Button type="submit" size="sm" variant="outline">
                Add to precedents
              </Button>
            </form>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

import type { ForesightForecastsView, ForesightMetricView, ForesightOutcomeView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { LineChart } from '../../../_lib/charts';
import { formatMoney } from '../../../metrics/_lib/format';
import { saveUserForecast } from './actions';
import { AutoRefresh } from './auto-refresh';

const pct = (value: string) => `${value}%`;
const cell = 'py-1.5 pr-3 font-mono text-xs tabular-nums';
const USED: Record<ForesightOutcomeView['basis'][number]['used'], string> = { AI: 'AI forecast', EXTERNAL: 'published forecast', USER: 'your forecast', NEUTRAL: 'neutral level (no forecast yet)' };

function StatusLine({ forecasts }: { forecasts: ForesightForecastsView }) {
  if (forecasts.status === 'NONE' || forecasts.status === 'RUNNING') {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        <AutoRefresh /> Preparing the published and AI forecasts in the background — this page updates by itself.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span>
        Refreshed {forecasts.refreshedAt?.slice(0, 10)} · refreshed again after 30 days{forecasts.area ? ` · published forecasts for ${forecasts.area === 'EURO' ? 'the euro area' : forecasts.area}` : ''}.
      </span>
      {forecasts.notes.map((note) => (
        <span key={note} className="text-amber-800">
          {note}
        </span>
      ))}
    </div>
  );
}

function MetricRows({ dealId, metric, years, canEdit }: { dealId: string; metric: ForesightMetricView; years: number[]; canEdit: boolean }) {
  const yours = metric.user?.values ?? metric.ai?.values ?? metric.external?.values ?? years.map(() => metric.neutral);
  return (
    <>
      <tr className="border-t border-border">
        <th scope="rowgroup" colSpan={years.length + 2} className="pt-3 text-left">
          <span className="font-semibold">{metric.label}</span> <span className="text-xs font-normal text-muted-foreground">— {metric.help} Neutral level {pct(metric.neutral)} a year.</span>
        </th>
      </tr>
      <tr>
        <td className="py-1.5 pr-3 text-xs">
          <Badge>Published</Badge>
        </td>
        {metric.external ? metric.external.values.map((value, index) => <td key={years[index]} className={cell}>{pct(value)}</td>) : <td colSpan={years.length} className="py-1.5 text-xs text-muted-foreground">No published forecast for this metric.</td>}
        <td className="py-1.5 text-xs text-muted-foreground">
          {metric.external ? (
            <a href={metric.external.sourceUrl ?? undefined} target="_blank" rel="noreferrer" className="underline">
              {metric.external.sourceName}
            </a>
          ) : null}
        </td>
      </tr>
      <tr>
        <td className="py-1.5 pr-3 text-xs">
          <Badge variant="draft">AI</Badge>
        </td>
        {metric.ai ? metric.ai.values.map((value, index) => <td key={years[index]} className={cell}>{pct(value)}</td>) : <td colSpan={years.length} className="py-1.5 text-xs text-muted-foreground">No AI forecast yet.</td>}
        <td className="py-1.5 text-xs text-muted-foreground">{metric.ai ? <details><summary className="cursor-pointer">Why ({metric.ai.modelId})</summary>{metric.ai.rationale}</details> : null}</td>
      </tr>
      <tr>
        <td className="py-1.5 pr-3 text-xs">
          <Badge variant="reviewed">Yours</Badge>
        </td>
        {canEdit ? (
          <>
            {years.map((year, index) => (
              <td key={year} className="py-1.5 pr-3">
                <input form={`yours-${metric.key}`} name={`y${index}`} defaultValue={yours[index]} inputMode="decimal" aria-label={`Your ${metric.label} forecast for ${year}, percent`} className="w-16 rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-xs" />
              </td>
            ))}
            <td className="py-1.5 text-xs">
              <form id={`yours-${metric.key}`} action={saveUserForecast.bind(null, dealId, metric.key)} className="inline">
                <Button type="submit" size="sm" variant="outline">
                  {metric.user ? `Save (v${metric.user.version + 1})` : 'Save mine'}
                </Button>
              </form>
              {metric.user ? <span className="ml-2 text-muted-foreground">v{metric.user.version} by {metric.user.createdByName ?? 'a team member'}</span> : null}
            </td>
          </>
        ) : metric.user ? (
          <>
            {metric.user.values.map((value, index) => <td key={years[index]} className={cell}>{pct(value)}</td>)}
            <td />
          </>
        ) : (
          <td colSpan={years.length + 1} className="py-1.5 text-xs text-muted-foreground">None entered.</td>
        )}
      </tr>
    </>
  );
}

/**
 * Foresight key metrics (T-094 B10): published, AI and your own five-year
 * forecasts per metric, and the value of the business under the published +
 * AI set against yours — side by side, assumptions visible.
 */
export function ForecastsSection({ dealId, forecasts, canEdit }: { dealId: string; forecasts: ForesightForecastsView; canEdit: boolean }) {
  const outcomes = forecasts.outcomes;
  const currency = outcomes?.currency ?? 'USD';
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Key metrics — five-year forecasts</CardTitle>
          <CardDescription>Published forecasts where they exist, the AI’s, and yours. Percent a year. Edit yours and save to see what it does to value.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <StatusLine forecasts={forecasts} />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" aria-label="Key metric forecasts">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Source</th>
                  {forecasts.years.map((year) => (
                    <th key={year} className="py-1 pr-3">
                      {year}
                    </th>
                  ))}
                  <th className="py-1">Where from</th>
                </tr>
              </thead>
              <tbody>
                {forecasts.metrics.map((metric) => (
                  <MetricRows key={metric.key} dealId={dealId} metric={metric} years={forecasts.years} canEdit={canEdit} />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Value under the forecasts — published + AI vs yours</CardTitle>
          <CardDescription>
            {outcomes
              ? `${outcomes.startValueSource}. Base growth ${(Number(outcomes.baseGrowth) * 100).toFixed(1)}% a year before the metrics; each point a metric runs above its neutral level moves growth and the discount rate by a fixed, versioned amount (${outcomes.engineVersion}). A projection under these assumptions — not a prediction.`
              : 'Run a valuation scenario (or record the asking price) to project value.'}
          </CardDescription>
        </CardHeader>
        {outcomes ? (
          <CardContent className="flex flex-col gap-4">
            <LineChart
              label="Value under each forecast set"
              currency={currency}
              categories={outcomes.reference.path.map((point) => (point.year === 0 ? 'Today' : String(point.calendarYear)))}
              series={[
                { name: 'Published + AI', values: outcomes.reference.path.map((point) => point.value) },
                { name: 'Yours', values: outcomes.user.path.map((point) => point.value) },
              ]}
            />
            <table className="w-full text-left text-sm" aria-label="Value by forecast set" data-numeric>
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Set</th>
                  {outcomes.reference.path.slice(1).map((point) => (
                    <th key={point.year} className="py-1 pr-3">
                      {point.calendarYear}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  { name: 'Published + AI', set: outcomes.reference },
                  { name: 'Yours', set: outcomes.user },
                ].map((row) => (
                  <tr key={row.name}>
                    <th scope="row" className="py-1.5 pr-3 font-medium">
                      {row.name}
                    </th>
                    {row.set.path.slice(1).map((point) => (
                      <td key={point.year} className={cell}>
                        {formatMoney({ amount: point.value, currency })}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid gap-4 text-xs sm:grid-cols-2">
              {[
                { name: 'Published + AI', set: outcomes.reference },
                { name: 'Yours', set: outcomes.user },
              ].map((row) => (
                <div key={row.name} className="flex flex-col gap-1">
                  <span className="font-semibold">{row.name}: what moves year-5 value</span>
                  {row.set.drivers.map((driver) => (
                    <span key={driver.key}>
                      {driver.label}: {formatMoney({ amount: driver.year5Change, currency })} ({USED[row.set.basis.find((entry) => entry.key === driver.key)?.used ?? 'NEUTRAL']})
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </CardContent>
        ) : null}
      </Card>
    </>
  );
}

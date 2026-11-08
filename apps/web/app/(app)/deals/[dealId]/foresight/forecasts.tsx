import type { ForesightForecastsView, ForesightMetricView, ForesightOutcomeView } from '@pactlab/contracts';
import { AiBadge, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, HumanMark } from '@pactlab/ui';
import { LineChart } from '../../../_lib/charts';
import { formatMoney } from '../../../metrics/_lib/format';
import { archiveMetric, defineMetric, forecastMetric, refreshForecasts, saveUserForecast } from './actions';
import { ForecastLineEditor } from './forecast-line-editor';
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

/** Why a metric has no AI forecast, in words (batch 2): never a silent empty row. */
function aiMissingReason(forecasts: ForesightForecastsView, aiEnabled: boolean): string {
  if (!aiEnabled) return 'AI is off in this environment.';
  if (forecasts.status === 'RUNNING' || forecasts.status === 'NONE') return 'Being prepared now.';
  const note = forecasts.notes.find((entry) => /\bAI\b/.test(entry));
  const when = forecasts.refreshedAt ? ` (last tried ${forecasts.refreshedAt.slice(0, 10)})` : '';
  if (note?.startsWith('AI is off')) return `AI was off when this was last prepared${when}; it is tried again within the hour.`;
  if (note) return `Claude couldn’t be reached${when}; it is tried again within the hour.`;
  return 'No AI forecast for this metric.';
}

const EFFECTS = [
  { value: 'GROWTH', label: 'Higher is good for growth' },
  { value: 'RISK', label: 'Higher raises risk (the discount rate)' },
  { value: 'TRACK', label: 'Track only — no effect on value' },
] as const;
const EFFECT_LABEL: Record<string, string> = Object.fromEntries(EFFECTS.map((effect) => [effect.value, effect.label]));
const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';

/** One metric (batch 1): your line dragged into shape over the published and AI lines, their values below. */
function MetricBlock({ dealId, metric, years, canEdit, aiEnabled, aiMissingReason }: { dealId: string; metric: ForesightMetricView; years: number[]; canEdit: boolean; aiEnabled: boolean; aiMissingReason: string }) {
  const yours = metric.user?.values ?? metric.ai?.values ?? metric.external?.values ?? years.map(() => metric.neutral);
  const formId = `yours-${metric.key}`;
  const row = (values: string[]) => values.map((value, index) => `${years[index]} ${pct(value)}`).join(' · ');
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="mr-auto flex flex-col gap-0.5">
          <span className="flex items-center gap-2 font-semibold">
            {metric.label}
            {metric.custom ? <Badge variant="neutral">your metric</Badge> : null}
          </span>
          <span className="text-xs text-muted-foreground">
            {metric.help} Neutral level {pct(metric.neutral)} a year.{metric.custom ? ` ${EFFECT_LABEL[metric.custom.effect] ?? ''}.` : ''}
          </span>
        </div>
        {metric.custom && canEdit ? (
          <form action={archiveMetric.bind(null, dealId, metric.key)}>
            <Button type="submit" size="sm" variant="ghost">
              Remove
            </Button>
          </form>
        ) : null}
      </div>

      {canEdit ? (
        <ForecastLineEditor formId={formId} label={metric.label} years={years} neutral={metric.neutral} published={metric.external?.values ?? null} ai={metric.ai?.values ?? null} initial={yours} />
      ) : metric.user ? (
        <p className={cell}>Yours: {row(metric.user.values)}</p>
      ) : (
        <p className="text-xs text-muted-foreground">No forecast of your own yet.</p>
      )}

      <dl className="grid gap-1 text-xs sm:grid-cols-[7rem_1fr]">
        <dt><Badge>Published</Badge></dt>
        <dd className="text-muted-foreground">
          {metric.external ? (
            <>
              <span className="font-mono">{row(metric.external.values)}</span> ·{' '}
              <a href={metric.external.sourceUrl ?? undefined} target="_blank" rel="noreferrer" className="underline">
                {metric.external.sourceName}
              </a>
            </>
          ) : (
            'No published forecast for this metric.'
          )}
        </dd>
        <dt><AiBadge /></dt>
        <dd className="text-muted-foreground">
          {metric.ai ? (
            <>
              <span className="font-mono">{row(metric.ai.values)}</span>
              <details className="inline">
                <summary className="ml-2 inline cursor-pointer underline">Why</summary> {metric.ai.rationale} ({metric.ai.modelId})
              </details>
            </>
          ) : metric.custom && canEdit && aiEnabled ? (
            <form action={forecastMetric.bind(null, dealId, metric.key)} className="inline">
              <Button type="submit" size="sm" variant="outline">
                Ask AI to forecast it
              </Button>
            </form>
          ) : (
            aiMissingReason
          )}
        </dd>
      </dl>

      {canEdit ? (
        <form id={formId} action={saveUserForecast.bind(null, dealId, metric.key)} className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm">
            {metric.user ? `Save my line (v${metric.user.version + 1})` : 'Save my line'}
          </Button>
          {metric.user ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <HumanMark className="h-3.5 w-3.5" /> v{metric.user.version} by {metric.user.createdByName ?? 'a team member'}
            </span>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

/** Add a metric of the team's own (batch 1): defined here, forecast by AI if it can, then your line. */
function AddMetric({ dealId }: { dealId: string }) {
  return (
    <details className="rounded-lg border border-dashed border-border p-4">
      <summary className="cursor-pointer font-semibold">+ Add a metric</summary>
      <form action={defineMetric.bind(null, dealId)} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Name
          <input name="label" required minLength={2} maxLength={80} placeholder="Texas RevPAR growth" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Neutral level (% a year)
          <input name="neutral" required inputMode="decimal" placeholder="3" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
          What it measures
          <input name="definition" required minLength={3} maxLength={300} placeholder="Revenue per available room for hotels in Texas, year on year." className={inputClass} />
        </label>
        <fieldset className="flex flex-col gap-1 text-sm sm:col-span-2">
          <legend className="mb-1 font-medium">How it moves value</legend>
          {EFFECTS.map((effect, index) => (
            <label key={effect.value} className="flex items-center gap-2">
              <input type="radio" name="effect" value={effect.value} defaultChecked={index === 0} className="h-4 w-4 accent-navy" />
              {effect.label}
            </label>
          ))}
        </fieldset>
        <div className="sm:col-span-2">
          <Button type="submit">Add metric</Button>
        </div>
      </form>
    </details>
  );
}

/**
 * Foresight key metrics (T-094 B10): published, AI and your own five-year
 * forecasts per metric, and the value of the business under the published +
 * AI set against yours — side by side, assumptions visible.
 */
export function ForecastsSection({ dealId, forecasts, canEdit, aiEnabled = true }: { dealId: string; forecasts: ForesightForecastsView; canEdit: boolean; aiEnabled?: boolean }) {
  const outcomes = forecasts.outcomes;
  const currency = outcomes?.currency ?? 'USD';
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Key metrics — five-year forecasts</CardTitle>
          <CardDescription>Published forecasts where they exist, the AI’s, and yours. Percent a year. Drag your line into shape and save it to see what it does to value; add metrics of your own.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <StatusLine forecasts={forecasts} />
            {canEdit && aiEnabled && forecasts.status !== 'RUNNING' && forecasts.metrics.some((metric) => !metric.ai && !metric.custom) ? (
              <form action={refreshForecasts.bind(null, dealId)}>
                <Button type="submit" size="sm" variant="outline">
                  Refresh AI forecasts
                </Button>
              </form>
            ) : null}
          </div>
          {forecasts.metrics.map((metric) => (
            <MetricBlock key={metric.key} dealId={dealId} metric={metric} years={forecasts.years} canEdit={canEdit} aiEnabled={aiEnabled} aiMissingReason={aiMissingReason(forecasts, aiEnabled)} />
          ))}
          {canEdit ? <AddMetric dealId={dealId} /> : null}
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

import type { ForesightLineView, ForesightView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from '@pactlab/ui';
import { notFound } from 'next/navigation';
import { LineChart } from '../../../_lib/charts';
import { formatMoney } from '../../../metrics/_lib/format';
import { apiGet } from '../../_lib/api';
import { isUuidParam } from '../../_lib/filters';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { generateBaseline, saveScenario } from './actions';
import { AskForesight } from './ask-foresight';
import { fractionToPercent } from './format';

export const dynamic = 'force-dynamic';

const inputClass = 'rounded-md border border-border bg-background px-2 py-1 text-sm';
const DIRECTION = { UP: '↑ rises', FLAT: '→ holds', DOWN: '↓ falls' } as const;

const OUTCOMES: Record<string, string> = {
  'ok-generated': 'AI baseline generated. It is dated and versioned; scenarios layer on top without changing it.',
  'ok-scenario': 'Scenario saved and projected.',
  'error-AI_OFF': 'AI is not switched on for this environment yet, so no baseline can be generated. Scenarios need a baseline.',
  'error-AI_ACCESS': 'AI is unavailable: the AWS sign-in for this environment has expired. An operator needs to sign in again.',
  'error-AI_UNAVAILABLE': 'The model call failed. Try again in a moment.',
  'error-UNKNOWN_TREND': 'That scenario overrides a trend that is not in the baseline.',
  'invalid-baseGrowth': 'Enter growth as a percent between −50 and 200, e.g. 12.',
  'invalid-baseMargin': 'Enter the margin as a percent between 0 and 100, e.g. 20.',
  'invalid-name': 'Give the scenario a name.',
  conflict: 'Someone else changed this scenario in the meantime — reload and try again.',
  forbidden: 'Your role cannot change Foresight on this deal.',
};

function TrendTable({ line }: { line: ForesightLineView }) {
  return (
    <table className="w-full text-left text-sm" aria-label={`Trends in ${line.name}`}>
      <thead className="text-xs uppercase text-muted-foreground">
        <tr>
          <th className="py-1 pr-2">Trend</th>
          <th className="py-1 pr-2">5-year direction</th>
          <th className="py-1 pr-2">Confidence</th>
          <th className="py-1">Source</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {line.trends.map((trend) => (
          <tr key={trend.key} className="align-top">
            <td className="py-1.5 pr-2">
              <span className="font-medium">{trend.label}</span>
              <span className="block text-xs text-muted-foreground">{trend.narrative}</span>
            </td>
            <td className="py-1.5 pr-2">
              {DIRECTION[trend.direction]} · {trend.magnitude.toLowerCase()}
              {trend.weight !== '1' ? ` · weight ${trend.weight}` : ''}
            </td>
            <td className="py-1.5 pr-2">{trend.confidence.toLowerCase()}</td>
            <td className="py-1.5">
              {trend.provenance === 'AI' ? <Badge variant="draft">AI</Badge> : <Badge variant="calculation">{trend.adjusted ? 'Yours (adjusted)' : 'Yours'}</Badge>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ScenarioForm({ dealId, baseline, scenario }: { dealId: string; baseline: ForesightLineView; scenario?: ForesightLineView }) {
  const source = scenario ?? baseline;
  return (
    <form action={saveScenario.bind(null, dealId, scenario?.id ?? null)} className="flex flex-col gap-3 text-sm">
      {scenario ? <input type="hidden" name="expectedVersion" value={scenario.version ?? 1} /> : null}
      {scenario ? <input type="hidden" name="keepCustomTrends" value={JSON.stringify(scenario.customTrends)} /> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 font-medium">
          Scenario name
          <input name="name" required maxLength={120} defaultValue={scenario?.name ?? 'My view'} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 font-medium">
          Growth before trends (% a year)
          <input name="baseGrowth" inputMode="decimal" defaultValue={fractionToPercent(source.baseGrowth)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 font-medium">
          Margin trends move (%)
          <input name="baseMargin" inputMode="decimal" defaultValue={fractionToPercent(source.baseMargin)} className={inputClass} />
        </label>
      </div>
      <table className="w-full text-left" aria-label="Override trends">
        <thead className="text-xs uppercase text-muted-foreground">
          <tr>
            <th className="py-1">Trend (AI baseline)</th>
            <th className="py-1">Your direction</th>
            <th className="py-1">Your size</th>
            <th className="py-1">Weight (0–2)</th>
          </tr>
        </thead>
        <tbody>
          {baseline.trends.map((trend) => {
            const override = scenario?.overrides[trend.key];
            return (
              <tr key={trend.key}>
                <td className="py-1 pr-2">
                  <input type="hidden" name="trendKey" value={trend.key} />
                  {trend.label} <span className="text-xs text-muted-foreground">(AI: {DIRECTION[trend.direction]}, {trend.magnitude.toLowerCase()})</span>
                </td>
                <td className="py-1 pr-2">
                  <select name={`direction:${trend.key}`} defaultValue={override?.direction ?? ''} aria-label={`Your direction for ${trend.label}`} className={inputClass}>
                    <option value="">As AI</option>
                    <option value="UP">Rises</option>
                    <option value="FLAT">Holds</option>
                    <option value="DOWN">Falls</option>
                  </select>
                </td>
                <td className="py-1 pr-2">
                  <select name={`magnitude:${trend.key}`} defaultValue={override?.magnitude ?? ''} aria-label={`Your size for ${trend.label}`} className={inputClass}>
                    <option value="">As AI</option>
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                  </select>
                </td>
                <td className="py-1">
                  <input name={`weight:${trend.key}`} defaultValue={override?.weight ?? '1'} aria-label={`Weight for ${trend.label}`} className={`${inputClass} w-16`} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <fieldset className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-3">
        <legend className="px-1 font-medium">Add your own trend (optional)</legend>
        <input name="customLabel" placeholder="e.g. Rates stay above 6% through 2028" aria-label="Your trend" className={`${inputClass} sm:col-span-3`} />
        <select name="customDirection" aria-label="Its direction" className={inputClass}>
          <option value="UP">Rises</option>
          <option value="DOWN">Falls</option>
        </select>
        <select name="customMagnitude" defaultValue="MEDIUM" aria-label="Its size" className={inputClass}>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
        </select>
        <select name="customLever" aria-label="What it moves" className={inputClass}>
          <option value="GROWTH">Moves growth</option>
          <option value="MARGIN">Moves margin</option>
          <option value="MULTIPLE">Moves the exit multiple</option>
          <option value="DISCOUNT_RATE">Moves the discount rate</option>
        </select>
        <select name="customSign" aria-label="Rising is" className={inputClass}>
          <option value="1">Rising pushes it up</option>
          <option value="-1">Rising pushes it down</option>
        </select>
        <select name="customConfidence" defaultValue="MEDIUM" aria-label="Your confidence" className={inputClass}>
          <option value="LOW">Low confidence</option>
          <option value="MEDIUM">Medium confidence</option>
          <option value="HIGH">High confidence</option>
        </select>
        <input name="customNarrative" placeholder="Why you think so" aria-label="Why" className={inputClass} />
      </fieldset>
      <div>
        <Button type="submit" size="sm">
          {scenario ? 'Save scenario' : 'Create scenario'}
        </Button>
      </div>
    </form>
  );
}

/** Foresight: five-year trend lines and the projected value of the business under them. */
export default async function ForesightPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  if (!isUuidParam(dealId)) notFound();
  const outcome = (await searchParams)['outcome'];
  const result = await apiGet<ForesightView>(`/v1/deals/${dealId}/foresight`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const baseline = view.lines.find((line) => line.kind === 'BASELINE');
  const projected = view.lines.filter((line) => line.projection);
  const currency = projected[0]?.projection?.currency ?? 'USD';

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Foresight</h2>
        <p className="text-sm text-muted-foreground">
          Five-year trend lines for this deal and the projected value of the business under them. Every figure is a projection under the assumptions shown — not a prediction.
        </p>
      </div>
      <OutcomeBanner outcome={typeof outcome === 'string' ? outcome : undefined} messages={OUTCOMES} />

      {!view.baseline ? (
        <EmptyState
          title="No trend lines yet"
          description={view.ai.enabled ? 'Generate the AI baseline: the macro questions every deal faces, plus this sector’s own.' : 'AI is not switched on for this environment yet; the baseline needs it.'}
          action={
            view.canEdit && view.ai.enabled ? (
              <form action={generateBaseline.bind(null, dealId)}>
                <Button type="submit" size="sm">
                  Generate AI baseline
                </Button>
              </form>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="text-xs text-muted-foreground">
            AI baseline as of {view.baseline.asOf} · model {view.baseline.modelId} · prompt {view.baseline.promptVersion}. AI trends are labelled AI; yours are labelled Yours.
            {view.canEdit && view.ai.enabled ? (
              <form action={generateBaseline.bind(null, dealId)} className="ml-2 inline">
                <button type="submit" className="text-indigo-ink underline">
                  Refresh baseline
                </button>
              </form>
            ) : null}
          </div>

          {view.projectionUnavailable ? (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">{view.projectionUnavailable}</p>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Projected value under these assumptions</CardTitle>
                <CardDescription>{projected[0]?.projection?.assumptions.startValueSource} · base path for each line; ranges in the table.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <LineChart
                  label="Projected value by year"
                  currency={currency}
                  categories={['Today', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5']}
                  series={projected.map((line) => ({ name: line.name, values: line.projection?.path.map((year) => year.base) ?? [] }))}
                />
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm" aria-label="Projected value range" data-numeric>
                    <thead className="text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="py-1 pr-2">Line</th>
                        {[1, 2, 3, 4, 5].map((year) => (
                          <th key={year} className="py-1 pr-2">Year {year} (low – high)</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {projected.map((line) => (
                        <tr key={line.id ?? 'baseline'}>
                          <td className="py-1.5 pr-2 font-medium">{line.name}</td>
                          {line.projection?.path.slice(1).map((year) => (
                            <td key={year.year} className="py-1.5 pr-2 font-mono text-xs">
                              {formatMoney({ amount: year.low, currency })} – {formatMoney({ amount: year.high, currency })}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {view.lines.map((line) => (
              <Card key={line.id ?? 'baseline'} aria-label={line.name}>
                <CardHeader>
                  <CardTitle className="text-base">{line.name}</CardTitle>
                  <CardDescription>
                    Growth before trends {fractionToPercent(line.baseGrowth)}% a year · margin {fractionToPercent(line.baseMargin)}%
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <TrendTable line={line} />
                  {line.projection ? (
                    <details className="text-sm">
                      <summary className="cursor-pointer font-semibold text-indigo-ink">What the projection rests on</summary>
                      <ul className="mt-2 list-disc pl-5">
                        {line.projection.impacts.map((impact, index) => (
                          <li key={index}>
                            {impact.explanation} <span className="text-xs text-muted-foreground">({impact.provenance === 'AI' ? 'AI trend' : 'your trend'})</span>
                          </li>
                        ))}
                        {line.projection.impacts.length === 0 ? <li>No trend moves the value: only growth before trends.</li> : null}
                      </ul>
                      <p className="mt-2 font-semibold">What moves year 5 most</p>
                      <ol className="list-decimal pl-5">
                        {line.projection.sensitivity.slice(0, 5).map((entry) => (
                          <li key={entry.trendKey}>
                            {entry.trendLabel}: {formatMoney({ amount: entry.year5Change, currency })}
                          </li>
                        ))}
                      </ol>
                      <p className="mt-2 text-xs text-muted-foreground">Engine {line.projection.engineVersion}: impacts from a fixed table; a discount-rate point moves the exit multiple {line.projection.assumptions.rateToMultiple}%.</p>
                    </details>
                  ) : null}
                  {view.canEdit && line.kind === 'SCENARIO' && baseline ? (
                    <details className="text-sm">
                      <summary className="cursor-pointer font-semibold text-indigo-ink">Edit this scenario</summary>
                      <div className="mt-2">
                        <ScenarioForm dealId={dealId} baseline={baseline} scenario={line} />
                      </div>
                    </details>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>

          {view.canEdit && baseline && view.lines.length < 4 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Your view of the next five years</CardTitle>
                <CardDescription>A scenario layers your overrides and trends on the AI baseline; the baseline itself never changes.</CardDescription>
              </CardHeader>
              <CardContent>
                <ScenarioForm dealId={dealId} baseline={baseline} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ask Foresight</CardTitle>
              <CardDescription>Answers come only from these trends, assumptions and projections, and name what they rely on. Spoken questions are transcribed; the audio is not kept.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {view.canEdit && view.ai.enabled ? (
                <AskForesight dealId={dealId} lines={view.lines.map((line) => ({ id: line.id, name: line.name }))} voice={view.voice} />
              ) : (
                <p className="text-sm text-muted-foreground">{view.ai.enabled ? 'Your role can read Foresight but not ask it.' : 'AI is not switched on for this environment yet.'}</p>
              )}
              {view.questions.length > 0 ? (
                <ul className="flex flex-col gap-2 text-sm" aria-label="Earlier questions">
                  {view.questions.map((question) => (
                    <li key={question.id} className="rounded-lg border border-border p-2">
                      <span className="text-xs text-muted-foreground">
                        {question.via === 'VOICE' ? 'Spoken' : 'Typed'} · {question.askedAt.slice(0, 10)}
                        {question.scenarioName ? ` · ${question.scenarioName}` : ' · AI baseline'}
                      </span>
                      <p className="font-medium">{question.question}</p>
                      <p>{question.answer}</p>
                      <span className="text-xs text-muted-foreground">Relies on: {question.reliesOn.join(', ')}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

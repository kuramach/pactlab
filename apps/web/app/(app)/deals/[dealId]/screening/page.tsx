import type { ScreeningView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { notFound } from 'next/navigation';
import { apiGet } from '../../_lib/api';
import { isUuidParam } from '../../_lib/filters';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { formatMoney } from '../../../metrics/_lib/format';
import { decideScreening, saveScreening } from './actions';

export const dynamic = 'force-dynamic';

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

const OUTCOMES: Record<string, string> = {
  'ok-saved': 'Screening saved.',
  'ok-needs_more': 'Verdict recorded: needs more. The pact stays in Pre-Diligence with the gaps listed.',
  'ok-no_go': 'Verdict recorded: no-go. The pact is archived with your rationale.',
  'invalid-valueHigh': 'The high end of the range must be at least the low end.',
  'invalid-headlineRevenue': 'Enter revenue as a number, e.g. 12,000,000.',
  'invalid-redFlags': 'Each red flag needs at least a few words (one per line, up to 30).',
  'invalid-rationale': 'Give the verdict a rationale in a sentence.',
  'invalid-gaps': 'Say what is missing before choosing “Needs more”.',
  conflict: 'Someone else saved this screening in the meantime — reload and try again.',
  forbidden: 'Your role cannot do that here. Only the deal lead records the verdict.',
};

const VERDICT_LABELS = { GO: 'Go — start diligence', NO_GO: 'No-go — archive the pact', NEEDS_MORE: 'Needs more — stay in screening' } as const;

/** Where the asking price sits against the screening range: a coarse sanity read, never the price bridge. */
function sanity(view: ScreeningView): string | null {
  if (!view.askingPrice || view.valueLow === null || view.valueHigh === null) return null;
  const ask = Number(view.askingPrice.amount);
  if (ask < Number(view.valueLow)) return 'The asking price is below your rough range.';
  if (ask > Number(view.valueHigh)) return 'The asking price is above your rough range — check whether the gap is worth diligence.';
  return 'The asking price sits inside your rough range.';
}

/** Pre-Diligence: is this deal worth diligence at all? Screening-grade only. */
export default async function ScreeningPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  if (!isUuidParam(dealId)) notFound();
  const outcome = (await searchParams)['outcome'];
  const result = await apiGet<ScreeningView>(`/v1/deals/${dealId}/screening`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const read = sanity(view);
  const currency = view.headlineCurrency ?? view.askingPrice?.currency ?? 'USD';

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Screening</h2>
        <p className="text-sm text-muted-foreground">
          Pre-Diligence: is this deal worth diligence at all? Everything here is <strong>screening-grade</strong> — directional, never a finding or a valuation.
        </p>
      </div>
      <OutcomeBanner outcome={typeof outcome === 'string' ? outcome : undefined} messages={OUTCOMES} />

      {view.verdict ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Verdict <Badge variant={view.verdict === 'GO' ? 'calculation' : view.verdict === 'NO_GO' ? 'danger' : 'draft'}>{VERDICT_LABELS[view.verdict]}</Badge>
            </CardTitle>
            <CardDescription>
              {view.decidedByName ? `By ${view.decidedByName}` : 'Decided'}
              {view.decidedAt ? ` on ${view.decidedAt.slice(0, 10)}` : ''}: “{view.rationale}”
            </CardDescription>
          </CardHeader>
          {view.gaps ? <CardContent className="text-sm">Gaps to close: {view.gaps}</CardContent> : null}
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Intake</CardTitle>
          <CardDescription>The teaser or CIM in a few lines, the headline numbers, and your rough range for what it is worth.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveScreening.bind(null, dealId)} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="expectedVersion" value={view.version} />
            <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
              What the teaser or CIM says
              <textarea name="intakeNotes" rows={4} defaultValue={view.intakeNotes ?? ''} disabled={!view.canEdit} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Headline revenue (last year)
              <input name="headlineRevenue" inputMode="decimal" defaultValue={view.headlineRevenue ?? ''} disabled={!view.canEdit} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Currency
              <input name="headlineCurrency" maxLength={3} defaultValue={currency} disabled={!view.canEdit} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Rough value — low
              <input name="valueLow" inputMode="decimal" defaultValue={view.valueLow ?? ''} disabled={!view.canEdit} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Rough value — high
              <input name="valueHigh" inputMode="decimal" defaultValue={view.valueHigh ?? ''} disabled={!view.canEdit} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
              Red flags (one per line)
              <textarea
                name="redFlags"
                rows={4}
                defaultValue={view.redFlags.map((flag) => flag.text).join('\n')}
                disabled={!view.canEdit}
                placeholder={'e.g. Top customer is 35% of revenue\nFounder runs all sales'}
                className={inputClass}
              />
              <span className="text-xs font-normal text-muted-foreground">On “Go”, each red flag becomes a claim to verify in diligence.</span>
            </label>
            {view.canEdit ? (
              <div>
                <Button type="submit" size="sm">
                  Save screening
                </Button>
              </div>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Asking price against your range</CardTitle>
          <CardDescription>A screening-grade sanity check — not the price bridge, which comes with diligence.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm" data-numeric>
          <span>Asking price: {view.askingPrice ? formatMoney({ amount: view.askingPrice.amount, currency: view.askingPrice.currency }) : 'not known yet (add it on Valuation)'}</span>
          <span>
            Your range:{' '}
            {view.valueLow !== null && view.valueHigh !== null ? `${formatMoney({ amount: view.valueLow, currency })} – ${formatMoney({ amount: view.valueHigh, currency })}` : 'not set'}
          </span>
          {read ? <strong>{read}</strong> : null}
        </CardContent>
      </Card>

      {view.canDecide ? (
        <Card>
          <CardHeader>
            <CardTitle>Verdict</CardTitle>
            <CardDescription>Go starts diligence and carries your red flags forward as claims to verify. Recorded with your name in the audit log.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={decideScreening.bind(null, dealId)} className="flex flex-col gap-3">
              <fieldset className="grid gap-2 sm:grid-cols-3">
                <legend className="sr-only">Verdict</legend>
                {(Object.keys(VERDICT_LABELS) as (keyof typeof VERDICT_LABELS)[]).map((verdict) => (
                  <label key={verdict} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border p-3 text-sm has-[:checked]:border-indigo-ink has-[:checked]:bg-muted">
                    <input type="radio" name="verdict" value={verdict} required /> {VERDICT_LABELS[verdict]}
                  </label>
                ))}
              </fieldset>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Rationale
                <textarea name="rationale" required minLength={3} rows={2} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Gaps (for “Needs more”)
                <input name="gaps" className={inputClass} />
              </label>
              <div>
                <Button type="submit" size="sm">
                  Record verdict
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : view.stage !== 'SCREENING' ? (
        <p className="text-sm text-muted-foreground">This pact has left screening; the intake above is kept as it was decided.</p>
      ) : null}
    </div>
  );
}

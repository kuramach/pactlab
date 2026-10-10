'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { useActionState, useState } from 'react';
import { fractionToPercent, MAX_YEARS, type ScenarioValues } from '../../../valuation/_lib/form';
import type { ScenarioFormState } from './actions';

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

export interface AcceptedFinding {
  id: string;
  title: string;
  price: string;
}

function Field({ label, name, defaultValue, hint, suffix }: { label: string; name: string; defaultValue?: string; hint?: string; suffix?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <span className="flex items-center gap-2">
        <input name={name} defaultValue={defaultValue ?? ''} inputMode="decimal" className={inputClass} autoComplete="off" />
        {suffix ? <span className="text-muted-foreground">{suffix}</span> : null}
      </span>
      {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/** Scenario inputs. Rates are entered as percents; the server converts them to fractions without floating point. */
export function ScenarioForm({
  action,
  name,
  values,
  currency,
  takePrivate,
  accepted,
  submitLabel,
}: {
  action: (state: ScenarioFormState, data: FormData) => Promise<ScenarioFormState>;
  name: string;
  values: ScenarioValues | null;
  currency: string;
  takePrivate: boolean;
  accepted: readonly AcceptedFinding[];
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const assumptions = values?.assumptions;
  const [method, setMethod] = useState<'ARR_MULTIPLE' | 'DCF'>(assumptions?.method ?? 'ARR_MULTIPLE');
  const dcf = assumptions?.method === 'DCF' ? assumptions : null;
  const [yearCount, setYearCount] = useState(dcf?.years.length ?? 5);
  const [terminalKind, setTerminalKind] = useState<'GORDON' | 'EXIT_MULTIPLE'>(dcf?.terminal.kind ?? 'GORDON');
  const [lboEnabled, setLboEnabled] = useState(takePrivate || values?.lbo != null);
  const pct = (value: string | undefined) => (value === undefined ? undefined : fractionToPercent(value));
  const links = new Map(values?.findingLinks.map((link) => [link.findingId, link.point]) ?? []);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.error ? (
        <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {state.error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Method</CardTitle>
          <CardDescription>All amounts in {currency}. Rates as percents.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Scenario name
            <input name="name" defaultValue={name} required maxLength={200} className={inputClass} readOnly={values !== null} />
          </label>
          <input type="hidden" name="method" value={method} />
          <div className="grid gap-2 sm:grid-cols-2">
            {(['ARR_MULTIPLE', 'DCF'] as const).map((option) => (
              <label key={option} className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm ${method === option ? 'border-indigo-ink bg-muted' : 'border-border'}`}>
                <span className="flex items-center gap-2 font-medium">
                  <input type="radio" checked={method === option} onChange={() => setMethod(option)} />
                  {option === 'ARR_MULTIPLE' ? 'ARR multiple' : 'Discounted cash flow'}
                </span>
                <span className="text-muted-foreground">
                  {option === 'ARR_MULTIPLE' ? 'Enterprise value = ARR × multiple.' : 'Year-by-year growth and free-cash-flow margin, discounted.'}
                </span>
              </label>
            ))}
          </div>

          {method === 'ARR_MULTIPLE' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ARR" name="arr" defaultValue={assumptions?.method === 'ARR_MULTIPLE' ? assumptions.arr : ''} hint="Use the reconciled ARR from Finances." />
              <Field label="ARR multiple" name="multiple" defaultValue={assumptions?.method === 'ARR_MULTIPLE' ? assumptions.multiple : ''} suffix="×" />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Base-year revenue" name="baseRevenue" defaultValue={dcf?.baseRevenue} />
                <Field label="Discount rate" name="discountRate" defaultValue={pct(dcf?.discountRate)} suffix="%" />
              </div>
              <input type="hidden" name="yearCount" value={yearCount} />
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Year</th>
                    <th className="py-1 pr-3 font-medium">Revenue growth %</th>
                    <th className="py-1 font-medium">FCF margin %</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: yearCount }, (_, index) => (
                    <tr key={index}>
                      <td className="py-1 pr-3 font-medium">{index + 1}</td>
                      <td className="py-1 pr-3">
                        <input name={`growth_${index + 1}`} defaultValue={pct(dcf?.years[index]?.growth)} inputMode="decimal" className={inputClass} />
                      </td>
                      <td className="py-1">
                        <input name={`margin_${index + 1}`} defaultValue={pct(dcf?.years[index]?.fcfMargin)} inputMode="decimal" className={inputClass} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={yearCount >= MAX_YEARS} onClick={() => setYearCount((count) => Math.min(count + 1, MAX_YEARS))}>
                  Add year
                </Button>
                <Button size="sm" variant="ghost" disabled={yearCount <= 1} onClick={() => setYearCount((count) => Math.max(count - 1, 1))}>
                  Remove year
                </Button>
              </div>
              <input type="hidden" name="terminalKind" value={terminalKind} />
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Terminal value
                  <select value={terminalKind} onChange={(event) => setTerminalKind(event.target.value as 'GORDON' | 'EXIT_MULTIPLE')} className={inputClass}>
                    <option value="GORDON">Perpetual growth</option>
                    <option value="EXIT_MULTIPLE">Exit revenue multiple</option>
                  </select>
                </label>
                {terminalKind === 'GORDON' ? (
                  <Field label="Terminal growth" name="terminalGrowth" defaultValue={dcf?.terminal.kind === 'GORDON' ? pct(dcf.terminal.growth) : ''} suffix="%" />
                ) : (
                  <Field label="Exit revenue multiple" name="terminalMultiple" defaultValue={dcf?.terminal.kind === 'EXIT_MULTIPLE' ? dcf.terminal.revenueMultiple : ''} suffix="×" />
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Purchase-price bridge</CardTitle>
          <CardDescription>From enterprise value to the equity price. Use a minus sign for negative adjustments.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Cash acquired" name="cash" defaultValue={values?.bridge.cash ?? '0'} />
          <Field label="Debt repaid" name="debt" defaultValue={values?.bridge.debt ?? '0'} />
          <Field label="Debt-like items" name="debtLikeItems" defaultValue={values?.bridge.debtLikeItems ?? '0'} />
          <Field label="Working-capital adjustment" name="workingCapitalAdjustment" defaultValue={values?.bridge.workingCapitalAdjustment ?? '0'} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Priced risks</CardTitle>
          <CardDescription>Accepted findings with a price. Choose which point of each range adjusts this scenario.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {accepted.length === 0 ? (
            <p className="text-muted-foreground">No accepted, priced findings yet. Accept findings on the Findings tab to use them here.</p>
          ) : (
            accepted.map((finding) => (
              <label key={finding.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                <span className="flex flex-col">
                  <span className="font-medium">{finding.title}</span>
                  <span className="font-mono text-xs text-muted-foreground">{finding.price}</span>
                </span>
                <select name={`link_${finding.id}`} defaultValue={links.get(finding.id) ?? ''} className="rounded-md border border-border bg-background px-2 py-1">
                  <option value="">Not applied</option>
                  <option value="LOW">Low end</option>
                  <option value="MID">Midpoint</option>
                  <option value="HIGH">High end</option>
                </select>
              </label>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sponsor returns (LBO)</CardTitle>
          <CardDescription>{takePrivate ? 'Required for take-private deals.' : 'Optional.'}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="lboEnabled" checked={lboEnabled} disabled={takePrivate} onChange={(event) => setLboEnabled(event.target.checked)} />
            Include LBO returns
          </label>
          {takePrivate ? <input type="hidden" name="lboEnabled" value="on" /> : null}
          {lboEnabled ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Entry EBITDA" name="entryEbitda" defaultValue={values?.lbo?.entryEbitda} />
              <Field label="Leverage" name="leverageMultiple" defaultValue={values?.lbo?.leverageMultiple} suffix="× EBITDA" />
              <Field label="Debt repaid over hold" name="debtRepaid" defaultValue={values?.lbo?.debtRepaid} />
              <Field label="Exit EBITDA" name="exitEbitda" defaultValue={values?.lbo?.exitEbitda} />
              <Field label="Exit multiple" name="exitMultiple" defaultValue={values?.lbo?.exitMultiple} suffix="×" />
              <Field label="Hold period" name="holdYears" defaultValue={values?.lbo ? String(values.lbo.holdYears) : '5'} suffix="years" />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

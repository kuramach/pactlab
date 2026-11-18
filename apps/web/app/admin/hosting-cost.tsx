import type { Page } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent } from '@pactlab/ui';
import { Suspense } from 'react';
import { keepParams, pageApiQuery, Pager, pagerLinks, readPage } from '../_components/pager';
import { apiGet } from '../(app)/deals/_lib/api';
import { ApiState } from '../(app)/deals/_lib/states';
import { deleteCostRate, refreshHostingCost, setCostRate } from './cost-actions';

interface Row { key: string; label: string; amount: string }
interface MeteredRow { key: string; label: string; detail?: string | null; ai: string; storage: string; total: string; runs: number; inputTokens: number; outputTokens: number; gbMonths: string }
interface Rate { id: string; kind: 'BEDROCK_INPUT_PER_MTOK' | 'BEDROCK_OUTPUT_PER_MTOK' | 'S3_STORAGE_GB_MONTH'; key: string; unitPrice: string; currency: string; effectiveFrom: string; sourceNote: string }
interface CostView {
  period: { from: string; to: string; granularity: 'DAILY' | 'MONTHLY'; environment: string | null };
  source: { configured: boolean; environment: string; refreshing: boolean; lastAttemptAt: string | null; lastStatus: string | null; lastError: string | null; lastSuccessAt: string | null };
  environments: string[];
  actual: { total: string; currency: string; environments: string[]; byMonth: { month: string; total: string; byEnvironment: Record<string, string>; estimated: boolean }[]; byEnvironment: Row[]; byService: Row[] };
  metered: { total: string; ai: string; storage: string; missingRates: string[] };
  shared: { environment: string; actual: string; metered: string; unallocated: string } | null;
  bedrockCheck: { actual: string; metered: string } | null;
  rates: Rate[];
}

const cell = 'px-3 py-2 align-top';
const number = new Intl.NumberFormat('en-US');
const usd = (amount: string) => `$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const month = (date: Date, offset: number) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
const field = 'rounded-md border border-border bg-background px-2 py-1 text-sm';
const RATE_LABELS: Record<Rate['kind'], string> = { BEDROCK_INPUT_PER_MTOK: 'Bedrock input, per 1M tokens', BEDROCK_OUTPUT_PER_MTOK: 'Bedrock output, per 1M tokens', S3_STORAGE_GB_MONTH: 'S3 storage, per GB-month' };
const ENVIRONMENT_LABELS: Record<string, string> = { prod: 'live', 'nonlive-shared': 'dev/qa shared', untagged: 'untagged (support, tax, payer)' };
const envLabel = (environment: string) => ENVIRONMENT_LABELS[environment] ?? environment;

export const PERIODS = [
  ['this-month', 'This month'],
  ['last-month', 'Last month'],
  ['3m', 'Last 3 months'],
  ['6m', 'Last 6 months'],
  ['12m', 'Last 12 months'],
  ['custom', 'Custom'],
] as const;

/** [from, to) for a preset, or the custom dates; whole months, UTC. */
export function periodOf(preset: string, from: string, to: string, now = new Date()): { from: string; to: string } {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (preset === 'custom' && day.test(from) && day.test(to) && from < to) return { from, to };
  const months = preset === 'last-month' ? -1 : preset === '3m' ? -2 : preset === '6m' ? -5 : preset === '12m' ? -11 : 0;
  return preset === 'last-month' ? { from: iso(month(now, -1)), to: iso(month(now, 0)) } : { from: iso(month(now, months)), to: iso(month(now, 1)) };
}

/** A bar for a share of the largest row: the table carries the numbers. */
function Bar({ amount, max }: { amount: string; max: number }) {
  const width = max > 0 ? Math.max(1, Math.round((Number(amount) / max) * 100)) : 0;
  return (
    <div aria-hidden className="h-2 w-full rounded bg-muted">
      <div className="h-2 rounded bg-indigo" style={{ width: `${width}%` }} />
    </div>
  );
}

function SpendTable({ label, rows }: { label: string; rows: Row[] }) {
  const max = Math.max(0, ...rows.map((row) => Number(row.amount)));
  return (
    <table className="w-full text-left text-sm" aria-label={label}>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-t border-border">
            <td className={`${cell} w-1/3`}>{label === 'Spend by environment' ? envLabel(row.label) : row.label}</td>
            <td className={`${cell} w-1/2`}>
              <Bar amount={row.amount} max={max} />
            </td>
            <td className={`${cell} text-right font-mono`}>{usd(row.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MeteredTable({ label, rows, show }: { label: string; rows: MeteredRow[]; show: 'all' | 'ai' }) {
  if (rows.length === 0) return <p className="px-4 py-3 text-sm text-muted-foreground">No metered usage in this period.</p>;
  return (
    <table className="w-full text-left text-sm" aria-label={label}>
      <thead className="text-xs uppercase tracking-wide text-muted-foreground">
        <tr>
          <th className={cell}>{label}</th>
          <th className={`${cell} text-right`}>AI runs</th>
          <th className={`${cell} text-right`}>Tokens in / out</th>
          {show === 'all' ? <th className={`${cell} text-right`}>Storage (GB-months)</th> : null}
          <th className={`${cell} text-right`}>AI (est.)</th>
          {show === 'all' ? <th className={`${cell} text-right`}>Storage (est.)</th> : null}
          <th className={`${cell} text-right`}>Total (est.)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-t border-border">
            <td className={cell}>
              {row.label}
              {row.detail ? <div className="text-xs text-muted-foreground">{row.detail}</div> : null}
            </td>
            <td className={`${cell} text-right font-mono`}>{number.format(row.runs)}</td>
            <td className={`${cell} text-right font-mono`}>
              {number.format(row.inputTokens)} / {number.format(row.outputTokens)}
            </td>
            {show === 'all' ? <td className={`${cell} text-right font-mono`}>{row.gbMonths}</td> : null}
            <td className={`${cell} text-right font-mono`}>{usd(row.ai)}</td>
            {show === 'all' ? <td className={`${cell} text-right font-mono`}>{usd(row.storage)}</td> : null}
            <td className={`${cell} text-right font-mono font-semibold`}>{usd(row.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * One metered breakdown, priced and summed in the database, most expensive first, with its own
 * pager (T-126). Each section loads on its own (Suspense), after the summary above it.
 */
function MeteredSection(props: { dimension: 'organization' | 'pact' | 'person' | 'auth' | 'model' | 'job' | 'pact_job'; label: string; show: 'all' | 'ai'; period: { from: string; to: string }; search: Record<string, string | string[] | undefined> }) {
  return (
    <Suspense fallback={<p className="px-4 py-3 text-sm text-muted-foreground">Loading {props.label.toLowerCase()} costs…</p>}>
      <MeteredRows {...props} />
    </Suspense>
  );
}

async function MeteredRows({ dimension, label, show, period, search }: { dimension: string; label: string; show: 'all' | 'ai'; period: { from: string; to: string }; search: Record<string, string | string[] | undefined> }) {
  const position = readPage(search, dimension);
  const result = await apiGet<Page<MeteredRow>>(`/v1/admin/cost/metered/${dimension}?from=${period.from}&to=${period.to}${position.cursor ? `&${pageApiQuery(position)}` : ''}`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  return (
    <>
      <MeteredTable label={label} rows={result.data.items} show={show} />
      <Pager label={`${label} pages`} base="/admin" links={pagerLinks({ ...result.data, itemCount: result.data.items.length }, position, keepParams(search), dimension)} />
    </>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-0">
        <div className="px-4 pt-4">
          <h3 className="text-sm font-semibold">{title}</h3>
          {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
        </div>
        <div className="overflow-x-auto pb-2">{children}</div>
      </CardContent>
    </Card>
  );
}

/**
 * Hosting cost (operator console): what AWS billed (Cost Explorer, every environment), what this
 * environment's own records meter (AI and storage, priced with the rates below, estimates), and the
 * shared rest, never spread.
 */
export async function HostingCost({ preset: asked, from, to, environment, search }: { preset: string; from: string; to: string; environment: string; search: Record<string, string | string[] | undefined> }) {
  const preset = PERIODS.some(([key]) => key === asked) ? asked : 'this-month';
  const period = periodOf(preset, from, to);
  const query = `&period=${preset}${preset === 'custom' ? `&from=${period.from}&to=${period.to}` : ''}${environment ? `&env=${environment}` : ''}`;
  const result = await apiGet<CostView>(`/v1/admin/cost?from=${period.from}&to=${period.to}${environment ? `&environment=${encodeURIComponent(environment)}` : ''}`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const months = view.actual.byMonth;
  const maxMonth = Math.max(0, ...months.map((row) => Number(row.total)));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 text-sm">
          <form className="flex flex-wrap items-end gap-3" aria-label="Period and environment">
            <input type="hidden" name="tab" value="cost" />
            <label className="flex flex-col gap-1 font-medium">
              Period
              <select name="period" defaultValue={preset} className={field}>
                {PERIODS.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 font-medium">
              From (custom)
              <input type="date" name="from" defaultValue={period.from} className={field} />
            </label>
            <label className="flex flex-col gap-1 font-medium">
              To, not included (custom)
              <input type="date" name="to" defaultValue={period.to} className={field} />
            </label>
            <label className="flex flex-col gap-1 font-medium">
              Environment
              <select name="env" defaultValue={environment} className={field}>
                <option value="">All</option>
                {view.environments.map((entry) => (
                  <option key={entry} value={entry}>
                    {envLabel(entry)}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" size="sm" variant="outline">
              Show
            </Button>
          </form>
          <SourceStatus source={view.source} query={query} />
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">AWS billed{view.period.environment ? ` · ${envLabel(view.period.environment)}` : ''}</p>
            <p className="font-mono text-2xl font-semibold">{usd(view.actual.total)}</p>
            <p className="text-xs text-muted-foreground">
              {view.period.from} to {view.period.to}, by {view.period.granularity === 'DAILY' ? 'day' : 'whole month'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Metered here · estimated</p>
            <p className="font-mono text-2xl font-semibold">{usd(view.metered.total)}</p>
            <p className="text-xs text-muted-foreground">
              AI {usd(view.metered.ai)} · storage {usd(view.metered.storage)}, from {envLabel(view.source.environment)}’s own records
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Shared, not allocated</p>
            <p className="font-mono text-2xl font-semibold">{view.shared ? usd(view.shared.unallocated) : '—'}</p>
            <p className="text-xs text-muted-foreground">
              {view.shared
                ? `${envLabel(view.shared.environment)} billed ${usd(view.shared.actual)} less ${usd(view.shared.metered)} metered: database, servers, network, email. Never spread across customers.`
                : `Shown once Cost Explorer has ${envLabel(view.source.environment)}’s spend for the period.`}
            </p>
          </CardContent>
        </Card>
      </div>

      {view.metered.missingRates.length > 0 ? (
        <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Usage without a rate is counted but not priced. Add a rate below for: {view.metered.missingRates.join(', ')}.
        </p>
      ) : null}
      {view.bedrockCheck ? (
        <p className="text-sm text-muted-foreground">
          Check: AWS billed {usd(view.bedrockCheck.actual)} for Bedrock on {envLabel(view.source.environment)}; the meter estimates {usd(view.bedrockCheck.metered)}. A large gap means a rate is wrong or
          missing.
        </p>
      ) : null}

      <Section title="By month" note="AWS billed, every environment stacked. Months still open are AWS's estimate.">
        {months.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">No billed spend stored for this period yet.</p>
        ) : (
          <table className="w-full text-left text-sm" aria-label="Spend by month">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className={cell}>Month</th>
                {view.actual.environments.map((entry) => (
                  <th key={entry} className={`${cell} text-right`}>
                    {envLabel(entry)}
                  </th>
                ))}
                <th className={`${cell} w-1/4`} />
                <th className={`${cell} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {months.map((row) => (
                <tr key={row.month} className="border-t border-border">
                  <td className={cell}>
                    {row.month} {row.estimated ? <Badge variant="draft">estimate</Badge> : null}
                  </td>
                  {view.actual.environments.map((entry) => (
                    <td key={entry} className={`${cell} text-right font-mono`}>
                      {usd(row.byEnvironment[entry] ?? '0')}
                    </td>
                  ))}
                  <td className={cell}>
                    <Bar amount={row.total} max={maxMonth} />
                  </td>
                  <td className={`${cell} text-right font-mono font-semibold`}>{usd(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="By environment" note="AWS billed, by the pactlab:environment tag.">
          <SpendTable label="Spend by environment" rows={view.actual.byEnvironment} />
        </Section>
        <Section title="By AWS product" note="AWS billed, by service (database, compute, Bedrock models, storage, email, …).">
          <SpendTable label="Spend by AWS product" rows={view.actual.byService} />
        </Section>
      </div>

      <Section title="By organization" note={`Metered estimates from ${envLabel(view.source.environment)}: AI tokens × the model’s rate, documents held × the storage rate.`}>
        <MeteredSection dimension="organization" label="Organization" show="all" period={period} search={search} />
      </Section>
      <Section title="By sign-in method" note="Company SSO organizations against email-code organizations.">
        <MeteredSection dimension="auth" label="Sign-in method" show="all" period={period} search={search} />
      </Section>
      <Section title="By pact">
        <MeteredSection dimension="pact" label="Pact" show="all" period={period} search={search} />
      </Section>
      <Section title="By person" note="Who asked for the AI run or uploaded the document. Runs before 2026-11-15 have no person.">
        <MeteredSection dimension="person" label="Person (email)" show="all" period={period} search={search} />
      </Section>
      <Section title="By model">
        <MeteredSection dimension="model" label="Model" show="ai" period={period} search={search} />
      </Section>
      <Section title="By job type" note="Best-of-breed routing (T-132): what each kind of AI work costs, whichever model served it.">
        <MeteredSection dimension="job" label="Job type" show="ai" period={period} search={search} />
      </Section>
      <Section title="By pact and job type" note="Each pact’s AI spend, split by job type.">
        <MeteredSection dimension="pact_job" label="Pact · job type" show="ai" period={period} search={search} />
      </Section>

      <Section title="Rates" note="Unit prices from AWS's price pages, each from a date; the same date corrects a rate. Estimates use the rate in force on the day.">
        <table className="w-full text-left text-sm" aria-label="Rates">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className={cell}>What</th>
              <th className={cell}>Model or class</th>
              <th className={`${cell} text-right`}>Price (USD)</th>
              <th className={cell}>From</th>
              <th className={cell}>Source</th>
              <th className={cell} />
            </tr>
          </thead>
          <tbody>
            {view.rates.map((rate) => (
              <tr key={rate.id} className="border-t border-border">
                <td className={cell}>{RATE_LABELS[rate.kind]}</td>
                <td className={`${cell} font-mono text-xs`}>{rate.key}</td>
                <td className={`${cell} text-right font-mono`}>{rate.unitPrice}</td>
                <td className={cell}>{rate.effectiveFrom}</td>
                <td className={`${cell} text-xs text-muted-foreground`}>{rate.sourceNote || '—'}</td>
                <td className={cell}>
                  <form action={deleteCostRate.bind(null, rate.id)}>
                    <Button type="submit" size="sm" variant="ghost">
                      Delete
                    </Button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={setCostRate} className="flex flex-wrap items-end gap-3 px-4 py-3 text-sm" aria-label="Add a rate">
          <label className="flex flex-col gap-1 font-medium">
            What
            <select name="kind" className={field}>
              {Object.entries(RATE_LABELS).map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 font-medium">
            Model ID (not for storage)
            <input name="key" list="cost-models" maxLength={200} placeholder="us.anthropic.claude-sonnet-5-5" className={`${field} w-72 font-mono text-xs`} />
            <datalist id="cost-models">
              {[...new Set([...view.metered.missingRates.filter((entry) => entry.startsWith('BEDROCK')).map((entry) => entry.split(' ')[1] ?? ''), ...view.rates.filter((rate) => rate.kind !== 'S3_STORAGE_GB_MONTH').map((rate) => rate.key)])]
                .filter(Boolean)
                .map((key) => (
                  <option key={key} value={key} />
                ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1 font-medium">
            Price (USD)
            <input name="unitPrice" required inputMode="decimal" pattern="\d{1,10}(\.\d{1,8})?" className={`${field} w-28 font-mono`} />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            From
            <input type="date" name="effectiveFrom" required defaultValue={iso(new Date())} className={field} />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            Source
            <input name="sourceNote" maxLength={500} placeholder="AWS Bedrock pricing page, us-east-1" className={`${field} w-72`} />
          </label>
          <Button type="submit" size="sm">
            Save rate
          </Button>
        </form>
      </Section>
    </div>
  );
}

function SourceStatus({ source, query }: { source: CostView['source']; query: string }) {
  if (!source.configured) {
    return (
      <p className="text-muted-foreground">
        AWS billed spend is read on live only, from the payer account’s Cost Explorer. Here, the metered estimates below come from this environment’s records. Setup:
        docs/runbooks/hosting-cost.md.
      </p>
    );
  }
  const when = (value: string | null) => (value ? new Date(value).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'never');
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-muted-foreground">
        From Cost Explorer: last read {when(source.lastSuccessAt)}
        {source.refreshing ? ' · reading now (reload in a minute)' : ''}
        {source.lastStatus === 'FAILED' ? ` · the last attempt (${when(source.lastAttemptAt)}) failed: ${source.lastError ?? 'unknown error'}` : ''}
      </span>
      <form action={refreshHostingCost.bind(null, query)}>
        <Button type="submit" size="sm" variant="outline">
          Refresh now
        </Button>
      </form>
    </div>
  );
}

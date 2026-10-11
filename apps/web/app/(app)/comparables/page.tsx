import type { ComparableView } from '@pactlab/contracts';
import { COMPANY_TYPE_LABELS, COMPANY_TYPES } from '@pactlab/domain';
import { Badge, Button, buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Glossed, PageHeader, Stat } from '@pactlab/ui';
import { Building2, Database, FlaskConical, Library, PenLine, Plug } from 'lucide-react';
import Link from 'next/link';
import { ComparablesScatterChart } from '../_lib/charts';
import { apiGet } from '../deals/_lib/api';
import { OutcomeBanner } from '../deals/_lib/outcome';
import { ApiState } from '../deals/_lib/states';
import { formatMoney } from '../metrics/_lib/format';
import { addComparable, retireComparable } from './actions';
import { KIND_LABELS, ORIGIN_LABELS, formatMultiple, fractionToPercentLabel } from './_lib/view';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

const OUTCOMES: Record<string, string> = {
  'ok-added': 'Comparable added. Benchmarks on every deal now include it.',
  'ok-retired': 'Comparable retired. It stays on record but no benchmark uses it.',
  'invalid-sourceCitation': 'Say where this comparable comes from — a filing, press release, data-room document or report.',
  'invalid-enterpriseValue': 'Enter the enterprise value as a number above zero.',
  'invalid-arr': 'Enter the ARR as a number above zero.',
  'invalid-sourceUrl': 'The source link must start with https://',
  'invalid-arrGrowth': 'Enter growth as a percentage, such as 25.',
  'invalid-nrr': 'Enter NRR as a percentage, such as 105.',
  'invalid-grr': 'Enter GRR as a percentage, such as 90.',
  invalid: 'The comparable could not be saved. Check the figures and the source.',
  forbidden: 'Only organization administrators and deal leads can change the comparables.',
  conflict: 'That comparable was already retired.',
};

const ORIGIN_ICONS = { OWN_DEAL: Library, ENTERED: PenLine, PROVIDER: Plug, SYNTHETIC: FlaskConical } as const;
const ORIGIN_ACCENTS = { OWN_DEAL: 'indigo', ENTERED: 'teal', PROVIDER: 'navy', SYNTHETIC: 'amber' } as const;
const inputClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

function Field({ label, name, required, placeholder, hint, type = 'text' }: { label: string; name: string; required?: boolean; placeholder?: string; hint?: string; type?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      <span>
        <Glossed text={label} />
        {required ? <span className="text-rose"> *</span> : null}
      </span>
      <input name={name} type={type} required={required} placeholder={placeholder} className={inputClass} autoComplete="off" />
      {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function SourceCell({ comparable }: { comparable: ComparableView }) {
  const text = comparable.origin === 'PROVIDER' ? `${comparable.provider ?? 'Provider'} · ${comparable.providerVersion ?? ''}` : (comparable.sourceCitation ?? '—');
  return comparable.sourceUrl ? (
    <a href={comparable.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-ink hover:underline">
      {text}
    </a>
  ) : comparable.sourceDealId ? (
    <Link href={`/deals/${comparable.sourceDealId}`} className="text-indigo-ink hover:underline">
      {text}
    </Link>
  ) : (
    <span>{text}</span>
  );
}

/**
 * The firm's comparables: precedent transactions and public peers entered
 * with a source, its own approved deals, a data provider (later) and a
 * labelled synthetic set for demos. Every benchmark is built from these.
 */
export default async function ComparablesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const outcome = (await searchParams)['outcome'];
  const result = await apiGet<{ items: ComparableView[]; canWrite: boolean; provider: 'NOT_CONFIGURED' | 'CONFIGURED' }>('/v1/comparables');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ href: '/', label: 'Home' }, { label: 'Comparables' }]}
        title="Comparables"
        description={
          <Glossed text="Precedent transactions and public peers that put an EV ÷ ARR multiple in context. Every comparable says where it came from; Sextant describes the range, the deal lead judges the ask." />
        }
      />
      <OutcomeBanner outcome={typeof outcome === 'string' ? outcome : undefined} messages={OUTCOMES} />

      {result.kind === 'forbidden' ? (
        <EmptyState
          title="For the buying team"
          description="Comparables are the buying firm’s market knowledge, shown to its own deal team."
          action={
            <Link href="/" className={buttonVariants({ variant: 'outline' })}>
              Back to Home
            </Link>
          }
        />
      ) : result.kind !== 'ok' ? (
        <ApiState result={result} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(Object.keys(ORIGIN_LABELS) as ComparableView['origin'][]).map((origin) => {
              const Icon = ORIGIN_ICONS[origin];
              const count = result.data.items.filter((item) => item.origin === origin).length;
              return (
                <Stat
                  key={origin}
                  label={ORIGIN_LABELS[origin]}
                  value={origin === 'PROVIDER' && result.data.provider === 'NOT_CONFIGURED' ? 'Not connected' : String(count)}
                  hint={
                    origin === 'OWN_DEAL'
                      ? 'Added by deal leads after approval'
                      : origin === 'ENTERED'
                        ? 'Each with its cited source'
                        : origin === 'PROVIDER'
                          ? 'Licensed market data — coming later'
                          : 'Invented for demos — never for a real price'
                  }
                  icon={<Icon />}
                  accent={ORIGIN_ACCENTS[origin]}
                />
              );
            })}
          </div>

          {result.data.items.length === 0 ? (
            <EmptyState title="No comparables yet" description="Add precedent transactions or public peers with their source, or add an approved deal from its overview." />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Growth against multiple</CardTitle>
                <CardDescription>
                  <Glossed text="Each dot is a comparable: ARR growth across, EV ÷ ARR up, size by ARR. Faster growers usually command higher multiples." />
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ComparablesScatterChart
                  label="Comparables by ARR growth and EV to ARR multiple"
                  points={result.data.items
                    .filter((item) => item.arrGrowth !== null)
                    .map((item) => ({
                      name: item.name,
                      multiple: item.multiple,
                      origin: item.origin,
                      originLabel: ORIGIN_LABELS[item.origin],
                      growth: item.arrGrowth as string,
                      arr: item.arr,
                    }))}
                />
              </CardContent>
            </Card>
          )}

          {result.data.items.length > 0 ? (
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center gap-3">
                <Database aria-hidden className="h-5 w-5 text-indigo-ink" />
                <CardTitle className="mr-auto">All active comparables</CardTitle>
                <span className="text-sm text-muted-foreground">{result.data.items.length} in use</span>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full min-w-[56rem] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-slate-text">
                    <tr>
                      <th className="py-2 font-bold">Comparable</th>
                      <th className="py-2 font-bold">Origin</th>
                      <th className="py-2 font-bold">Date</th>
                      <th className="py-2 text-right font-bold">
                        <Glossed text="EV" />
                      </th>
                      <th className="py-2 text-right font-bold">
                        <Glossed text="ARR" />
                      </th>
                      <th className="py-2 text-right font-bold">Multiple</th>
                      <th className="py-2 text-right font-bold">
                        <Glossed text="Growth · NRR · GRR" />
                      </th>
                      <th className="py-2 font-bold">Source</th>
                      {result.data.canWrite ? <th className="py-2" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {[...result.data.items]
                      .sort((a, b) => (b.announcedOn ?? '').localeCompare(a.announcedOn ?? ''))
                      .map((item) => (
                        <tr key={item.id} className="border-t border-navy/5 align-top">
                          <td className="py-2">
                            <div className="font-semibold">{item.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {KIND_LABELS[item.kind]} · {COMPANY_TYPE_LABELS[item.companyType]}
                              {item.acquirerName ? ` · bought by ${item.acquirerName}` : ''}
                            </div>
                          </td>
                          <td className="py-2">
                            <Badge variant={item.origin === 'SYNTHETIC' ? 'draft' : item.origin === 'OWN_DEAL' ? 'reviewed' : 'evidence'}>{ORIGIN_LABELS[item.origin]}</Badge>
                          </td>
                          <td className="py-2 font-mono text-xs">{item.announcedOn ?? '—'}</td>
                          <td className="py-2 text-right font-mono">{formatMoney({ amount: item.enterpriseValue, currency: item.currency })}</td>
                          <td className="py-2 text-right font-mono">{formatMoney({ amount: item.arr, currency: item.currency })}</td>
                          <td className="py-2 text-right font-mono font-bold">{formatMultiple(item.multiple)}</td>
                          <td className="py-2 text-right font-mono text-xs">
                            {fractionToPercentLabel(item.arrGrowth)} · {fractionToPercentLabel(item.nrr)} · {fractionToPercentLabel(item.grr)}
                          </td>
                          <td className="max-w-[16rem] py-2 text-xs">
                            <SourceCell comparable={item} />
                          </td>
                          {result.data.canWrite ? (
                            <td className="py-2">
                              {item.origin !== 'SYNTHETIC' ? (
                                <form action={retireComparable.bind(null, item.id)}>
                                  <Button type="submit" size="sm" variant="outline">
                                    Retire
                                  </Button>
                                </form>
                              ) : null}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : null}

          {result.data.canWrite ? (
            <Card>
              <CardHeader className="flex flex-row items-start gap-3">
                <Building2 aria-hidden className="mt-0.5 h-5 w-5 text-teal" />
                <div className="flex flex-col gap-1">
                  <CardTitle>Add a comparable</CardTitle>
                  <CardDescription>
                    A precedent transaction or a public peer, with where the figures come from. Percentages as numbers (25 for 25%).
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <form action={addComparable} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    Kind
                    <select name="kind" className={inputClass} defaultValue="PRECEDENT_TRANSACTION">
                      <option value="PRECEDENT_TRANSACTION">Precedent transaction</option>
                      <option value="PUBLIC_PEER">Public peer</option>
                    </select>
                  </label>
                  <Field label="Name" name="name" required placeholder="e.g. Acquirer / Target 2025" />
                  <Field label="Target company" name="targetName" required />
                  <Field label="Acquirer" name="acquirerName" hint="Leave blank for a public peer." />
                  <Field label="Date" name="announcedOn" type="date" hint="Announcement, or the peer's measurement date." />
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    Company type
                    <select name="companyType" className={inputClass} defaultValue="SOFTWARE_SAAS">
                      {COMPANY_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {COMPANY_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Field label="Enterprise value (EV)" name="enterpriseValue" required placeholder="25,000,000" />
                  <Field label="ARR" name="arr" required placeholder="5,000,000" />
                  <Field label="Currency" name="currency" required placeholder="USD" />
                  <Field label="ARR growth (YoY) %" name="arrGrowth" placeholder="25" />
                  <Field label="NRR %" name="nrr" placeholder="105" />
                  <Field label="GRR %" name="grr" placeholder="90" />
                  <Field label="Region" name="region" placeholder="North America" />
                  <Field label="Source" name="sourceCitation" required placeholder="Filing, press release or report — with date" />
                  <Field label="Source link" name="sourceUrl" type="url" placeholder="https://…" />
                  <div className="flex items-end">
                    <Button type="submit">Add comparable</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

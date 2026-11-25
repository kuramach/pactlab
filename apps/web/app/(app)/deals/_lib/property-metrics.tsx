import { IMPORT_TARGET_DEFINITIONS, type ImportTarget } from '@pactlab/domain';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import { formatDecimal, formatMoney, formatRatio } from '../../metrics/_lib/format';
import type { PackMetricsView } from '../../metrics/_lib/api';
import { AskSellerButton } from './ask-seller';

type Metric = PackMetricsView['metrics'][number];

/** What a missing figure needs, in plain words: "the rent roll and the unit inspections". */
export function needsLabel(needs: readonly string[]): string {
  const names = needs.map((id) => (id in IMPORT_TARGET_DEFINITIONS ? IMPORT_TARGET_DEFINITIONS[id as ImportTarget].label : id).toLowerCase());
  return names.length <= 1 ? `the ${names[0] ?? 'data'}` : `the ${names.slice(0, -1).join(', the ')} and the ${names.at(-1)}`;
}

/** Every import missing figures need, once, with the figures each would fill in. */
export function missingImports(metrics: readonly { label: string; value: string | null; needs?: readonly string[] | undefined }[]): { id: string; metrics: string[] }[] {
  const byImport = new Map<string, string[]>();
  for (const metric of metrics) {
    if (metric.value !== null) continue;
    for (const id of metric.needs ?? []) byImport.set(id, [...(byImport.get(id) ?? []), metric.label]);
  }
  return [...byImport.entries()].map(([id, labels]) => ({ id, metrics: labels }));
}

/** The note sent with a request: which file, and which figures it fills in. */
export function requestNote(needs: readonly string[], metrics: readonly string[]): string {
  return `Pactlab needs ${needsLabel(needs)} to work out ${metrics.map((label) => label.toLowerCase()).join(', ')}. Please share it here.`;
}

const shown = (metric: Metric, currency: string) =>
  metric.value === null ? '—' : metric.unit === 'MONEY' ? formatMoney({ amount: metric.value, currency }) : metric.unit === 'RATIO' ? formatRatio(metric.value) : formatDecimal(metric.value);

/**
 * The pact's industry metrics on its Home (Kumar, 2026-11-25: "all the metrics in the Home page for the multi family
 * pact"): every figure with how it was worked out; a missing one says what it needs and, with a seller on the pact,
 * asks them for it in one click. Figures come from the metric engine, never a model.
 */
export function PropertyMetricsCard({
  dealId,
  report,
  canAsk,
  requested,
}: {
  dealId: string;
  report: PackMetricsView;
  /** The buyer team, with a seller on the pact to ask. */
  canAsk: boolean;
  /** Import ids already asked for in an open request. */
  requested: ReadonlySet<string>;
}) {
  if (report.metrics.length === 0) return null;
  const missing = missingImports(report.metrics);
  const unasked = missing.filter((entry) => !requested.has(entry.id));
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>{report.calculator === 'multifamily-metrics' ? 'Property metrics' : 'Industry metrics'}</CardTitle>
          <CardDescription>
            From the imported data, in {report.currency}. Each figure shows how it is worked out.{' '}
            <Link href={`/deals/${dealId}/finances`} className="underline">
              Open in Finances
            </Link>
          </CardDescription>
        </div>
        {canAsk && unasked.length > 1 ? (
          <AskSellerButton
            dealId={dealId}
            items={unasked.map((entry) => entry.id)}
            note={unasked.map((entry) => requestNote([entry.id], entry.metrics)).join('\n')}
            label={`Ask the seller for all ${unasked.length}`}
          />
        ) : null}
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {report.metrics.map((metric) => {
            const needs = metric.value === null ? (metric.needs ?? []) : [];
            const asked = needs.length > 0 && needs.every((id) => requested.has(id));
            return (
              <div key={metric.key} className={`flex flex-col gap-1 rounded-xl border p-4 ${metric.value === null ? 'border-dashed border-amber/40 bg-amber/5' : 'border-navy/10'}`}>
                <dt className="text-xs font-bold uppercase tracking-wide text-slate-text">{metric.label}</dt>
                <dd className="text-2xl font-extrabold tracking-tight" data-numeric>
                  {shown(metric, report.currency)}
                </dd>
                {metric.value === null ? (
                  <dd className="flex flex-col gap-1.5 text-xs">
                    <span>{needs.length > 0 ? `Needs ${needsLabel(needs)}.` : metric.unavailableReason}</span>
                    {asked ? (
                      <span className="font-medium text-muted-foreground">Requested from the seller</span>
                    ) : canAsk && needs.length > 0 ? (
                      <AskSellerButton dealId={dealId} items={needs.filter((id) => !requested.has(id))} note={requestNote(needs, [metric.label])} label="Ask the seller for it" />
                    ) : needs.length > 0 ? (
                      <Link href={`/deals/${dealId}/sources/upload`} className="w-fit underline">
                        Import it
                      </Link>
                    ) : null}
                  </dd>
                ) : (
                  <dd className="text-xs text-muted-foreground">
                    {metric.formula} · {metric.sourceCount} records
                  </dd>
                )}
              </div>
            );
          })}
        </dl>
      </CardContent>
    </Card>
  );
}

import type { SourcePlanResponse } from '@pactlab/contracts';
import { Badge, Button, buttonVariants, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@pactlab/ui';
import { COMPANY_TYPE_LABELS } from '@pactlab/domain';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { dealsApi } from '../../_lib/api';
import { isUuidParam } from '../../_lib/filters';
import { failureHint, HEALTH_TEXT, PROVIDER_LABELS, sourceHealth } from '../../_lib/sources';
import { ApiState } from '../../_lib/states';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

const HEALTH_VARIANT = { synced: 'calculation', issues: 'draft', failed: 'danger', never: 'neutral' } as const;

const number = new Intl.NumberFormat('en-US');

const NEXT_RELEASE = { API: 'Live API connection is coming next.', UPLOAD: 'File upload is coming next.' } as const;

/** The checklist of sources this deal's seller type calls for, each with API and upload options. */
function SourcePlan({ plan, dealId }: { plan: SourcePlanResponse; dealId: string }) {
  const connected = plan.sources.filter((source) => source.status === 'CONNECTED').length;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="source-plan">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="source-plan" className="text-lg font-semibold tracking-tight">
          Sources to collect
        </h2>
        <span className="text-sm text-muted-foreground">
          {connected} of {plan.sources.length} connected
          {plan.companyType ? ` · for ${COMPANY_TYPE_LABELS[plan.companyType]}` : ''}
        </span>
      </div>
      {plan.note ? <p className="text-sm text-muted-foreground">{plan.note}</p> : null}
      <ul className="grid gap-3 md:grid-cols-2">
        {plan.sources.map((source) => {
          const api = source.methods.find((method) => method.method === 'API');
          const upload = source.methods.find((method) => method.method === 'UPLOAD');
          return (
            <li key={source.kind}>
              <Card className="h-full">
                <CardHeader className="flex flex-col gap-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{source.label}</span>
                      <CardTitle className="text-base">{source.providerLabel}</CardTitle>
                    </div>
                    <Badge variant={source.status === 'CONNECTED' ? 'calculation' : 'neutral'}>
                      {source.status === 'CONNECTED' ? 'Connected' : 'Not connected'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  <p>{source.why}</p>
                  <p className="text-xs text-muted-foreground">Produces: {source.produces}</p>
                  {source.connections.length > 0 ? (
                    <ul className="flex flex-col gap-1 text-xs">
                      {source.connections.map((connection) => (
                        <li key={connection.id}>
                          {connection.displayName} · {connection.mode === 'FIXTURE' ? 'fixture data' : 'live'}
                          {connection.lastSyncStatus ? ` · ${connection.lastSyncStatus.toLowerCase()}` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" disabled={api?.availability !== 'AVAILABLE'} title={api?.availability === 'NEXT' ? NEXT_RELEASE.API : undefined}>
                      Connect {source.providerLabel} API
                    </Button>
                    {source.upload && upload?.availability === 'AVAILABLE' && source.upload.format === 'CSV' ? (
                      <Link href={`/deals/${dealId}/sources/upload`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                        {source.upload.label}
                      </Link>
                    ) : source.upload ? (
                      <Button size="sm" variant="outline" disabled title={NEXT_RELEASE.UPLOAD}>
                        {source.upload.label}
                      </Button>
                    ) : null}
                  </div>
                  {source.kind === 'BILLING' ? (
                    <p className="text-xs text-muted-foreground">
                      Any billing system works — Stripe, NetSuite, Zuora, SAP, Oracle and more.{' '}
                      <a href="/billing-template.csv" className="text-indigo-ink underline">
                        Download the Pactlab standard template
                      </a>
                      .
                    </p>
                  ) : null}
                  {source.upload ? null : (
                    <p className="text-xs text-muted-foreground">Connects through its API only — history can’t be trusted from a spreadsheet.</p>
                  )}
                  {api?.availability === 'NEXT' ? (
                    <p className="text-xs text-muted-foreground">Coming next: the {source.providerLabel} API connection.</p>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Every source connected to a deal — billing exports, GitHub, Jira — with
 * mode, last sync and what it produced. Read-only; provenance first.
 */
export default async function DealSourcesPage({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string }>;
  searchParams: Promise<{ started?: string; imported?: string; created?: string; unchanged?: string }>;
}) {
  const { dealId } = await params;
  const { started, imported, created, unchanged } = await searchParams;
  if (!isUuidParam(dealId)) notFound();
  const [deal, sources, plan, parties] = await Promise.all([
    dealsApi.get(dealId),
    dealsApi.sources(dealId),
    dealsApi.sourcePlan(dealId),
    dealsApi.parties(dealId),
  ]);
  const buyer = parties.kind === 'ok' ? parties.data.items.find((party) => party.role === 'BUYER') : undefined;
  const seller = parties.kind === 'ok' ? parties.data.items.find((party) => party.role === 'SELLER') : undefined;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link href="/deals" className="text-sm text-muted-foreground hover:underline">
          ← Deals
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Sources{deal.kind === 'ok' ? ` · ${deal.data.name}` : ''}
        </h1>
        {buyer && seller ? (
          <p className="text-sm">
            <span className="font-medium">{buyer.name}</span>
            {buyer.ticker ? ` (${buyer.ticker})` : ''} acquiring <span className="font-medium">{seller.name}</span>
            {seller.ticker ? ` (${seller.ticker})` : ''}
            {seller.companyType ? ` · ${COMPANY_TYPE_LABELS[seller.companyType]}` : ''}
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          The sources this deal needs, and the evidence each connected one produced.
        </p>
      </header>

      {started ? (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Pact started. Connect the sources below to start collecting evidence.
        </p>
      ) : null}

      {imported ? (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Billing export imported: {Number(created ?? 0)} new lines, {Number(unchanged ?? 0)} already known. Finances now include
          them.
        </p>
      ) : null}

      {plan.kind === 'ok' ? <SourcePlan plan={plan.data} dealId={dealId} /> : null}

      <h2 className="text-lg font-semibold tracking-tight">Connected sources</h2>

      {sources.kind !== 'ok' ? (
        <ApiState result={sources} />
      ) : sources.data.items.length === 0 ? (
        <EmptyState title="No sources connected yet" description="Connect the sources above to start collecting evidence." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sources.data.items.map((source) => {
            const health = sourceHealth(source);
            const run = source.lastSyncRun;
            return (
              <Card key={source.id}>
                <CardHeader className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {PROVIDER_LABELS[source.provider] ?? source.provider}
                      </span>
                      <CardTitle className="text-base">{source.displayName}</CardTitle>
                    </div>
                    <Badge variant={HEALTH_VARIANT[health]}>{HEALTH_TEXT[health]}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge>{source.mode === 'FIXTURE' ? 'Fixture data' : 'Live'}</Badge>
                    <Badge>{source.evidenceVisibility === 'SHARED' ? 'Shared with target' : 'Buyer only'}</Badge>
                    {source.status !== 'ACTIVE' ? <Badge variant="danger">Disabled</Badge> : null}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  <dl className="grid grid-cols-3 gap-2" data-numeric>
                    <div>
                      <dt className="text-muted-foreground">Evidence</dt>
                      <dd className="font-mono text-lg">{number.format(source.evidenceCount)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Last pull</dt>
                      <dd className="font-mono text-lg">{run ? number.format(run.recordsSeen) : '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Source issues</dt>
                      <dd className="font-mono text-lg">{run ? number.format(run.issuesCount) : '—'}</dd>
                    </div>
                  </dl>
                  {health === 'failed' ? (
                    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-900">
                      {failureHint(run?.errorClass ?? null)}
                    </p>
                  ) : null}
                  {health === 'issues' ? (
                    <p className="text-muted-foreground">
                      Gaps were reported, not filled: missing estimates, dates or unreadable projects.
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {run?.completedAt ? `Last synced ${new Date(run.completedAt).toUTCString()}` : 'No completed sync'}
                    {run ? ` · connector ${run.connectorVersion}` : ''}
                  </p>
                  {source.evidenceCount > 0 ? (
                    <Link href={`/deals/${dealId}/evidence`} className="font-medium text-indigo-ink hover:underline">
                      Browse evidence →
                    </Link>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

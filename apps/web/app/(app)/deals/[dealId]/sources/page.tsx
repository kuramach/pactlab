import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@pactlab/ui';
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

/**
 * Every source connected to a deal — billing exports, GitHub, Jira — with
 * mode, last sync and what it produced. Read-only; provenance first.
 */
export default async function DealSourcesPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  if (!isUuidParam(dealId)) notFound();
  const [deal, sources] = await Promise.all([dealsApi.get(dealId), dealsApi.sources(dealId)]);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link href="/deals" className="text-sm text-muted-foreground hover:underline">
          ← Deals
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Sources{deal.kind === 'ok' ? ` · ${deal.data.name}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">
          Systems connected to this deal and the evidence each one produced.
        </p>
      </header>

      {sources.kind !== 'ok' ? (
        <ApiState result={sources} />
      ) : sources.data.items.length === 0 ? (
        <EmptyState title="No sources connected" description="Connect a billing export, GitHub or Jira to start collecting evidence." />
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

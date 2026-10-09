import { lineageTrail } from '@pactlab/domain';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { dealsApi } from '../../../_lib/api';
import { isUuidParam } from '../../../_lib/filters';
import { ApiState } from '../../../_lib/states';

export default async function EvidenceLineagePage({
  params,
}: {
  params: Promise<{ dealId: string; evidenceId: string }>;
}) {
  const { dealId, evidenceId } = await params;
  if (!isUuidParam(dealId) || !isUuidParam(evidenceId)) notFound();
  const result = await dealsApi.lineage(dealId, evidenceId);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <Link
        href={`/deals/${dealId}/evidence`}
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Evidence
      </Link>
      {result.kind !== 'ok' ? (
        <ApiState result={result} />
      ) : (
        <>
          <header className="flex flex-col gap-2">
            <h2 className="font-mono text-lg font-semibold tracking-tight">
              {result.data.evidence.sourceRecordId}
            </h2>
            <div className="flex gap-2">
              <Badge variant="evidence">{result.data.evidence.evidenceType}</Badge>
              <Badge>
                {result.data.connection.mode === 'FIXTURE' ? 'Synthetic fixture' : 'Live source'}
              </Badge>
              <Badge>
                {result.data.evidence.visibility === 'SHARED' ? 'Shared with target' : 'Buyer only'}
              </Badge>
            </div>
          </header>

          <Card>
            <CardHeader>
              <CardTitle>Lineage</CardTitle>
              <CardDescription>From the source system to this evidence item.</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-3">
                {lineageTrail(result.data).map((step, index) => (
                  <li key={step.label} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-xs"
                    >
                      {index + 1}
                    </span>
                    <div className="flex flex-col">
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {step.label}
                      </span>
                      <span className="font-medium">{step.value}</span>
                      <span className="text-sm text-muted-foreground">{step.detail}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Canonical record</CardTitle>
              <CardDescription>
                Normalized fields. Empty source cells are shown as missing, never filled.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
                {Object.entries(result.data.evidence.canonical).map(([field, value]) => (
                  <div key={field} className="contents">
                    <dt className="font-mono text-muted-foreground">{field}</dt>
                    <dd>{value ?? <span className="text-muted-foreground">missing</span>}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          {result.data.related.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Other versions</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-1 text-sm">
                  {result.data.related.map((edge) => (
                    <li key={`${edge.evidenceId}-${edge.edgeType}`}>
                      <Link
                        href={`/deals/${dealId}/evidence/${edge.evidenceId}`}
                        className="font-mono hover:underline"
                      >
                        {edge.evidenceId}
                      </Link>{' '}
                      <span className="text-muted-foreground">
                        {edge.direction === 'OUTGOING' ? 'older version' : 'newer version'} ·{' '}
                        {edge.depth} step{edge.depth === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

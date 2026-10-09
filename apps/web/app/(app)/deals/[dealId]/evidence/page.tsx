import { Badge, Card, CardContent, EmptyState } from '@pactlab/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { dealsApi } from '../../_lib/api';
import { evidenceQuery, isUuidParam, parseEvidenceFilters } from '../../_lib/filters';
import { ApiState } from '../../_lib/states';

export default async function EvidenceBrowserPage({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { dealId } = await params;
  if (!isUuidParam(dealId)) notFound();
  const filters = parseEvidenceFilters(await searchParams);
  const result = await dealsApi.evidence(dealId, evidenceQuery(filters));

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Evidence</h2>
        <p className="text-sm text-muted-foreground">
          Normalized source records. Open one to trace it back to its source system.
        </p>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 text-sm"
        aria-label="Filter evidence"
      >
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Type</span>
          <select
            name="type"
            defaultValue={filters.type ?? ''}
            className="rounded-md border border-border bg-background px-2 py-1"
          >
            <option value="">All types</option>
            {(result.kind === 'ok' ? result.data.types : []).map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Visibility</span>
          <select
            name="visibility"
            defaultValue={filters.visibility ?? ''}
            className="rounded-md border border-border bg-background px-2 py-1"
          >
            <option value="">Any</option>
            <option value="BUYER_ONLY">Buyer only</option>
            <option value="SHARED">Shared with target</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Source record id</span>
          <input
            name="recordId"
            defaultValue={filters.recordId ?? ''}
            className="rounded-md border border-border bg-background px-2 py-1"
          />
        </label>
        <button type="submit" className="rounded-md border border-border px-3 py-1 font-medium">
          Apply
        </button>
      </form>

      {result.kind !== 'ok' ? (
        <ApiState result={result} />
      ) : result.data.items.length === 0 ? (
        <EmptyState
          title="No evidence"
          description="No evidence matches these filters. Run a sync from a connection to ingest source records."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium">Source record</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 font-medium">Observed</th>
                  <th className="px-4 py-2 font-medium">Visibility</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.data.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-2 font-mono">
                      <Link
                        href={`/deals/${dealId}/evidence/${item.id}`}
                        className="hover:underline"
                      >
                        {item.sourceRecordId}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant="evidence">{item.evidenceType}</Badge>
                    </td>
                    <td className="px-4 py-2">{item.sourceSystem}</td>
                    <td className="px-4 py-2">{item.observedAt?.slice(0, 10) ?? '—'}</td>
                    <td className="px-4 py-2">
                      {item.visibility === 'SHARED' ? 'Shared' : 'Buyer only'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      {result.kind === 'ok' && result.data.nextCursor ? (
        <Link
          href={`/deals/${dealId}/evidence?${evidenceQuery(filters, { cursor: result.data.nextCursor })}`}
          className="self-start text-sm font-medium hover:underline"
        >
          Next page →
        </Link>
      ) : null}
    </div>
  );
}

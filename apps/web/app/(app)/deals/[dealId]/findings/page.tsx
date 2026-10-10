import { FINDING_DOMAINS, FINDING_STATUSES, type Finding } from '@pactlab/domain';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@pactlab/ui';
import Link from 'next/link';
import { apiGet } from '../../_lib/api';
import { ApiState } from '../../_lib/states';
import {
  DOMAIN_LABELS,
  findingsQuery,
  formatPricedRisk,
  groupByDomain,
  parseFindingFilters,
  PRICED_RISK_LABELS,
  statusVariant,
} from '../../../findings/_lib/view';

/**
 * Technology review: findings grouped by domain, each with the commit, tool
 * version and evidence item it cites and its proposed valuation adjustment.
 * Decisions are recorded through the review API; this page never decides.
 */
export default async function FindingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The deal comes from the route; filters from the query string.
  const filters = parseFindingFilters({ ...(await searchParams), deal: (await params).dealId });
  const dealId = filters.dealId;
  const query = findingsQuery(filters);
  const result = dealId
    ? await apiGet<{ items: Finding[] }>(
        `/v1/deals/${encodeURIComponent(dealId)}/findings${query ? `?${query}` : ''}`,
      )
    : null;

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Findings</h2>
        <p className="text-sm text-muted-foreground">
          Drafts from scanners and heuristics stay drafts until a reviewer accepts or rejects them.
        </p>
      </div>

      {!dealId ? (
        <EmptyState
          title="Choose a deal"
          description="Open findings from a deal to review its technology diligence."
        />
      ) : (
        <>
          <form
            method="get"
            className="flex flex-wrap items-end gap-3 text-sm"
            aria-label="Filter findings"
          >
            <input type="hidden" name="deal" value={dealId} />
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">Status</span>
              <select
                name="status"
                defaultValue={filters.status ?? ''}
                className="rounded-md border border-border bg-background px-2 py-1"
              >
                <option value="">Any</option>
                {FINDING_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status.replace('_', ' ').toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">Domain</span>
              <select
                name="domain"
                defaultValue={filters.domain ?? ''}
                className="rounded-md border border-border bg-background px-2 py-1"
              >
                <option value="">All domains</option>
                {FINDING_DOMAINS.map((domain) => (
                  <option key={domain} value={domain}>
                    {DOMAIN_LABELS[domain]}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded-md border border-border px-3 py-1 font-medium">
              Apply
            </button>
          </form>

          {result && result.kind !== 'ok' ? (
            <ApiState result={result} />
          ) : !result || result.data.items.length === 0 ? (
            <EmptyState
              title="No findings"
              description="No findings match these filters. Run a repository scan to draft technology findings."
            />
          ) : (
            groupByDomain(result.data.items).map(([domain, items]) => (
              <Card key={domain}>
                <CardHeader>
                  <CardTitle>{DOMAIN_LABELS[domain]}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead className="text-left text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-4 py-2 font-medium">Finding</th>
                        <th className="px-4 py-2 font-medium">Severity</th>
                        <th className="px-4 py-2 font-medium">Status</th>
                        <th className="px-4 py-2 font-medium">Evidence</th>
                        <th className="px-4 py-2 font-medium">Priced risk</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {items.map((finding) => (
                        <tr key={finding.id} className="align-top">
                          <td className="px-4 py-2">
                            <Link href={`/deals/${dealId}/findings/${finding.id}`} className="font-medium text-indigo-ink hover:underline">
                              {finding.title}
                            </Link>
                            <div className="text-muted-foreground">
                              {finding.origin.toLowerCase()} · confidence{' '}
                              {finding.confidence.toLowerCase()}
                            </div>
                          </td>
                          <td className="px-4 py-2">{finding.severity.toLowerCase()}</td>
                          <td className="px-4 py-2">
                            <Badge variant={statusVariant(finding.status)}>
                              {finding.status.replace('_', ' ').toLowerCase()}
                            </Badge>
                          </td>
                          <td className="px-4 py-2">
                            {finding.evidence.length === 0 ? (
                              <span className="text-muted-foreground">Needs evidence</span>
                            ) : (
                              <ul className="flex flex-col gap-1">
                                {finding.evidence.map((link) => (
                                  <li key={`${link.evidenceItemId}-${link.toolName}`}>
                                    <Link
                                      href={`/deals/${dealId}/evidence/${link.evidenceItemId}`}
                                      className="hover:underline"
                                    >
                                      <Badge variant="evidence">evidence</Badge>
                                    </Link>{' '}
                                    <span className="font-mono">{link.commitSha.slice(0, 12)}</span>{' '}
                                    <span className="text-muted-foreground">
                                      {link.toolName}@{link.toolVersion}
                                      {link.path ? ` · ${link.path}` : ''}
                                      {link.lineStart ? `:${link.lineStart}` : ''}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <div className="font-mono">{formatPricedRisk(finding.pricedRisk)}</div>
                            {finding.pricedRisk ? (
                              <div className="text-muted-foreground">
                                {PRICED_RISK_LABELS[finding.pricedRisk.type]}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            ))
          )}
        </>
      )}
    </div>
  );
}

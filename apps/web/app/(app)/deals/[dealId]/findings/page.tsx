import { FINDING_DOMAINS, FINDING_STATUSES, PACKS, type Finding } from '@pactlab/domain';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Glossed, IconTile } from '@pactlab/ui';
import {
  AlertOctagon,
  Boxes,
  Building2,
  ClipboardCheck,
  FlaskConical,
  Gavel,
  GitCommitHorizontal,
  Handshake,
  Landmark,
  Scale,
  ServerCog,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  Users,
  Wrench,
} from 'lucide-react';
import { BarChart, CHART_COLORS, DonutChart } from '../../../_lib/charts';
import Link from 'next/link';
import { apiGet, dealsApi } from '../../_lib/api';
import { ApiState } from '../../_lib/states';
import { FindingEvidenceChip } from '../../_lib/finding-evidence';
import { runIndustryChecks } from './actions';
import {
  DOMAIN_LABELS,
  findingsQuery,
  formatPricedRisk,
  groupByDomain,
  parseFindingFilters,
  PRICED_RISK_LABELS,
  statusVariant,
  directionText,
  directionVariant,
} from '../../../findings/_lib/view';

/**
 * Technology review: findings grouped by domain, each with the commit, tool
 * version and evidence item it cites and its proposed valuation adjustment.
 * Decisions are recorded through the review API; this page never decides.
 */
const SEVERITY_COLORS = {
  CRITICAL: CHART_COLORS.navy,
  HIGH: CHART_COLORS.rose,
  MEDIUM: CHART_COLORS.amber,
  LOW: CHART_COLORS.indigo,
  INFO: CHART_COLORS.slate,
} as const;

const DOMAIN_ICONS: Record<string, typeof Boxes> = {
  ARCHITECTURE: Boxes,
  MAINTAINABILITY: Wrench,
  SECURITY: ShieldAlert,
  OSS_LICENSE: Scale,
  TEST_QUALITY: FlaskConical,
  OPERATIONS: ServerCog,
  CODE_PROVENANCE: GitCommitHorizontal,
  KEY_PERSON: UserRound,
  FINANCIAL: Landmark,
  COMMERCIAL: Handshake,
  OPERATIONAL: Settings2,
  REGULATORY: ShieldCheck,
  LEGAL: Gavel,
  PROPERTY: Building2,
  PEOPLE: Users,
};

function DomainIcon({ domain }: { domain: string }) {
  const Icon = DOMAIN_ICONS[domain] ?? Boxes;
  return <Icon />;
}

export default async function FindingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The deal comes from the route; filters from the query string.
  const search = await searchParams;
  const filters = parseFindingFilters({ ...search, deal: (await params).dealId });
  const dealId = filters.dealId;
  const query = findingsQuery(filters);
  // Records opened from this list come back to it with the same filters.
  const here = `/deals/${dealId ?? ''}/findings${query ? `?${query}` : ''}`;
  const [result, plan] = dealId
    ? await Promise.all([
        apiGet<{ items: Finding[] }>(`/v1/deals/${encodeURIComponent(dealId)}/findings${query ? `?${query}` : ''}`),
        dealsApi.sourcePlan(dealId),
      ])
    : [null, null];
  // Industry checks: the seller's pack rules (T-057/T-058). Shown only when the pack has any.
  const pack = plan?.kind === 'ok' && plan.data.companyType && plan.data.companyType !== 'OTHER' ? PACKS[plan.data.companyType] : null;
  const checks = typeof search['checks'] === 'string' ? search['checks'] : undefined;
  const count = (key: string) => (typeof search[key] === 'string' ? Number(search[key]) || 0 : 0);

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Findings</h2>
        <p className="text-sm text-muted-foreground">
          Drafts from scanners and heuristics stay drafts until a reviewer accepts or rejects them.
        </p>
      </div>

      {dealId && pack && pack.findingRules.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-navy/10 p-4 text-sm">
          <form action={runIndustryChecks.bind(null, dealId)}>
            <Button type="submit" size="sm">Run {pack.label.toLowerCase()} checks</Button>
          </form>
          <span className="text-slate-text">
            {pack.findingRules.length} deterministic checks over the imported {pack.label.toLowerCase()} data and documents. They only draft findings; a reviewer decides.
          </span>
        </div>
      ) : null}
      {checks === 'ok' ? (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Checks run: {count('created')} new draft {count('created') === 1 ? 'finding' : 'findings'}, {count('existing')} already drafted.
          {count('unresolved') > 0 ? ` ${count('unresolved')} could not be cited exactly and were not drafted.` : ''}
        </p>
      ) : checks ? (
        <p role="alert" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          {checks === 'forbidden' ? 'Your role cannot draft findings on this deal.' : 'The checks could not run. Try again.'}
        </p>
      ) : null}

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
            <>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader className="flex flex-row items-center gap-3">
                    <IconTile accent="rose">
                      <AlertOctagon />
                    </IconTile>
                    <CardTitle>By severity</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DonutChart
                      label="Findings by severity"
                      centerLabel={String(result.data.items.length)}
                      slices={(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const)
                        .map((severity) => ({
                          name: severity.charAt(0) + severity.slice(1).toLowerCase(),
                          value: result.data.items.filter((item) => item.severity === severity).length,
                          color: SEVERITY_COLORS[severity],
                        }))
                        .filter((slice) => slice.value > 0)}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center gap-3">
                    <IconTile accent="indigo">
                      <ClipboardCheck />
                    </IconTile>
                    <CardTitle>Review progress</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <BarChart
                      label="Findings by review status"
                      format="count"
                      height={240}
                      categories={['Draft', 'In review', 'Accepted', 'Rejected']}
                      series={[
                        {
                          name: 'Findings',
                          values: (['DRAFT', 'IN_REVIEW', 'ACCEPTED', 'REJECTED'] as const).map(
                            (status) => result.data.items.filter((item) => item.status === status).length,
                          ),
                        },
                      ]}
                    />
                  </CardContent>
                </Card>
              </div>
              {groupByDomain(result.data.items).map(([domain, items]) => (
              <Card key={domain}>
                <CardHeader className="flex flex-row items-center gap-3">
                  <IconTile accent="navy">
                    <DomainIcon domain={domain} />
                  </IconTile>
                  <CardTitle>
                    <Glossed text={DOMAIN_LABELS[domain]} />
                  </CardTitle>
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
                            </Badge>{' '}
                            <Badge variant={directionVariant(finding.direction)}>{directionText(finding.direction)}</Badge>
                          </td>
                          <td className="px-4 py-2">
                            {finding.evidence.length === 0 ? (
                              <span className="text-muted-foreground">Needs evidence</span>
                            ) : (
                              <ul className="flex flex-col gap-1">
                                {finding.evidence.map((link) => (
                                  <li key={`${link.evidenceItemId ?? link.documentCitation?.quoteHash}-${link.toolName}`}>
                                    <FindingEvidenceChip link={link} dealId={dealId} from={here} />{' '}
                                    {link.commitSha ? <><span className="font-mono">{link.commitSha.slice(0, 12)}</span>{' '}</> : null}
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
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

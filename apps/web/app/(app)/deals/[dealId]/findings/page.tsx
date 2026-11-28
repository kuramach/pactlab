import type { ClaimView } from '@pactlab/contracts';
import { FINDING_DOMAINS, FINDING_STATUSES, PACKS, type Finding, type SourceWithdrawnFlag } from '@pactlab/domain';
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
import type { Page } from '@pactlab/contracts';
import Link from 'next/link';
import { keepParams, pageApiQuery, Pager, pagerLinks, readPage } from '../../../../_components/pager';
import { apiGet, dealsApi } from '../../_lib/api';
import { ApiState } from '../../_lib/states';
import { FindingEvidenceChip } from '../../_lib/finding-evidence';
import { bringInDocumentFindings, runIndustryChecks } from './actions';
import { getI18n } from '../../../../../lib/i18n/server';
import {
  fromDocumentReview,
  needsPricing,
  findingsQuery,
  formatPricedRisk,
  groupByDomain,
  parseFindingFilters,
  statusVariant,
  directionText,
  directionVariant,
} from '../../../findings/_lib/view';
import { ClaimVerdictBadge, claimsFor, HandSourcedBadge } from '../../_lib/seller-claims';
import { SourceWithdrawnBadge } from '../../_lib/source-withdrawn';

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
  const t = await getI18n();
  const words = t.m.findings;
  const list = words.list;
  // The deal comes from the route; filters from the query string.
  const search = await searchParams;
  const filters = parseFindingFilters({ ...search, deal: (await params).dealId });
  const dealId = filters.dealId;
  const query = findingsQuery(filters);
  // Records opened from this list come back to it with the same filters.
  const here = `/deals/${dealId ?? ''}/findings${query ? `?${query}` : ''}`;
  // The list is paged and every filter runs in the database (T-126); the charts read counts across all of it.
  const position = readPage(search);
  const listQuery = [query, filters.pricing === 'needed' ? 'pricing=needed' : '', pageApiQuery(position)].filter(Boolean).join('&');
  const [fetched, fromDocuments, plan, claimsResult, summary] = dealId
    ? await Promise.all([
        apiGet<Page<Finding & { sourceWithdrawn?: SourceWithdrawnFlag[] }>>(`/v1/deals/${encodeURIComponent(dealId)}/findings?${listQuery}`),
        apiGet<{ pending: number }>(`/v1/deals/${encodeURIComponent(dealId)}/findings/from-documents`),
        dealsApi.sourcePlan(dealId),
        apiGet<{ items: ClaimView[] }>(`/v1/deals/${encodeURIComponent(dealId)}/claims`),
        apiGet<{ total: number; bySeverity: Record<string, number>; byStatus: Record<string, number>; pricingNeeded: number }>(`/v1/deals/${encodeURIComponent(dealId)}/findings/summary${query ? `?${query}` : ''}`),
      ])
    : [null, null, null, null, null];
  const claims = claimsResult?.kind === 'ok' ? claimsResult.data.items : [];
  const result = fetched;
  // Built on an import that was later withdrawn (T-154): shown beside the finding, never changing it.
  const withdrawnFlags = new Map(result?.kind === 'ok' ? result.data.items.map((finding) => [finding.id, finding.sourceWithdrawn ?? []] as const) : []);
  const counts = summary?.kind === 'ok' ? summary.data : null;
  const unpriced = counts?.pricingNeeded ?? 0;
  const pendingFromDocuments = fromDocuments?.kind === 'ok' ? fromDocuments.data.pending : 0;
  const broughtIn = typeof search['broughtIn'] === 'string' ? Number(search['broughtIn']) || 0 : null;
  // Industry checks: the seller's pack rules (T-057/T-058). Shown only when the pack has any.
  const pack = plan?.kind === 'ok' && plan.data.companyType && plan.data.companyType !== 'OTHER' ? PACKS[plan.data.companyType] : null;
  const checks = typeof search['checks'] === 'string' ? search['checks'] : undefined;
  const count = (key: string) => (typeof search[key] === 'string' ? Number(search[key]) || 0 : 0);
  const packName = pack && plan?.kind === 'ok' && plan.data.companyType ? t.inText(t.m.common.companyTypes[plan.data.companyType]) : '';

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">{list.title}</h2>
        {dealId ? (
          <Link href={`/deals/${dealId}/claims`} className="text-sm font-semibold text-indigo-ink hover:underline">
            {t.fill(list.sellerStatements, { count: t.number(claims.length) })}
          </Link>
        ) : null}
        <p className="text-sm text-muted-foreground">{list.intro}</p>
      </div>

      {dealId && pack && pack.findingRules.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-navy/10 p-4 text-sm">
          <form action={runIndustryChecks.bind(null, dealId)}>
            <Button type="submit" size="sm">{t.fill(list.runChecks, { pack: packName })}</Button>
          </form>
          <span className="text-slate-text">{t.plural(pack.findingRules.length, list.checksHelp, { pack: packName })}</span>
        </div>
      ) : null}
      {dealId && pendingFromDocuments > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <span>{t.plural(pendingFromDocuments, list.pendingDocuments)}</span>
          <form action={bringInDocumentFindings.bind(null, dealId)}>
            <Button type="submit" size="sm">
              {t.plural(pendingFromDocuments, list.bringIn)}
            </Button>
          </form>
        </div>
      ) : null}
      {broughtIn !== null ? (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {t.plural(broughtIn, list.broughtIn)}
        </p>
      ) : null}
      {checks === 'ok' ? (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {t.plural(count('created'), list.checksRun, { existing: t.number(count('existing')) })}
          {count('unresolved') > 0 ? t.plural(count('unresolved'), list.unresolved) : ''}
        </p>
      ) : checks ? (
        <p role="alert" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          {checks === 'forbidden' ? list.checksForbidden : list.checksFailed}
        </p>
      ) : null}

      {!dealId ? (
        <EmptyState title={list.chooseDeal.title} description={list.chooseDeal.description} />
      ) : (
        <>
          <form
            method="get"
            className="flex flex-wrap items-end gap-3 text-sm"
            aria-label={list.filters.label}
          >
            <input type="hidden" name="deal" value={dealId} />
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">{list.filters.status}</span>
              <select
                name="status"
                defaultValue={filters.status ?? ''}
                className="rounded-md border border-border bg-background px-2 py-1"
              >
                <option value="">{list.filters.any}</option>
                {FINDING_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {words.statuses[status]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">{list.filters.domain}</span>
              <select
                name="domain"
                defaultValue={filters.domain ?? ''}
                className="rounded-md border border-border bg-background px-2 py-1"
              >
                <option value="">{list.filters.allDomains}</option>
                {FINDING_DOMAINS.map((domain) => (
                  <option key={domain} value={domain}>
                    {words.domains[domain]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">{list.filters.source}</span>
              <select
                name="source"
                defaultValue={filters.source ?? ''}
                className="rounded-md border border-border bg-background px-2 py-1"
              >
                <option value="">{list.filters.allSources}</option>
                <option value="document-review">{list.filters.documentReview}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">{list.filters.pricing}</span>
              <select
                name="pricing"
                defaultValue={filters.pricing ?? ''}
                className="rounded-md border border-border bg-background px-2 py-1"
              >
                <option value="">{list.filters.any}</option>
                <option value="needed">{unpriced > 0 ? t.fill(list.filters.needsPricingCount, { count: t.number(unpriced) }) : list.filters.needsPricing}</option>
              </select>
            </label>
            <Button variant="outline" size="sm" type="submit">
              {list.filters.apply}
            </Button>
          </form>

          {result && result.kind !== 'ok' ? (
            <ApiState result={result} t={t} />
          ) : !result || result.data.items.length === 0 ? (
            <EmptyState title={list.empty.title} description={list.empty.description} />
          ) : (
            <>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader className="flex flex-row items-center gap-3">
                    <IconTile accent="rose">
                      <AlertOctagon />
                    </IconTile>
                    <CardTitle>{list.bySeverity}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DonutChart
                      label={list.bySeverityChart}
                      centerLabel={t.number(counts?.total ?? result.data.total)}
                      slices={(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const)
                        .map((severity) => ({
                          name: words.severityNames[severity],
                          value: counts?.bySeverity[severity] ?? 0,
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
                    <CardTitle>{list.progress}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <BarChart
                      label={list.progressChart}
                      format="count"
                      height={240}
                      categories={[list.progressCategories.DRAFT, list.progressCategories.IN_REVIEW, list.progressCategories.ACCEPTED, list.progressCategories.REJECTED]}
                      series={[
                        {
                          name: list.progressSeries,
                          values: (['DRAFT', 'IN_REVIEW', 'ACCEPTED', 'REJECTED'] as const).map(
                            (status) => counts?.byStatus[status] ?? 0,
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
                    <Glossed text={words.domains[domain]} />
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead className="text-left text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-4 py-2 font-medium">{list.columns.finding}</th>
                        <th className="px-4 py-2 font-medium">{list.columns.severity}</th>
                        <th className="px-4 py-2 font-medium">{list.columns.status}</th>
                        <th className="px-4 py-2 font-medium">{list.columns.evidence}</th>
                        <th className="px-4 py-2 font-medium">{list.columns.pricedRisk}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {items.map((finding) => (
                        <tr key={finding.id} className="align-top">
                          <td className="px-4 py-2">
                            <Link href={`/deals/${dealId}/findings/${finding.id}`} className="font-medium text-indigo-ink hover:underline">
                              {finding.title}
                            </Link>
                            <div className="text-muted-foreground">{t.fill(list.meta, { origin: words.origins[finding.origin], confidence: words.confidences[finding.confidence] })}</div>
                            <div className="mt-1">
                              <ClaimVerdictBadge claims={claimsFor(claims, finding.id)} t={t} />
                              <HandSourcedBadge claims={claimsFor(claims, finding.id)} t={t} />
                              <SourceWithdrawnBadge flags={withdrawnFlags.get(finding.id)} t={t} />
                            </div>
                            {fromDocumentReview(finding) ? (
                              <Link href={`/deals/${dealId}/documents`} className="mt-1 inline-flex">
                                <Badge variant="evidence">{list.fromDocumentReview}</Badge>
                              </Link>
                            ) : null}
                          </td>
                          <td className="px-4 py-2">{words.severities[finding.severity]}</td>
                          <td className="px-4 py-2">
                            <Badge variant={statusVariant(finding.status)}>
                              {words.statuses[finding.status]}
                            </Badge>{' '}
                            <Badge variant={directionVariant(finding.direction)}>{directionText(finding.direction, t)}</Badge>
                            {needsPricing(finding) ? (
                              <Badge variant="danger" title={list.needsPricingTitle}>
                                {list.filters.needsPricing}
                              </Badge>
                            ) : null}
                          </td>
                          <td className="px-4 py-2">
                            {finding.evidence.length === 0 ? (
                              <span className="text-muted-foreground">{list.needsEvidence}</span>
                            ) : (
                              <ul className="flex flex-col gap-1">
                                {finding.evidence.map((link) => (
                                  <li key={`${link.evidenceItemId ?? link.documentCitation?.quoteHash}-${link.toolName}`}>
                                    <FindingEvidenceChip link={link} dealId={dealId} from={here} t={t} />{' '}
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
                            <div className="font-mono">{formatPricedRisk(finding.pricedRisk, t)}</div>
                            {finding.pricedRisk ? (
                              <div className="text-muted-foreground">
                                {words.pricedRiskTypes[finding.pricedRisk.type]}
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
              <Pager label={list.pages} base={`/deals/${dealId ?? ''}/findings`} links={pagerLinks({ ...result.data, itemCount: result.data.items.length }, position, keepParams(search), '', t)} t={t} />
            </>
          )}
        </>
      )}
    </div>
  );
}

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  engineeringReport,
  type CodeActivity,
  type ContributorStatus,
  type DeliveryActivity,
} from '@pactlab/calculations';
import { CODE_CONTRIBUTOR_ACTIVITY_EVIDENCE_TYPE, DELIVERY_CONTRIBUTOR_ACTIVITY_EVIDENCE_TYPE } from '@pactlab/connectors';
import {
  appendAuditEvent,
  contributorDirectory,
  peopleAccess,
  withTenant,
  type ContributorIdentityRecord,
  type PrismaClient,
  type TransactionClient,
  ACTIVE_EVIDENCE,
} from '@pactlab/db';
import { permissionsForDealRole, type DealRole, type TenantContext } from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { PRISMA } from '../tokens';
import { codeActivity, deliveryActivity, type ActivityQuery } from './engineering-activity';

const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const isLead = (role: DealRole) => role === 'DEAL_LEAD';
/** Activity is read in pages of this many rows, with no overall cap (T-055). */
const PAGE_ROWS = 10_000;
/** Keep-list entries in the overview; the full list pages through the people endpoint. */
const KEEP_PREVIEW = 20;

type Canonical = Record<string, string | null>;
const int = (value: string | null | undefined) => (value && /^\d+$/.test(value) ? Number(value) : 0);

/** Areas touched (`{"api": 3}`), keeping only non-negative integer counts; malformed input reads as none. */
function parseAreas(value: string | null | undefined): Record<string, number> {
  try {
    const parsed = JSON.parse(value ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, count]) => typeof count === 'number' && Number.isInteger(count) && count >= 0)) as Record<string, number>;
  } catch {
    return {};
  }
}

/** Newest version of each contributor-activity record (superseded versions stay in lineage), read in pages with no cap. */
async function loadActivity(tx: TransactionClient, dealId: string): Promise<{ code: CodeActivity[]; delivery: DeliveryActivity[] }> {
  const rows: { id: string; connectionId: string; evidenceType: string; sourceRecordId: string; canonical: unknown }[] = [];
  let after: string | null = null;
  for (;;) {
    const page: typeof rows = await tx.evidenceItem.findMany({
      where: { dealId, evidenceType: { in: [CODE_CONTRIBUTOR_ACTIVITY_EVIDENCE_TYPE, DELIVERY_CONTRIBUTOR_ACTIVITY_EVIDENCE_TYPE] }, ...ACTIVE_EVIDENCE, ...(after ? { id: { gt: after } } : {}) },
      select: { id: true, connectionId: true, evidenceType: true, sourceRecordId: true, canonical: true },
      orderBy: { id: 'asc' },
      take: PAGE_ROWS,
    });
    rows.push(...page);
    if (page.length < PAGE_ROWS) break;
    after = page[page.length - 1]?.id ?? null;
  }
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) latest.set(`${row.connectionId}|${row.evidenceType}|${row.sourceRecordId}`, row);
  const code: CodeActivity[] = [];
  const delivery: DeliveryActivity[] = [];
  for (const row of latest.values()) {
    const c = (row.canonical ?? {}) as Canonical;
    const key = c['contributorKey'] ?? '';
    const month = c['month'] ?? '';
    if (!/^[0-9a-f]{16}$/.test(key) || !/^\d{4}-\d{2}$/.test(month)) continue;
    if (row.evidenceType === CODE_CONTRIBUTOR_ACTIVITY_EVIDENCE_TYPE) {
      const areas = parseAreas(c['areas']);
      code.push({ contributorKey: key, month, commits: int(c['commits']), additions: int(c['additions']), deletions: int(c['deletions']), areas });
    } else {
      delivery.push({
        contributorKey: key,
        month,
        issuesResolved: int(c['issuesResolved']),
        pointsResolved: int(c['pointsResolved']),
        issuesCreated: int(c['issuesCreated']),
        comments: int(c['comments']),
        resolvedReopened: int(c['resolvedReopened']),
        sprints: int(c['sprints']),
      });
    }
  }
  return { code, delivery };
}

export interface PeopleAccessView {
  enabled: boolean;
  basis: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
}

/**
 * The Engineering view: team health and contributor profiles from code and
 * delivery activity. Profiles are pseudonymous; names are added only when a
 * deal lead has opened the names gate with a recorded basis, and every
 * response carrying names is audited. Buyer side only; never sent to a model.
 * Numbers describe activity, not performance.
 */
@Injectable()
export class EngineeringService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DealAccess) private readonly access: DealAccess,
  ) {}

  private async gate(tx: TransactionClient, dealId: string): Promise<PeopleAccessView> {
    const [latest] = await peopleAccess.history(tx, dealId);
    if (!latest) return { enabled: false, basis: null, decidedByName: null, decidedAt: null };
    const user = await tx.user.findFirst({ where: { id: latest.decidedBy }, select: { displayName: true } });
    return { enabled: latest.enabled, basis: latest.basis, decidedByName: user?.displayName ?? null, decidedAt: latest.decidedAt.toISOString() };
  }

  private names(directory: readonly ContributorIdentityRecord[]): Map<string, string> {
    const names = new Map<string, string>();
    // Prefer the repository name, then Jira's.
    for (const system of ['github', 'jira'] as const) {
      for (const entry of directory) if (entry.system === system && entry.displayName && !names.has(entry.contributorKey)) names.set(entry.contributorKey, entry.displayName);
    }
    return names;
  }

  private statuses(directory: readonly ContributorIdentityRecord[]): Map<string, ContributorStatus> {
    const statuses = new Map<string, ContributorStatus>();
    for (const entry of directory) {
      const current = statuses.get(entry.contributorKey);
      if (!current || current === 'UNKNOWN') statuses.set(entry.contributorKey, entry.status);
    }
    return statuses;
  }

  private async compute(tenant: TenantContext, dealId: string) {
    return withTenant(this.prisma, tenant, async (tx) => {
      const activity = await loadActivity(tx, dealId);
      const directory = await contributorDirectory.list(tx, dealId);
      const months = [...activity.code, ...activity.delivery].map((row) => row.month).sort();
      const asOfMonth = months[months.length - 1] ?? new Date().toISOString().slice(0, 7);
      const report = engineeringReport({ ...activity, statuses: this.statuses(directory), asOfMonth });
      const access = await this.gate(tx, dealId);
      // bounded: one pact's own records of this kind (tens: a checklist, versions, entries, its sources)
      const sources = await tx.connection.findMany({
        where: { dealId, provider: { in: ['github', 'jira'] } },
        select: { id: true, provider: true, displayName: true, mode: true },
        orderBy: { createdAt: 'asc' },
      });
      const completeness = await this.completeness(tx, dealId, sources, activity);
      // bounded: one pact's own records of this kind (tens: a checklist, versions, entries, its sources)
      const keyPersonFindings = await tx.finding.findMany({
        where: { dealId, domain: 'KEY_PERSON' },
        select: { id: true, title: true, status: true, direction: true },
        orderBy: { createdAt: 'asc' },
      });
      return { report, access, directory, sources, keyPersonFindings, activity, completeness };
    });
  }

  /**
   * What the numbers may be missing, said on the page (T-055): a missing code
   * or delivery source, a latest sync that failed, or one that reported
   * source issues (truncation, unreadable projects). Never silent.
   */
  private async completeness(
    tx: TransactionClient,
    dealId: string,
    sources: readonly { id: string; provider: string; displayName: string }[],
    activity: { code: readonly CodeActivity[]; delivery: readonly DeliveryActivity[] },
  ): Promise<{ complete: boolean; notes: string[] }> {
    const notes: string[] = [];
    if (!sources.some((source) => source.provider === 'github') || activity.code.length === 0) notes.push('No code activity: commits are not in these numbers.');
    if (!sources.some((source) => source.provider === 'jira') || activity.delivery.length === 0) notes.push('No delivery activity: Jira work is not in these numbers.');
    for (const source of sources) {
      const run = await tx.syncRun.findFirst({ where: { dealId, connectionId: source.id }, orderBy: { createdAt: 'desc' }, select: { status: true, issuesCount: true } });
      if (!run) notes.push(`${source.displayName} has not been synced yet.`);
      else if (run.status === 'FAILED') notes.push(`The latest sync of ${source.displayName} failed; these numbers come from earlier data.`);
      else if (run.issuesCount > 0) notes.push(`The latest sync of ${source.displayName} reported ${run.issuesCount} source issue${run.issuesCount === 1 ? '' : 's'} (for example a history limit or an unreadable project) — see Sources.`);
    }
    return { complete: notes.length === 0, notes };
  }

  private async auditNames(tenant: TenantContext, dealId: string, requestId: string, count: number) {
    if (count === 0) return;
    await withTenant(this.prisma, tenant, (tx) =>
      appendAuditEvent(tx, {
        organizationId: tenant.organizationId,
        dealId,
        actorUserId: tenant.userId,
        action: 'people.names_viewed',
        targetType: 'deal',
        targetId: dealId,
        outcome: 'SUCCEEDED',
        requestId,
      }),
    );
  }

  /**
   * Team aggregates and bounded lists only (T-055): every person as a compact
   * map point, the first keep-list entries with the count, and all areas.
   * Full profiles page through `people`.
   */
  async overview(tenant: TenantContext, dealId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'engineering.viewed', requestId });
    const { report, access, directory, sources, keyPersonFindings, completeness } = await this.compute(tenant, dealId);
    const names = access.enabled ? this.names(directory) : new Map<string, string>();
    await this.auditNames(tenant, dealId, requestId, access.enabled ? report.points.length : 0);
    const { profiles: _profiles, keepList, points, ...team } = report;
    return {
      ...team,
      points: points.map((point) => ({ ...point, name: names.get(point.contributorKey) ?? null })),
      keepList: keepList.slice(0, KEEP_PREVIEW).map((entry) => ({ ...entry, name: names.get(entry.contributorKey) ?? null })),
      keepCount: keepList.length,
      singleMaintainerAreas: report.areas.filter((area) => area.busFactor <= 1).map((area) => area.area),
      completeness,
      people: access,
      canManageNames: isLead(role),
      sources: sources.map((source) => ({ ...source, mode: source.mode })),
      keyPersonFindings,
    };
  }

  /**
   * Full profiles, a page at a time, with search and filters (T-055). Search
   * matches the pseudonymous label or key always, and names only while the
   * names gate is open — a hidden name is never revealed by a match.
   */
  async people(
    tenant: TenantContext,
    dealId: string,
    query: { q?: string; tag?: string; area?: string; keep?: boolean; cursor?: number; limit?: number },
    requestId: string,
  ) {
    await this.access.require(tenant, dealId, canRead, { action: 'engineering.viewed', requestId });
    const { report, access, directory } = await this.compute(tenant, dealId);
    const names = access.enabled ? this.names(directory) : new Map<string, string>();
    const keep = new Set(report.keepList.map((entry) => entry.contributorKey));
    const term = query.q?.trim().toLowerCase() ?? '';
    const matches = report.profiles.filter((profile) => {
      if (query.tag && !profile.tags.includes(query.tag as (typeof profile.tags)[number])) return false;
      if (query.area && !profile.areasActive.includes(query.area)) return false;
      if (query.keep && !keep.has(profile.contributorKey)) return false;
      if (!term) return true;
      const name = names.get(profile.contributorKey)?.toLowerCase() ?? '';
      return profile.label.toLowerCase().includes(term) || profile.contributorKey.startsWith(term) || (name !== '' && name.includes(term));
    });
    const offset = query.cursor ?? 0;
    const limit = query.limit ?? 50;
    const page = matches.slice(offset, offset + limit);
    await this.auditNames(tenant, dealId, requestId, access.enabled ? page.length : 0);
    return {
      items: page.map((profile) => ({ ...profile, name: names.get(profile.contributorKey) ?? null })),
      total: matches.length,
      nextCursor: offset + limit < matches.length ? offset + limit : null,
      suppressed: report.suppressed,
      people: access,
    };
  }

  async contributor(tenant: TenantContext, dealId: string, contributorKey: string, requestId: string) {
    await this.access.require(tenant, dealId, canRead, { action: 'engineering.viewed', requestId });
    if (!/^[0-9a-f]{16}$/.test(contributorKey)) throw new NotFoundException();
    const { report, access, directory, activity } = await this.compute(tenant, dealId);
    const profile = report.profiles.find((entry) => entry.contributorKey === contributorKey);
    if (!profile) throw new NotFoundException();
    const name = access.enabled ? (this.names(directory).get(contributorKey) ?? null) : null;
    await this.auditNames(tenant, dealId, requestId, name ? 1 : 0);
    const months = report.months.map((month) => month.month);
    // This person's rows, grouped by month once.
    const mine = { code: new Map<string, number>(), resolved: new Map<string, number>(), created: new Map<string, number>() };
    for (const row of activity.code) if (row.contributorKey === contributorKey) mine.code.set(row.month, (mine.code.get(row.month) ?? 0) + row.commits);
    for (const row of activity.delivery) {
      if (row.contributorKey !== contributorKey) continue;
      mine.resolved.set(row.month, (mine.resolved.get(row.month) ?? 0) + row.issuesResolved);
      mine.created.set(row.month, (mine.created.get(row.month) ?? 0) + row.issuesCreated);
    }
    return {
      profile: { ...profile, name },
      people: access,
      series: months.map((month) => ({ month, commits: mine.code.get(month) ?? 0, issuesResolved: mine.resolved.get(month) ?? 0, issuesCreated: mine.created.get(month) ?? 0 })),
      areas: report.areas.filter((area) => profile.areasActive.includes(area.area)),
    };
  }

  /**
   * Behind a point on the Engineering charts (T-129): a month's pull requests (with who committed
   * that month, by pseudonymous label, unless the team is too small to show people), or a month's
   * resolved Jira issues, each linked to the code that cites it. Paged.
   */
  async activity(tenant: TenantContext, dealId: string, query: ActivityQuery, requestId: string) {
    await this.access.require(tenant, dealId, canRead, { action: 'engineering.viewed', requestId });
    const { report, access, directory, activity } = await this.compute(tenant, dealId);
    const names = access.enabled ? this.names(directory) : new Map<string, string>();
    const labels = new Map(report.profiles.map((profile) => [profile.contributorKey, names.get(profile.contributorKey) ?? profile.label]));
    const page = await withTenant(this.prisma, tenant, async (tx) => {
      // bounded: one pact's own records of this kind (tens: a checklist, versions, entries, its sources)
      const sources = await tx.connection.findMany({ where: { dealId, provider: { in: ['github', 'jira'] } }, select: { id: true, provider: true, mode: true, config: true } });
      const byId = new Map(sources.map((source) => [source.id, source]));
      return query.kind === 'delivery' ? deliveryActivity(tx, dealId, query, byId) : codeActivity(tx, dealId, query, byId, (key) => (report.suppressed ? null : (labels.get(key) ?? null)));
    });
    // Who committed in the month: aggregates per pseudonymous person, never below the cohort minimum.
    let committers: { contributorKey: string; label: string; commits: number; areas: string[] }[] | null = null;
    let committerCount = 0;
    if (query.kind === 'code' && !report.suppressed) {
      const byKey = new Map<string, { commits: number; areas: Map<string, number> }>();
      for (const row of activity.code) {
        if (row.month !== query.month) continue;
        const entry = byKey.get(row.contributorKey) ?? { commits: 0, areas: new Map<string, number>() };
        entry.commits += row.commits;
        for (const [area, count] of Object.entries(row.areas)) entry.areas.set(area, (entry.areas.get(area) ?? 0) + count);
        byKey.set(row.contributorKey, entry);
      }
      committerCount = byKey.size;
      committers = [...byKey.entries()]
        .sort((a, b) => b[1].commits - a[1].commits || a[0].localeCompare(b[0]))
        .slice(0, KEEP_PREVIEW)
        .map(([key, entry]) => ({ contributorKey: key, label: labels.get(key) ?? 'Contributor', commits: entry.commits, areas: [...entry.areas.entries()].sort((a, b) => b[1] - a[1]).map(([area]) => area) }));
    }
    await this.auditNames(tenant, dealId, requestId, access.enabled ? (committers?.length ?? 0) : 0);
    const health = report.months.find((entry) => entry.month === query.month) ?? null;
    return { kind: query.kind, month: query.month, health, page, committers, committerCount, suppressed: report.suppressed, people: access };
  }

  /** Only a deal lead opens or closes the names gate, with the basis on record. */
  async setPeopleAccess(tenant: TenantContext, dealId: string, body: { enabled: boolean; basis: string }, requestId: string): Promise<PeopleAccessView> {
    await this.access.require(tenant, dealId, isLead, { action: body.enabled ? 'people.names_enabled' : 'people.names_disabled', requestId });
    if (body.basis.trim().length < 10) throw new BadRequestException('Give the basis in a sentence');
    return withTenant(this.prisma, tenant, async (tx) => {
      await peopleAccess.record(tx, { organizationId: tenant.organizationId, dealId, enabled: body.enabled, basis: body.basis.trim(), decidedBy: tenant.userId });
      await appendAuditEvent(tx, {
        organizationId: tenant.organizationId,
        dealId,
        actorUserId: tenant.userId,
        action: body.enabled ? 'people.names_enabled' : 'people.names_disabled',
        targetType: 'deal',
        targetId: dealId,
        outcome: 'SUCCEEDED',
        requestId,
      });
      return this.gate(tx, dealId);
    });
  }
}

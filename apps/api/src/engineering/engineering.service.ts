import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  engineeringReport,
  type CodeActivity,
  type ContributorStatus,
  type DeliveryActivity,
  type EngineeringReport,
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
} from '@pactlab/db';
import { permissionsForDealRole, type DealRole, type TenantContext } from '@pactlab/domain';
import { DealAccess } from '../deals/deal-access';
import { PRISMA } from '../tokens';

const canRead = (role: DealRole) => permissionsForDealRole(role).has('BUYER_ANALYSIS_READ');
const isLead = (role: DealRole) => role === 'DEAL_LEAD';
const MAX_ROWS = 50_000;

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

/** Newest version of each contributor-activity record (superseded versions stay in lineage). */
async function loadActivity(tx: TransactionClient, dealId: string): Promise<{ code: CodeActivity[]; delivery: DeliveryActivity[] }> {
  const rows = await tx.evidenceItem.findMany({
    where: { dealId, evidenceType: { in: [CODE_CONTRIBUTOR_ACTIVITY_EVIDENCE_TYPE, DELIVERY_CONTRIBUTOR_ACTIVITY_EVIDENCE_TYPE] } },
    select: { connectionId: true, evidenceType: true, sourceRecordId: true, canonical: true },
    orderBy: { id: 'asc' },
    take: MAX_ROWS,
  });
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
      const sources = await tx.connection.findMany({
        where: { dealId, provider: { in: ['github', 'jira'] } },
        select: { id: true, provider: true, displayName: true, mode: true },
        orderBy: { createdAt: 'asc' },
      });
      const keyPersonFindings = await tx.finding.findMany({
        where: { dealId, domain: 'KEY_PERSON' },
        select: { id: true, title: true, status: true, direction: true },
        orderBy: { createdAt: 'asc' },
      });
      return { report, access, directory, sources, keyPersonFindings, activity };
    });
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

  async overview(tenant: TenantContext, dealId: string, requestId: string) {
    const role = await this.access.require(tenant, dealId, canRead, { action: 'engineering.viewed', requestId });
    const { report, access, directory, sources, keyPersonFindings } = await this.compute(tenant, dealId);
    const names = access.enabled ? this.names(directory) : new Map<string, string>();
    const named = (report: EngineeringReport) => ({
      ...report,
      profiles: report.profiles.map((profile) => ({ ...profile, name: names.get(profile.contributorKey) ?? null })),
      keepList: report.keepList.map((entry) => ({ ...entry, name: names.get(entry.contributorKey) ?? null })),
    });
    await this.auditNames(tenant, dealId, requestId, access.enabled ? report.profiles.length : 0);
    return {
      ...named(report),
      people: access,
      canManageNames: isLead(role),
      sources: sources.map((source) => ({ ...source, mode: source.mode })),
      keyPersonFindings,
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
    return {
      profile: { ...profile, name },
      people: access,
      series: months.map((month) => ({
        month,
        commits: activity.code.filter((row) => row.contributorKey === contributorKey && row.month === month).reduce((n, row) => n + row.commits, 0),
        issuesResolved: activity.delivery.filter((row) => row.contributorKey === contributorKey && row.month === month).reduce((n, row) => n + row.issuesResolved, 0),
        issuesCreated: activity.delivery.filter((row) => row.contributorKey === contributorKey && row.month === month).reduce((n, row) => n + row.issuesCreated, 0),
      })),
      areas: report.areas.filter((area) => profile.areasActive.includes(area.area)),
    };
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

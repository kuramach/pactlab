import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCsvEvidenceSource,
  isUuid,
  type DealId,
  type OrganizationId,
  type UserId,
} from '@pactlab/domain';
import { evidence } from '../evidence';
import {
  isSyntheticDataset,
  loadSyntheticManifest,
  readSyntheticDataset,
  SYNTHETIC_COMPANIES,
} from '../fixtures';
import { withTenant } from '../tenant';
import { startTestDatabase, type TestDatabase } from '../testing';
import { findings } from '../findings';
import { SEED_GITHUB_CONNECTION } from './code-review';
import { emailLogin } from '../login';
import { resolvePrincipal } from '../tenant';
import {
  SEED_CONTRIBUTOR,
  SEED_EMAIL_CODE_TENANT,
  SEED_REVIEWER,
  SEED_TARGET_SOURCES,
  SEED_TENANTS,
  seedSynthetic,
} from './synthetic';

describe('synthetic company fixtures', () => {
  it('have versioned manifests with stable, unique UUID identities', async () => {
    const manifests = await Promise.all(SYNTHETIC_COMPANIES.map(loadSyntheticManifest));
    const ids = manifests.flatMap((m) => [m.companyId, m.deal.id, m.connection.id]);
    expect(ids.every(isUuid)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only allow-listed dataset paths are readable', async () => {
    expect(isSyntheticDataset('HealthyCo/customers.csv')).toBe(true);
    expect(isSyntheticDataset('../package.json')).toBe(false);
    expect(isSyntheticDataset('HealthyCo/../../secrets.csv')).toBe(false);
    await expect(readSyntheticDataset('HealthyCo/../../../.env')).rejects.toThrow(/Unknown/);
  });

  async function pull(company: (typeof SYNTHETIC_COMPANIES)[number]) {
    const manifest = await loadSyntheticManifest(company);
    return createCsvEvidenceSource({
      provider: 'csv',
      version: 'v',
      datasets: manifest.datasets,
      load: readSyntheticDataset,
    }).pull();
  }

  it('HealthyCo normalizes cleanly and management ARR equals 12 × billed MRR', async () => {
    const { records, issues } = await pull('HealthyCo');
    expect(issues).toEqual([]);
    const cents = records
      .filter((r) => r.evidenceType === 'billing.customer')
      .reduce((sum, r) => sum + BigInt((r.canonical['mrr'] ?? '0').replace('.', '')), 0n);
    const arr = records.find((r) => r.sourceRecordId === 'hc-kpi-arr-2026q3')?.canonical['value'];
    expect((cents * 12n).toString()).toBe(arr?.replace('.', ''));
  });

  it('TroubledCo management ARR exceeds what billing supports', async () => {
    const { records } = await pull('TroubledCo');
    const cents = records
      .filter((r) => r.evidenceType === 'billing.customer')
      .reduce((sum, r) => sum + BigInt((r.canonical['mrr'] ?? '0').replace('.', '')), 0n);
    const arr = BigInt(
      records
        .find((r) => r.sourceRecordId === 'tc-kpi-arr-2026q3')!
        .canonical['value']!.replace('.', ''),
    );
    expect(arr > cents * 12n).toBe(true);
  });

  it('SparseCo surfaces missing ids, duplicates and bad dates, and spans more than one page', async () => {
    const { records, issues } = await pull('SparseCo');
    expect(issues.map((issue) => issue.code).sort()).toEqual([
      'DUPLICATE_RECORD_ID',
      'INVALID_DATE',
      'MISSING_RECORD_ID',
    ]);
    expect(records.filter((r) => r.evidenceType === 'billing.customer').length).toBeGreaterThan(50);
    const names = records.map((r) => r.canonical['name']);
    expect(names.filter((name) => name === 'Northwind Supply (synthetic)')).toHaveLength(2);
    expect(records.some((r) => r.canonical['mrr'] === null)).toBe(true);
    expect(records.some((r) => r.canonical['as_of'] === '2024-12-31')).toBe(true);
  });
});

describe('pnpm seed', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  });

  afterAll(async () => {
    await db?.stop();
  });

  const alpha = SEED_TENANTS[0];
  const context = (dealIds: string[], userId: string = alpha.userId) => ({
    organizationId: alpha.organizationId as OrganizationId,
    userId: userId as UserId,
    organizationRole: 'ORG_ADMIN' as const,
    dealIds: dealIds as DealId[],
  });

  async function snapshot() {
    const result = (await db.owner.query(
      `SELECT (SELECT count(*) FROM organizations)::int AS orgs, (SELECT count(*) FROM deals)::int AS deals,
              (SELECT count(*) FROM deal_memberships)::int AS members, (SELECT count(*) FROM connections)::int AS connections,
              (SELECT count(*) FROM sync_runs)::int AS runs, (SELECT count(*) FROM evidence_items)::int AS evidence,
              (SELECT count(*) FROM citations)::int AS citations, (SELECT count(*) FROM findings)::int AS findings,
              (SELECT count(*) FROM finding_evidence_links)::int AS links, (SELECT count(*) FROM audit_events)::int AS audits`,
    )) as { rows: Record<string, number>[] };
    return result.rows[0];
  }

  it('is idempotent: a second run changes nothing', async () => {
    const first = await seedSynthetic(db.owner, db.prisma);
    expect(first.companies.every((c) => !c.sync.replayed)).toBe(true);
    const before = await snapshot();
    const second = await seedSynthetic(db.owner, db.prisma);
    expect(second.companies.every((c) => c.sync.replayed)).toBe(true);
    expect(second.codeReview).toMatchObject({ sync: { replayed: true }, findingsCreated: 0 });
    expect(second.sources.every((source) => source.sync?.replayed ?? source.failed !== null)).toBe(true);
    // SparseCo's repository is the partial-permission fixture: a recorded failure, not an abort.
    expect(first.sources.filter((source) => source.failed).map((s) => [s.company, s.provider])).toEqual([
      ['SparseCo', 'github'],
      ['SparseCo', 'github'],
    ]);
    expect(await snapshot()).toEqual(before);
    expect(before).toMatchObject({ orgs: 3, deals: 9, connections: 18, runs: 18 });
    expect(before?.['evidence']).toBe(before?.['citations']);
  });

  it('creates stable deals whose evidence all resolves to its source', async () => {
    for (const company of SYNTHETIC_COMPANIES) {
      const manifest = await loadSyntheticManifest(company);
      const scope = context([manifest.deal.id]);
      const page = await withTenant(db.prisma, scope, (tx) =>
        evidence.list(tx, manifest.deal.id, { limit: 200 }),
      );
      expect(page.items.length).toBeGreaterThan(0);
      for (const item of page.items) {
        const lineage = await withTenant(db.prisma, scope, (tx) =>
          evidence.lineage(tx, manifest.deal.id, item.id),
        );
        const locator = lineage?.citations[0]?.locator;
        const sources = SEED_TARGET_SOURCES[company];
        switch (lineage?.connection.id) {
          case sources.github.connectionId:
            expect(locator).toMatchObject({ kind: 'git_commit', repository: sources.github.repository });
            break;
          case sources.jira.connectionId:
            expect(locator).toMatchObject({ kind: 'provider_record', system: 'jira', site: sources.jira.site });
            break;
          default:
            expect(lineage?.connection.id).toBe(manifest.connection.id);
            expect(locator?.kind === 'csv_row' && locator.dataset.startsWith(`${company}/`)).toBe(true);
        }
      }
    }
  });

  it('keeps the HealthyCo target contributor behind the contributor boundary', async () => {
    const healthy = await loadSyntheticManifest('HealthyCo');
    const seen = await withTenant(
      db.prisma,
      context([healthy.deal.id], SEED_CONTRIBUTOR.userId),
      (tx) => tx.evidenceItem.count(),
    );
    expect(seen).toBe(0);
  });

  it('drafts TroubledCo code findings that resolve to repository evidence and the head commit', async () => {
    const troubled = await loadSyntheticManifest('TroubledCo');
    const scope = context([troubled.deal.id]);
    const drafts = await withTenant(db.prisma, scope, (tx) => findings.list(tx, troubled.deal.id, {}));
    expect(drafts.map((f) => [f.domain, f.status, f.origin])).toEqual([
      ['CODE_PROVENANCE', 'DRAFT', 'HEURISTIC'],
      ['KEY_PERSON', 'DRAFT', 'HEURISTIC'],
    ]);
    // Seeds never review or price: those are human steps.
    expect(drafts.every((f) => f.pricedRisk === null && f.createdBy.kind === 'SYSTEM')).toBe(true);
    for (const finding of drafts) {
      const [link] = finding.evidence;
      const lineage = await withTenant(db.prisma, scope, (tx) =>
        evidence.lineage(tx, troubled.deal.id, link!.evidenceItemId),
      );
      expect(lineage?.evidence.evidenceType).toBe('code.repository_head');
      expect(lineage?.citations[0]?.locator).toEqual({
        kind: 'git_commit',
        repository: SEED_GITHUB_CONNECTION.repository,
        commitSha: link!.commitSha,
      });
    }
    // A distinct reviewer can decide what the lead submits.
    const reviewer = await withTenant(db.prisma, context([troubled.deal.id], SEED_REVIEWER.userId), (tx) =>
      tx.dealMembership.findFirst({ where: { dealId: troubled.deal.id, userId: SEED_REVIEWER.userId } }),
    );
    expect(reviewer?.role).toBe('REVIEWER');
  });

  it('seeds an email-code organization whose lead can sign in with a code, not Auth0', async () => {
    const charlie = SEED_EMAIL_CODE_TENANT;
    expect(await emailLogin.begin(db.prisma, { email: charlie.email, codeHash: 'a'.repeat(64), ipHash: 'b'.repeat(64) })).toBeTruthy();
    const session = await emailLogin.verify(db.prisma, { email: charlie.email, codeHash: 'a'.repeat(64) });
    expect(session?.organizationId).toBe(charlie.organizationId);
    const tenant = await resolvePrincipal(db.prisma, {
      subject: session!.subject,
      externalOrganizationId: charlie.organizationId,
      issuer: 'PACTLAB',
    });
    expect(tenant?.dealIds).toContain(charlie.dealId);
    // Unknown addresses get no code.
    expect(await emailLogin.begin(db.prisma, { email: 'nobody@charlie.example', codeHash: 'a'.repeat(64), ipHash: 'b'.repeat(64) })).toBeNull();
  });

  it('gives the email-code organization its own copies of every target and source', async () => {
    const charlie = SEED_EMAIL_CODE_TENANT;
    const scope = {
      organizationId: charlie.organizationId as OrganizationId,
      userId: charlie.userId as UserId,
      organizationRole: 'ORG_ADMIN' as const,
      dealIds: [] as DealId[],
    };
    const deals = (await db.owner.query(`SELECT id FROM deals WHERE organization_id = $1`, [charlie.organizationId])) as {
      rows: { id: string }[];
    };
    expect(deals.rows).toHaveLength(4);
    const troubledId = (await loadSyntheticManifest('TroubledCo')).deal.id.replace('-8000-', '-8c00-');
    const counts = await withTenant(db.prisma, { ...scope, dealIds: [troubledId as DealId] }, async (tx) => ({
      connections: await tx.connection.findMany({ where: { dealId: troubledId }, select: { provider: true } }),
      jira: await tx.evidenceItem.count({ where: { dealId: troubledId, sourceSystem: 'jira' } }),
      github: await tx.evidenceItem.count({ where: { dealId: troubledId, sourceSystem: 'github' } }),
      billing: await tx.evidenceItem.count({ where: { dealId: troubledId, sourceSystem: 'csv' } }),
      findings: await tx.finding.count({ where: { dealId: troubledId } }),
    }));
    expect(counts.connections.map((c) => c.provider).sort()).toEqual(['csv', 'github', 'jira']);
    expect(counts.jira).toBeGreaterThan(50);
    expect(counts.github).toBe(1);
    expect(counts.billing).toBeGreaterThan(0);
    expect(counts.findings).toBe(2);
  });
});

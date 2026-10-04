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
import { SEED_CONTRIBUTOR, SEED_TENANTS, seedSynthetic } from './synthetic';

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
              (SELECT count(*) FROM citations)::int AS citations`,
    )) as { rows: Record<string, number>[] };
    return result.rows[0];
  }

  it('is idempotent: a second run changes nothing', async () => {
    const first = await seedSynthetic(db.owner, db.prisma);
    expect(first.companies.every((c) => !c.sync.replayed)).toBe(true);
    const before = await snapshot();
    const second = await seedSynthetic(db.owner, db.prisma);
    expect(second.companies.every((c) => c.sync.replayed)).toBe(true);
    expect(await snapshot()).toEqual(before);
    expect(before).toMatchObject({ orgs: 2, deals: 5, connections: 3, runs: 3 });
    expect(before?.['evidence']).toBe(before?.['citations']);
  });

  it('creates stable deals whose evidence all resolves to its source', async () => {
    for (const company of SYNTHETIC_COMPANIES) {
      const manifest = await loadSyntheticManifest(company);
      const scope = context([manifest.deal.id]);
      const page = await withTenant(db.prisma, scope, (tx) =>
        evidence.list(tx, manifest.deal.id, { limit: 100 }),
      );
      expect(page.items.length).toBeGreaterThan(0);
      for (const item of page.items) {
        const lineage = await withTenant(db.prisma, scope, (tx) =>
          evidence.lineage(tx, manifest.deal.id, item.id),
        );
        expect(lineage?.connection.id).toBe(manifest.connection.id);
        expect(lineage?.citations[0]?.locator.dataset.startsWith(`${company}/`)).toBe(true);
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
});

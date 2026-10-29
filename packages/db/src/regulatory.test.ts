import type { TenantContext } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TransactionClient } from './client';
import { withTenant } from './tenant';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from './testing';

/** T-091: candidate remedy packages and cited regulatory entries are the buyer side's analysis, append-only. */
describe('regulatory scenarios and entries: persistence and RLS', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let contributor: TenantContext;
  const inTenant = <T>(context: TenantContext, fn: (tx: TransactionClient) => Promise<T>) => withTenant(db.prisma, context, fn);
  let counter = 0;
  const id = () => `018f0000-0000-7000-8000-${String(++counter).padStart(12, '0')}`;
  const scenario = (context: TenantContext, tenant = a, createdBy = context.userId) =>
    inTenant(context, (tx) =>
      tx.regulatoryScenario.create({
        data: { id: id(), organizationId: tenant.organizationId, dealId: tenant.dealId, name: 'Close the overlaps', baseRevision: 3, remedyBuyer: 'Synthetic Buyer', siteIds: ['S1', 'S2'], distributionCenters: ['DC1'], systemsTransferred: [], recipe: {}, createdBy },
      }),
    );
  const entry = (context: TenantContext, tenant = a) =>
    inTenant(context, (tx) =>
      tx.regulatoryEntry.create({ data: { id: id(), organizationId: tenant.organizationId, dealId: tenant.dealId, kind: 'BUYER', payload: {}, citation: {}, createdBy: context.userId } }),
    );

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    contributor = (await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR')).context;
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('stores a scenario and an entry for the buyer side', async () => {
    await scenario(a.context);
    await entry(a.context);
    expect(await inTenant(a.context, (tx) => tx.regulatoryScenario.count({ where: { dealId: a.dealId } }))).toBe(1);
    expect(await inTenant(a.context, (tx) => tx.regulatoryEntry.count({ where: { dealId: a.dealId } }))).toBe(1);
  });

  it('keeps them from target contributors and other tenants', async () => {
    for (const context of [contributor, b.context]) {
      expect(await inTenant(context, (tx) => tx.regulatoryScenario.findMany({ where: { dealId: a.dealId } }))).toEqual([]);
      expect(await inTenant(context, (tx) => tx.regulatoryEntry.findMany({ where: { dealId: a.dealId } }))).toEqual([]);
      await expect(scenario(context)).rejects.toThrow();
      await expect(entry(context)).rejects.toThrow();
    }
  });

  it('records only the caller as author, and never updates or deletes', async () => {
    await expect(scenario(a.context, a, contributor.userId)).rejects.toThrow();
    for (const sql of ['UPDATE regulatory_scenarios SET name = $1', 'DELETE FROM regulatory_scenarios', 'UPDATE regulatory_entries SET kind = $1', 'DELETE FROM regulatory_entries']) {
      await expect(inTenant(a.context, (tx) => (sql.includes('$1') ? tx.$executeRawUnsafe(sql, 'TERMS') : tx.$executeRawUnsafe(sql)))).rejects.toThrow(/permission denied/);
    }
  });
});

import type { TenantContext } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TransactionClient } from './client';
import { contributorDirectory, peopleAccess } from './people';
import { withTenant } from './tenant';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from './testing';

const PERSON = { contributorKey: '0123456789abcdef', system: 'github' as const, identity: 'dev-01', displayName: 'Avery Lin (synthetic)', status: 'CURRENT' as const };

describe('contributor directory and names gate: persistence and RLS', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let contributor: TenantContext;
  let analyst: TenantContext;
  const inTenant = <T>(context: TenantContext, fn: (tx: TransactionClient) => Promise<T>) => withTenant(db.prisma, context, fn);
  const scope = () => ({ organizationId: a.organizationId, dealId: a.dealId });
  const gate = (context: TenantContext, enabled = true, tenant = a) =>
    inTenant(context, (tx) =>
      peopleAccess.record(tx, { organizationId: tenant.organizationId, dealId: tenant.dealId, enabled, basis: 'Seller agreed in the data-room terms (synthetic)', decidedBy: context.userId }),
    );

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    contributor = (await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR')).context;
    analyst = (await addSyntheticDealMember(db.owner, a, 'ANALYST')).context;
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('records people once, refreshes names and status, and never downgrades a known status', async () => {
    await inTenant(a.context, (tx) => contributorDirectory.upsert(tx, scope(), [PERSON]));
    await inTenant(a.context, (tx) => contributorDirectory.upsert(tx, scope(), [{ ...PERSON, displayName: 'Avery L. (synthetic)', status: 'UNKNOWN' }]));
    await inTenant(a.context, (tx) => contributorDirectory.upsert(tx, scope(), [{ ...PERSON, system: 'jira', status: 'UNKNOWN' }]));
    const listed = await inTenant(a.context, (tx) => contributorDirectory.list(tx, a.dealId));
    expect(listed.map((entry) => [entry.system, entry.displayName, entry.status])).toEqual([
      ['github', 'Avery L. (synthetic)', 'CURRENT'],
      ['jira', 'Avery Lin (synthetic)', 'UNKNOWN'],
    ]);
  });

  it('keeps people data on the buyer side of the right tenant', async () => {
    expect(await inTenant(contributor, (tx) => contributorDirectory.list(tx, a.dealId))).toEqual([]);
    await expect(inTenant(contributor, (tx) => contributorDirectory.upsert(tx, scope(), [{ ...PERSON, identity: 'x' }]))).rejects.toThrow();
    expect(await inTenant(b.context, (tx) => contributorDirectory.list(tx, a.dealId))).toEqual([]);
    for (const sql of ['DELETE FROM contributor_identities', "UPDATE contributor_identities SET identity = 'x'"]) {
      await expect(inTenant(a.context, (tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow(/permission denied/);
    }
  });

  it('lets only the deal lead open or close the names gate, append-only, with a basis', async () => {
    await expect(gate(analyst)).rejects.toThrow();
    await expect(gate(contributor)).rejects.toThrow();
    await expect(gate(b.context, true, a)).rejects.toThrow();
    await expect(inTenant(a.context, (tx) => peopleAccess.record(tx, { ...scope(), enabled: true, basis: 'too short', decidedBy: a.userId }))).rejects.toThrow(/check constraint/);
    await gate(a.context, true);
    await gate(a.context, false);
    const history = await inTenant(analyst, (tx) => peopleAccess.history(tx, a.dealId));
    expect(history.map((entry) => entry.enabled)).toEqual([false, true]);
    expect(await inTenant(contributor, (tx) => peopleAccess.history(tx, a.dealId))).toEqual([]);
    for (const sql of ['DELETE FROM people_access', 'UPDATE people_access SET enabled = true']) {
      await expect(inTenant(a.context, (tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow(/permission denied/);
    }
  });
});

import type { TenantContext } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TransactionClient } from './client';
import { comparables, multipleJudgements, negotiationAnchors, type ComparableInput } from './comparables';
import { withTenant } from './tenant';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from './testing';

const ENTERED: ComparableInput = {
  kind: 'PRECEDENT_TRANSACTION',
  origin: 'ENTERED',
  name: 'Precedent A',
  targetName: 'Example Target (synthetic)',
  acquirerName: 'Example Acquirer (synthetic)',
  announcedOn: '2025-03-01',
  companyType: 'SOFTWARE_SAAS',
  region: 'North America',
  enterpriseValue: '42000000',
  arr: '10000000.5',
  currency: 'USD',
  arrGrowth: '0.25',
  nrr: '1.08',
  grr: '0.9',
  sourceCitation: 'Synthetic press release, 2025-03-01',
  sourceUrl: null,
  provider: null,
  providerVersion: null,
  sourceDealId: null,
};

const HASH = 'a'.repeat(64);

describe('comparables and multiple judgements: persistence and RLS', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let contributor: TenantContext;
  let analyst: TenantContext;
  const inTenant = <T>(context: TenantContext, fn: (tx: TransactionClient) => Promise<T>) => withTenant(db.prisma, context, fn);
  const record = (context: TenantContext, input: ComparableInput, tenant = a) =>
    inTenant(context, (tx) => comparables.record(tx, { ...input, organizationId: tenant.organizationId, recordedBy: context.userId }));
  const judge = (context: TenantContext, tenant = a) =>
    inTenant(context, (tx) =>
      multipleJudgements.record(tx, {
        organizationId: tenant.organizationId,
        dealId: tenant.dealId,
        verdict: 'HIGH',
        rationale: 'Asking implies a multiple above the comparable range',
        askingVersion: 1,
        askingMultiple: '5.04',
        benchmarkVersion: 'benchmark-1',
        comparableSetHash: HASH,
        comparableCount: 12,
        decidedBy: context.userId,
      }),
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

  it('records exact decimals and lists active comparables for the buy side', async () => {
    const created = await record(analyst, ENTERED);
    expect(created).toMatchObject({ enterpriseValue: '42000000', arr: '10000000.5', grr: '0.9', announcedOn: '2025-03-01', status: 'ACTIVE' });
    expect((await inTenant(a.context, (tx) => comparables.list(tx))).map((c) => c.id)).toContain(created.id);
  });

  it('keeps comparables from target contributors and other organizations', async () => {
    expect(await inTenant(contributor, (tx) => comparables.list(tx))).toEqual([]);
    await expect(record(contributor, ENTERED)).rejects.toThrow();
    expect(await inTenant(b.context, (tx) => comparables.list(tx))).toEqual([]);
    await expect(record(b.context, ENTERED)).rejects.toThrow();
  });

  it('requires provenance: a citation for entered rows, a provider version, a deal for own deals, a label for synthetic', async () => {
    await expect(record(a.context, { ...ENTERED, sourceCitation: null })).rejects.toThrow(/check constraint/);
    await expect(record(a.context, { ...ENTERED, origin: 'PROVIDER', provider: 'x', providerVersion: null })).rejects.toThrow(/check constraint/);
    await expect(record(a.context, { ...ENTERED, origin: 'OWN_DEAL', kind: 'OWN_DEAL' })).rejects.toThrow(/check constraint/);
    await expect(record(a.context, { ...ENTERED, origin: 'SYNTHETIC' })).rejects.toThrow(/check constraint/);
    await expect(record(a.context, { ...ENTERED, origin: 'SYNTHETIC', name: 'Synthetic precedent 1' })).resolves.toMatchObject({ origin: 'SYNTHETIC' });
    await expect(record(a.context, { ...ENTERED, enterpriseValue: '0' })).rejects.toThrow(/check constraint/);
    await expect(record(a.context, { ...ENTERED, sourceUrl: 'http://insecure.example' })).rejects.toThrow(/check constraint/);
  });

  it('adds an own deal only for a deal the writer is buyer-side on, once', async () => {
    const own = { ...ENTERED, origin: 'OWN_DEAL' as const, kind: 'OWN_DEAL' as const, sourceCitation: null, sourceDealId: a.dealId };
    await expect(record(contributor, own)).rejects.toThrow();
    const created = await record(a.context, own);
    expect((await inTenant(a.context, (tx) => comparables.forDeal(tx, a.dealId)))?.id).toBe(created.id);
    await expect(record(a.context, own)).rejects.toThrow(/Unique constraint|unique/i);
  });

  it('retires instead of deleting, and never edits values', async () => {
    const created = await record(a.context, { ...ENTERED, name: 'Precedent to retire' });
    expect(await inTenant(contributor, (tx) => comparables.retire(tx, created.id, contributor.userId))).toBe(false);
    expect(await inTenant(a.context, (tx) => comparables.retire(tx, created.id, a.userId))).toBe(true);
    expect(await inTenant(a.context, (tx) => comparables.retire(tx, created.id, a.userId))).toBe(false);
    expect((await inTenant(a.context, (tx) => comparables.list(tx))).some((c) => c.id === created.id)).toBe(false);
    expect((await inTenant(a.context, (tx) => comparables.get(tx, created.id)))?.status).toBe('RETIRED');
    for (const sql of ['UPDATE comparables SET enterprise_value = 1', 'DELETE FROM comparables']) {
      await expect(inTenant(a.context, (tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow(/permission denied/);
    }
  });

  it('keeps judgements buyer-side, append-only and newest first', async () => {
    const first = await judge(a.context);
    const second = await judge(a.context);
    expect(first).toMatchObject({ verdict: 'HIGH', askingMultiple: '5.04', comparableCount: 12 });
    expect((await inTenant(a.context, (tx) => multipleJudgements.history(tx, a.dealId))).map((j) => j.id)).toEqual([second.id, first.id]);
    expect(await inTenant(contributor, (tx) => multipleJudgements.history(tx, a.dealId))).toEqual([]);
    await expect(judge(contributor)).rejects.toThrow();
    expect(await inTenant(b.context, (tx) => multipleJudgements.history(tx, a.dealId))).toEqual([]);
    for (const sql of ["UPDATE multiple_judgements SET verdict = 'LOW'", 'DELETE FROM multiple_judgements']) {
      await expect(inTenant(a.context, (tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow(/permission denied/);
    }
  });

  it('defaults the ARR basis and records revenue-based comparables', async () => {
    expect((await record(a.context, { ...ENTERED, name: 'Default basis' })).arrBasis).toBe('ARR');
    expect((await record(a.context, { ...ENTERED, name: 'Revenue basis', arrBasis: 'REVENUE' })).arrBasis).toBe('REVENUE');
  });

  it('keeps one active anchor per comparable, buyer side only, removed rather than deleted', async () => {
    const comparable = await record(a.context, { ...ENTERED, name: 'Anchor source' });
    const add = (context: TenantContext, tenant = a) =>
      inTenant(context, (tx) =>
        negotiationAnchors.add(tx, { organizationId: tenant.organizationId, dealId: tenant.dealId, comparableId: comparable.id, note: 'Public deal', addedBy: context.userId }),
      );
    const anchor = await add(a.context);
    expect(anchor).toMatchObject({ status: 'ACTIVE', note: 'Public deal' });
    await expect(add(a.context)).rejects.toThrow(/Unique constraint|unique/i);
    await expect(add(contributor)).rejects.toThrow();
    await expect(add(b.context, b)).rejects.toThrow();
    expect(await inTenant(contributor, (tx) => negotiationAnchors.active(tx, a.dealId))).toEqual([]);
    expect(await inTenant(b.context, (tx) => negotiationAnchors.active(tx, a.dealId))).toEqual([]);
    expect(await inTenant(contributor, (tx) => negotiationAnchors.remove(tx, a.dealId, anchor.id, contributor.userId))).toBe(false);
    expect(await inTenant(a.context, (tx) => negotiationAnchors.remove(tx, a.dealId, anchor.id, a.userId))).toBe(true);
    expect(await inTenant(a.context, (tx) => negotiationAnchors.active(tx, a.dealId))).toEqual([]);
    await expect(add(a.context)).resolves.toMatchObject({ status: 'ACTIVE' });
    for (const sql of ["UPDATE negotiation_anchors SET note = 'x'", 'DELETE FROM negotiation_anchors']) {
      await expect(inTenant(a.context, (tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow(/permission denied/);
    }
  });
});

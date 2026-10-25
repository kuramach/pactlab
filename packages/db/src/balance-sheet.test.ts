import type { TenantContext } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { balanceSheetItems, NO_TERMS, type BalanceSheetItemValues } from './balance-sheet';
import type { TransactionClient } from './client';
import { withTenant } from './tenant';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from './testing';

const LOAN: BalanceSheetItemValues = {
  kind: 'DEBT',
  category: 'TERM_LOAN',
  label: 'Term loan (synthetic)',
  amount: '120000',
  currency: 'USD',
  asOf: '2026-09-30',
  citation: { documentId: '0190f000-0000-7000-8000-0000000000aa', pageNumber: 1, quote: 'Term loan outstanding 120,000', quoteHash: 'a'.repeat(64), charStart: 10, charEnd: 39 },
  note: null,
  terms: NO_TERMS,
};

describe('balance-sheet items: persistence, history and RLS', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let contributor: TenantContext;
  const inTenant = <T>(context: TenantContext, fn: (tx: TransactionClient) => Promise<T>) => withTenant(db.prisma, context, fn);
  const create = (context: TenantContext, values: BalanceSheetItemValues = LOAN, tenant = a) =>
    inTenant(context, (tx) =>
      balanceSheetItems.create(tx, { ...values, organizationId: tenant.organizationId, dealId: tenant.dealId, createdBy: context.userId, reason: 'From the balance sheet' }),
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

  it('creates version 1 with its history and keeps decimals and the citation exact', async () => {
    const item = await create(a.context);
    expect(item).toMatchObject({ version: 1, status: 'ACTIVE', amount: '120000', asOf: '2026-09-30', citation: { pageNumber: 1, quote: 'Term loan outstanding 120,000' } });
    const history = await inTenant(a.context, (tx) => balanceSheetItems.history(tx, a.dealId));
    expect(history.filter((entry) => entry.itemId === item.id).map((entry) => [entry.version, entry.reason])).toEqual([[1, 'From the balance sheet']]);
  });

  it('revises at the expected version only, bumping the version and recording why', async () => {
    const item = await create(a.context);
    const revise = (expectedVersion: number) =>
      inTenant(a.context, (tx) =>
        balanceSheetItems.revise(tx, { ...LOAN, amount: '125000.5', organizationId: a.organizationId, dealId: a.dealId, id: item.id, expectedVersion, updatedBy: a.userId, reason: 'Accrued interest' }),
      );
    expect(await revise(1)).toMatchObject({ version: 2, amount: '125000.5' });
    expect(await revise(1)).toBeNull();
    const withdrawn = await inTenant(a.context, (tx) =>
      balanceSheetItems.withdraw(tx, { organizationId: a.organizationId, dealId: a.dealId, id: item.id, expectedVersion: 2, updatedBy: a.userId, reason: 'Repaid at close' }),
    );
    expect(withdrawn).toMatchObject({ version: 3, status: 'WITHDRAWN' });
    expect(await revise(3)).toBeNull();
    expect((await inTenant(a.context, (tx) => balanceSheetItems.list(tx, a.dealId))).some((entry) => entry.id === item.id)).toBe(false);
    const history = (await inTenant(a.context, (tx) => balanceSheetItems.history(tx, a.dealId))).filter((entry) => entry.itemId === item.id);
    expect(history.map((entry) => [entry.version, entry.status, entry.reason])).toEqual([
      [3, 'WITHDRAWN', 'Repaid at close'],
      [2, 'ACTIVE', 'Accrued interest'],
      [1, 'ACTIVE', 'From the balance sheet'],
    ]);
  });

  it('keeps items on the buyer side of the right tenant', async () => {
    expect(await inTenant(contributor, (tx) => balanceSheetItems.list(tx, a.dealId))).toEqual([]);
    await expect(create(contributor)).rejects.toThrow();
    expect(await inTenant(b.context, (tx) => balanceSheetItems.list(tx, a.dealId))).toEqual([]);
    await expect(create(b.context)).rejects.toThrow();
  });

  it('enforces kinds, categories and non-negative amounts, and never deletes', async () => {
    await expect(create(a.context, { ...LOAN, category: 'DEFERRED_REVENUE' })).rejects.toThrow(/check constraint/);
    await expect(create(a.context, { ...LOAN, amount: '-1' })).rejects.toThrow(/check constraint/);
    await expect(create(a.context, { ...LOAN, kind: 'DEBT_LIKE', category: 'DEFERRED_REVENUE' })).resolves.toMatchObject({ kind: 'DEBT_LIKE' });
    for (const sql of ['DELETE FROM balance_sheet_items', 'DELETE FROM balance_sheet_item_versions', "UPDATE balance_sheet_item_versions SET reason = 'x'", "UPDATE balance_sheet_items SET kind = 'CASH'"]) {
      await expect(inTenant(a.context, (tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow(/permission denied/);
    }
  });
});

import type { TenantContext } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { askingPrices, type AskingPriceInput } from './asking';
import type { TransactionClient } from './client';
import { withTenant } from './tenant';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from './testing';

const PRICE: AskingPriceInput = {
  amount: '1500000',
  currency: 'USD',
  basis: 'ENTERPRISE_VALUE',
  source: 'LETTER_OF_INTENT',
  quotedOn: '2026-09-15',
  earnOutAmount: '200000',
  note: 'Synthetic',
};

describe('asking prices persistence and RLS', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let contributor: TenantContext;
  const inTenant = <T>(context: TenantContext, fn: (tx: TransactionClient) => Promise<T>) => withTenant(db.prisma, context, fn);
  const record = (context: TenantContext, input: AskingPriceInput, tenant = a) =>
    inTenant(context, (tx) => askingPrices.record(tx, { ...input, organizationId: tenant.organizationId, dealId: tenant.dealId, recordedBy: context.userId }));

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    contributor = (await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR')).context;
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('versions revisions, keeps decimals exact and ignores an unchanged repeat', async () => {
    expect((await record(a.context, PRICE)).record).toMatchObject({ version: 1, amount: '1500000', earnOutAmount: '200000', quotedOn: '2026-09-15' });
    expect(await record(a.context, { ...PRICE, amount: '1500000.00' })).toMatchObject({ created: false, record: { version: 1 } });
    expect((await record(a.context, { ...PRICE, amount: '1350000.5' })).record).toMatchObject({ version: 2, amount: '1350000.5' });
    const history = await inTenant(a.context, (tx) => askingPrices.history(tx, a.dealId));
    expect(history.map((entry) => entry.version)).toEqual([2, 1]);
    expect((await inTenant(a.context, (tx) => askingPrices.currentFor(tx, [a.dealId]))).get(a.dealId)?.version).toBe(2);
  });

  it('keeps negotiation terms from target contributors and other tenants', async () => {
    expect(await inTenant(contributor, (tx) => askingPrices.history(tx, a.dealId))).toEqual([]);
    await expect(record(contributor, PRICE)).rejects.toThrow();
    expect(await inTenant(b.context, (tx) => askingPrices.history(tx, a.dealId))).toEqual([]);
    await expect(record(b.context, PRICE)).rejects.toThrow();
  });

  it('enforces positive prices and an earn-out within the price, and never updates or deletes', async () => {
    await expect(record(a.context, { ...PRICE, amount: '0' })).rejects.toThrow(/check constraint/);
    await expect(record(a.context, { ...PRICE, amount: '100', earnOutAmount: '200' })).rejects.toThrow(/check constraint/);
    for (const sql of ['UPDATE asking_prices SET amount = 1', 'DELETE FROM asking_prices']) {
      await expect(inTenant(a.context, (tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow(/permission denied/);
    }
  });
});

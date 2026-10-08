import type { TenantContext } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TransactionClient } from './client';
import { dealParties, type DealPartyInput } from './pacts';
import { withTenant } from './tenant';
import {
  addSyntheticDealMember,
  createSyntheticTenant,
  startTestDatabase,
  type SyntheticTenant,
  type TestDatabase,
} from './testing';

const PRIVATE_BUYER: DealPartyInput = {
  name: 'Alpha Capital',
  ownership: 'PRIVATE',
  ticker: null,
  exchange: null,
  website: null,
  companyType: null,
};
const PUBLIC_SELLER: DealPartyInput = {
  name: 'Target Software Inc.',
  ownership: 'PUBLIC',
  ticker: 'TGTS',
  exchange: 'NASDAQ',
  website: 'https://target.example',
  companyType: 'SOFTWARE_SAAS',
};

describe('deal parties persistence and RLS', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let contributor: TenantContext;

  const inTenant = <T>(context: TenantContext, fn: (tx: TransactionClient) => Promise<T>) =>
    withTenant(db.prisma, context, fn);
  const scope = () => ({ organizationId: a.organizationId, dealId: a.dealId });

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    contributor = (await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR')).context;
    await inTenant(a.context, async (tx) => {
      await dealParties.create(tx, { ...scope(), role: 'BUYER', ...PRIVATE_BUYER });
      await dealParties.create(tx, { ...scope(), role: 'SELLER', ...PUBLIC_SELLER });
    });
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('lists buyer then seller to the deal team and to target contributors', async () => {
    for (const context of [a.context, contributor]) {
      const parties = await inTenant(context, (tx) => dealParties.list(tx, a.dealId));
      expect(parties.map((party) => [party.role, party.name, party.ticker])).toEqual([
        ['BUYER', 'Alpha Capital', null],
        ['SELLER', 'Target Software Inc.', 'TGTS'],
      ]);
    }
    const byDeal = await inTenant(a.context, (tx) => dealParties.forDeals(tx, [a.dealId]));
    expect(byDeal.get(a.dealId)?.map((party) => party.role)).toEqual(['BUYER', 'SELLER']);
  });

  it('hides parties from other tenants and refuses cross-tenant writes', async () => {
    expect(await inTenant(b.context, (tx) => dealParties.list(tx, a.dealId))).toEqual([]);
    expect(await inTenant(b.context, (tx) => dealParties.update(tx, a.dealId, 'SELLER', { name: 'Hijacked' }))).toBeNull();
    await expect(
      inTenant(b.context, (tx) => dealParties.create(tx, { ...scope(), role: 'BUYER', ...PRIVATE_BUYER })),
    ).rejects.toThrow();
  });

  it('lets only the buyer side write parties', async () => {
    expect(await inTenant(contributor, (tx) => dealParties.update(tx, a.dealId, 'SELLER', { name: 'Renamed' }))).toBeNull();
    const renamed = await inTenant(a.context, (tx) =>
      dealParties.update(tx, a.dealId, 'SELLER', { name: 'Target Software Holdings' }),
    );
    expect(renamed?.name).toBe('Target Software Holdings');
  });

  it('keeps one buyer and one seller per deal', async () => {
    await expect(
      inTenant(a.context, (tx) => dealParties.create(tx, { ...scope(), role: 'BUYER', ...PRIVATE_BUYER })),
    ).rejects.toThrow();
  });

  it('requires a ticker for a public company and none for a private one, and a seller company type', async () => {
    const statements = [
      `UPDATE deal_parties SET ticker = NULL WHERE role = 'SELLER'`,
      `UPDATE deal_parties SET ticker = 'ALPH' WHERE role = 'BUYER'`,
      `UPDATE deal_parties SET company_type = NULL WHERE role = 'SELLER'`,
      `UPDATE deal_parties SET name = '  ' WHERE role = 'BUYER'`,
    ];
    for (const sql of statements) {
      await expect(inTenant(a.context, (tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow(/check constraint/);
    }
  });

  it('never deletes a party', async () => {
    await expect(inTenant(a.context, (tx) => tx.$executeRawUnsafe(`DELETE FROM deal_parties`))).rejects.toThrow(
      /permission denied/,
    );
  });
});

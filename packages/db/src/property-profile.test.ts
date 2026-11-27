import type { TenantContext } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TransactionClient } from './client';
import { withTenant } from './tenant';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from './testing';

describe('deal_property_profiles: persistence and RLS (buyer-confidential, T-188)', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let contributor: TenantContext;
  const inTenant = <T>(context: TenantContext, fn: (tx: TransactionClient) => Promise<T>) => withTenant(db.prisma, context, fn);
  let counter = 0;
  const id = () => `018f0000-0000-7000-8000-${String(++counter).padStart(12, '0')}`;
  const profile = (context: TenantContext, overrides: Record<string, unknown> = {}, tenant = a) =>
    inTenant(context, (tx) => tx.dealPropertyProfile.create({ data: { id: id(), organizationId: tenant.organizationId, dealId: tenant.dealId, address: '1200 Sample St, Columbus, OH 43215', updatedBy: context.userId, ...overrides } }));

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    contributor = (await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR')).context;
  }, 60_000);
  afterAll(async () => db?.stop());

  it('stores one profile per pact, with its proposed fields, accepted values and photo references', async () => {
    const row = await profile(a.context, { status: 'ACCEPTED', proposed: [{ key: 'unit_count', value: '48' }], accepted: { unit_count: { value: '48' } }, photos: [{ ref: 'sv:x' }] });
    expect(row.status).toBe('ACCEPTED');
    await expect(profile(a.context)).rejects.toThrow();
  });

  it('refuses shapes the schema forbids', async () => {
    await expect(profile(b.context, { status: 'DONE' }, b)).rejects.toThrow();
    await expect(profile(b.context, { address: 'x' }, b)).rejects.toThrow();
    await expect(profile(b.context, { photos: { not: 'an array' } }, b)).rejects.toThrow();
  });

  it('keeps the profile from the seller side and from other tenants', async () => {
    for (const context of [contributor, b.context]) {
      expect(await inTenant(context, (tx) => tx.dealPropertyProfile.findMany({ where: { dealId: a.dealId }, take: 10 }))).toEqual([]);
      await expect(inTenant(context, (tx) => tx.dealPropertyProfile.updateMany({ where: { dealId: a.dealId }, data: { address: 'Changed address 1' } })).then((r) => r.count)).resolves.toBe(0);
    }
    await expect(profile(contributor, {}, a)).rejects.toThrow();
    expect(await inTenant(a.context, (tx) => tx.dealPropertyProfile.count({ where: { dealId: a.dealId } }))).toBe(1);
  });
});

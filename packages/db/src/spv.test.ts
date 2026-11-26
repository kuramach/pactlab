import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCREDITATION_STATUSES, INVESTOR_VIEW_SECTIONS, newId, type DealId, type OrganizationId, type TenantContext, type UserId } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TransactionClient } from './client';
import { withTenant } from './tenant';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from './testing';

const MIGRATION = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations/20270105000100_startup_spv/migration.sql'), 'utf8');

describe('startup SPV: the database lists match the domain registry (T-141)', () => {
  it('accreditation statuses and the investor view allow-list', () => {
    const accreditation = /"accreditation_status" IN \(([^)]*)\)/.exec(MIGRATION)?.[1] ?? '';
    expect([...accreditation.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]).sort()).toEqual([...ACCREDITATION_STATUSES].sort());
    const sections = /"content" - ARRAY\[([^\]]*)\]/.exec(MIGRATION)?.[1] ?? '';
    expect([...sections.matchAll(/'([A-Za-z]+)'/g)].map((match) => match[1]).sort()).toEqual([...INVESTOR_VIEW_SECTIONS].sort());
  });
});

/**
 * The investor wall in the data layer (T-141, ADR 0044): an investor reads their own seat and the
 * published views, never another investor's seat or membership, and none of the pact's evidence or
 * documents; the startup (a target contributor) never sees the investor list.
 */
describe('startup SPV: investor seats and the investor view under RLS', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let startup: TenantContext;
  const seats: Record<string, string> = {};
  const investors: Record<string, TenantContext> = {};
  const inTenant = <T>(context: TenantContext, fn: (tx: TransactionClient) => Promise<T>) => withTenant(db.prisma, context, fn);

  /** A guest investor: their own user, no organization membership, an INVESTOR membership naming their seat. */
  async function seat(reference: string): Promise<void> {
    const id = newId();
    seats[reference] = id;
    await db.owner.query(`INSERT INTO pact_investors (id, organization_id, deal_id, label, reference, commitment, currency, created_by) VALUES ($1, $2, $3, $4, $5, 500000, 'USD', $6)`, [id, a.organizationId, a.dealId, `${reference} Family Office (synthetic)`, reference, a.userId]);
    const userId = newId();
    await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name) VALUES ($1, $2, $3)`, [userId, `pactlab|${userId}`, `${reference} person (synthetic)`]);
    await db.owner.query(`INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role, investor_id) VALUES ($1, $2, $3, $4, 'INVESTOR', $5)`, [newId(), a.organizationId, a.dealId, userId, id]);
    investors[reference] = { organizationId: a.organizationId as OrganizationId, userId: userId as UserId, organizationRole: 'GUEST', dealIds: [a.dealId as DealId] };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Organizer');
    b = await createSyntheticTenant(db.owner, 'Other');
    startup = (await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR')).context;
    await seat('INV-01');
    await seat('INV-02');
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('the organizer sees every seat; an investor sees only their own; the startup and other tenants see none', async () => {
    expect(await inTenant(a.context, (tx) => tx.pactInvestor.count())).toBe(2);
    const own = await inTenant(investors['INV-01'] as TenantContext, (tx) => tx.pactInvestor.findMany({ select: { reference: true } }));
    expect(own).toEqual([{ reference: 'INV-01' }]);
    expect(await inTenant(startup, (tx) => tx.pactInvestor.count())).toBe(0);
    expect(await inTenant(b.context, (tx) => tx.pactInvestor.count())).toBe(0);
  });

  it('investors never see each other in the membership list, and the startup sees no investor', async () => {
    const seen = await inTenant(investors['INV-01'] as TenantContext, (tx) => tx.dealMembership.findMany({ where: { dealId: a.dealId }, select: { investorId: true, role: true } }));
    expect(seen.filter((row) => row.role === 'INVESTOR').map((row) => row.investorId)).toEqual([seats['INV-01']]);
    const startupSees = await inTenant(startup, (tx) => tx.dealMembership.findMany({ where: { dealId: a.dealId }, select: { role: true } }));
    expect(startupSees.some((row) => row.role === 'INVESTOR')).toBe(false);
    const organizerSees = await inTenant(a.context, (tx) => tx.dealMembership.count({ where: { dealId: a.dealId, role: 'INVESTOR' } }));
    expect(organizerSees).toBe(2);
  });

  it('an investor is never the own side: the vehicle, findings and claims are closed to them', async () => {
    await inTenant(a.context, (tx) => tx.spvVehicle.create({ data: { organizationId: a.organizationId, dealId: a.dealId, vehicleName: 'Lumen Seed SPV LLC (synthetic)', updatedBy: a.userId } }));
    expect(await inTenant(investors['INV-02'] as TenantContext, (tx) => tx.spvVehicle.count())).toBe(0);
    expect(await inTenant(startup, (tx) => tx.spvVehicle.count())).toBe(0);
    await expect(inTenant(investors['INV-02'] as TenantContext, (tx) => tx.spvVehicle.create({ data: { organizationId: a.organizationId, dealId: a.dealId, vehicleName: 'x', updatedBy: (investors['INV-02'] as TenantContext).userId } }))).rejects.toThrow();
    await expect(inTenant(investors['INV-02'] as TenantContext, (tx) => tx.pactInvestor.update({ where: { id: seats['INV-02'] as string }, data: { accreditationStatus: 'THIRD_PARTY_VERIFIED' } }))).rejects.toThrow();
  });

  // With rows present, the API acceptance test proves the same wall (apps/api startup-spv.acceptance).
  it('an investor reads none of the pact’s evidence or documents, even what is shared', async () => {
    expect(await inTenant(investors['INV-01'] as TenantContext, (tx) => tx.evidenceItem.count())).toBe(0);
    expect(await inTenant(investors['INV-01'] as TenantContext, (tx) => tx.document.count())).toBe(0);
    expect(await inTenant(investors['INV-01'] as TenantContext, (tx) => tx.sourceUpload.count())).toBe(0);
  });

  it('a published view is read by the pact’s investors, never by the startup, and is final', async () => {
    const id = newId();
    await inTenant(a.context, (tx) =>
      tx.investorViewVersion.create({ data: { id, organizationId: a.organizationId, dealId: a.dealId, version: 1, content: { meta: { vehicleName: 'x' }, claims: [] }, contentSha256: 'a'.repeat(64), publishedBy: a.userId } }),
    );
    expect(await inTenant(investors['INV-02'] as TenantContext, (tx) => tx.investorViewVersion.count())).toBe(1);
    expect(await inTenant(startup, (tx) => tx.investorViewVersion.count())).toBe(0);
    expect(await inTenant(b.context, (tx) => tx.investorViewVersion.count())).toBe(0);
    // The allow-list holds in the database: a section outside it is refused.
    await expect(
      inTenant(a.context, (tx) => tx.investorViewVersion.create({ data: { id: newId(), organizationId: a.organizationId, dealId: a.dealId, version: 2, content: { meta: {}, sideLetters: [] }, contentSha256: 'b'.repeat(64), publishedBy: a.userId } })),
    ).rejects.toThrow();
    await expect(inTenant(a.context, (tx) => tx.investorViewVersion.update({ where: { id }, data: { version: 3 } }))).rejects.toThrow();
    // Investors may not publish.
    const investor = investors['INV-01'] as TenantContext;
    await expect(
      inTenant(investor, (tx) => tx.investorViewVersion.create({ data: { id: newId(), organizationId: a.organizationId, dealId: a.dealId, version: 4, content: { meta: {} }, contentSha256: 'c'.repeat(64), publishedBy: investor.userId } })),
    ).rejects.toThrow();
  });

  it('a membership must name its seat exactly when it is an investor’s', async () => {
    const userId = newId();
    await db.owner.query(`INSERT INTO users (id, auth0_subject, display_name) VALUES ($1, $2, 'x')`, [userId, `pactlab|${userId}`]);
    await expect(db.owner.query(`INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role) VALUES ($1, $2, $3, $4, 'INVESTOR')`, [newId(), a.organizationId, a.dealId, userId])).rejects.toThrow();
    await expect(db.owner.query(`INSERT INTO deal_memberships (id, organization_id, deal_id, user_id, role, investor_id) VALUES ($1, $2, $3, $4, 'VIEWER', $5)`, [newId(), a.organizationId, a.dealId, userId, seats['INV-01']])).rejects.toThrow();
  });
});

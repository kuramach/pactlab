import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reportVersions } from './reports';
import { withTenant } from './tenant';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from './testing';

/** T-110: report versions are numbered per scope, final once READY, and isolated by tenant. */
describe('report versions (database)', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;

  const begin = (tenant: SyntheticTenant, scope: 'EXECUTIVE' | 'PACT') =>
    withTenant(db.prisma, tenant.context, (tx) =>
      reportVersions.begin(tx, { organizationId: tenant.organizationId, scope, dealId: scope === 'PACT' ? tenant.dealId : null, generatedBy: tenant.userId, dataAsOf: new Date() }),
    );

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
  }, 60_000);
  afterAll(async () => db?.stop());

  it('numbers versions per scope: executive and each pact separately', async () => {
    expect((await begin(a, 'EXECUTIVE')).version).toBe(1);
    expect((await begin(a, 'EXECUTIVE')).version).toBe(2);
    expect((await begin(a, 'PACT')).version).toBe(1);
    expect((await begin(b, 'EXECUTIVE')).version).toBe(1);
  });

  it('a READY version is final; only purging its pact may clear the file', async () => {
    const version = await begin(a, 'PACT');
    await withTenant(db.prisma, a.context, (tx) => reportVersions.ready(tx, version.id, { objectKey: `reports/${version.id}.pdf`, sha256: 'a'.repeat(64), byteSize: 1234, captured: { findings: 3 } }));
    await expect(withTenant(db.prisma, a.context, (tx) => reportVersions.ready(tx, version.id, { objectKey: 'reports/other.pdf', sha256: 'b'.repeat(64), byteSize: 99, captured: {} }))).rejects.toThrow(/final/);
    await expect(db.owner.query(`DELETE FROM report_versions WHERE id = $1`, [version.id])).rejects.toThrow(/never deleted/);
    const keys = await withTenant(db.prisma, a.context, (tx) => reportVersions.purgeForDeal(tx, a.dealId));
    expect(keys).toContain(`reports/${version.id}.pdf`);
    const purged = await withTenant(db.prisma, a.context, (tx) => reportVersions.get(tx, version.id));
    expect(purged).toMatchObject({ status: 'PURGED', objectKey: null, sha256: 'a'.repeat(64) });
  });

  it('another organization sees none of them', async () => {
    const history = await withTenant(db.prisma, b.context, (tx) => reportVersions.history(tx, {}));
    expect(history.every((row) => row.organizationId === b.organizationId)).toBe(true);
    const mine = await withTenant(db.prisma, a.context, (tx) => reportVersions.history(tx, {}));
    expect(await withTenant(db.prisma, b.context, (tx) => reportVersions.get(tx, mine[0]!.id))).toBeNull();
  });
});

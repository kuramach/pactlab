import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCsvEvidenceSource, newId } from '@pactlab/domain';
import { connections, syncRuns } from './evidence';
import { executeSyncRun } from './sync';
import { withTenant } from './tenant';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from './testing';
import { ACTIVE_EVIDENCE } from './withdrawal';

const CUSTOMERS = 'customer_id,name,mrr,as_of\nc-1,Acme (synthetic),100.00,2026-09-30\nc-2,Beta (synthetic),200.00,2026-09-30\n';

/** Evidence voids and run membership (T-154): recorded per run, visible only with their evidence. */
describe('withdrawn evidence under RLS', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let runId: string;
  let itemIds: string[];

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    const connection = await withTenant(db.prisma, a.context, (tx) =>
      connections.create(tx, {
        organizationId: a.organizationId,
        dealId: a.dealId,
        provider: 'csv',
        displayName: 'Billing export',
        mode: 'FIXTURE',
        credentialRef: null,
        config: {},
        evidenceVisibility: 'BUYER_ONLY',
        createdBy: a.userId,
      }),
    );
    const { run } = await withTenant(db.prisma, a.context, (tx) =>
      syncRuns.request(tx, { organizationId: a.organizationId, dealId: a.dealId, connectionId: connection.id, connectorVersion: 'csv-test-1', idempotencyKey: newId(), requestedBy: a.userId, correlationId: 'test' }),
    );
    runId = run.id;
    const source = createCsvEvidenceSource({
      provider: 'csv',
      version: 'csv-test-1',
      datasets: [{ dataset: 'customers.csv', evidenceType: 'billing.customer', recordIdColumn: 'customer_id', observedAtColumn: 'as_of' }],
      load: async () => CUSTOMERS,
    });
    await executeSyncRun(db.prisma, { organizationId: a.organizationId, dealId: a.dealId, requestedBy: a.userId, syncRunId: run.id }, source);
    itemIds = (await withTenant(db.prisma, a.context, (tx) => tx.syncRunEvidence.findMany({ where: { syncRunId: run.id }, select: { evidenceItemId: true }, take: 10 }))).map((row) => row.evidenceItemId);
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('a sync run records every item it read', () => {
    expect(itemIds).toHaveLength(2);
  });

  it('a void hides the item from active reads, for its own tenant only; counterparties and other tenants see no void', async () => {
    const uploadId = newId();
    await db.owner.query(
      `INSERT INTO source_uploads (id, organization_id, deal_id, connection_id, target, system, file_name, sha256, size_bytes, row_count, header, mapping, mapping_version, status, sync_run_id, visibility, uploaded_by, imported_at, withdrawn_at, withdrawn_by, withdrawal_reason)
       SELECT $1, organization_id, deal_id, connection_id, 'BILLING_INVOICE_LINE', 'pactlab_standard', 'x.csv', repeat('a', 64), 1, 2, '[]', '{}', 'm', 'WITHDRAWN', id, 'BUYER_ONLY', $2, now(), now(), $2, 'Wrong file'
         FROM sync_runs WHERE id = $3`,
      [uploadId, a.userId, runId],
    );
    await withTenant(db.prisma, a.context, (tx) =>
      tx.evidenceVoid.create({ data: { id: newId(), organizationId: a.organizationId, dealId: a.dealId, evidenceItemId: itemIds[0]!, sourceUploadId: uploadId, voidedBy: a.userId } }),
    );
    const active = await withTenant(db.prisma, a.context, (tx) => tx.evidenceItem.count({ where: { dealId: a.dealId, ...ACTIVE_EVIDENCE } }));
    expect(active).toBe(1);
    expect(await withTenant(db.prisma, a.context, (tx) => tx.evidenceVoid.count())).toBe(1);

    const contributor = await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR');
    expect(await withTenant(db.prisma, contributor.context, (tx) => tx.evidenceVoid.count())).toBe(0);
    expect(await withTenant(db.prisma, contributor.context, (tx) => tx.syncRunEvidence.count())).toBe(0);
    expect(await withTenant(db.prisma, b.context, (tx) => tx.evidenceVoid.count())).toBe(0);
    expect(await withTenant(db.prisma, b.context, (tx) => tx.syncRunEvidence.count())).toBe(0);
    // Another tenant cannot void this tenant's evidence.
    await expect(
      withTenant(db.prisma, b.context, (tx) =>
        tx.evidenceVoid.create({ data: { id: newId(), organizationId: a.organizationId, dealId: a.dealId, evidenceItemId: itemIds[1]!, sourceUploadId: uploadId, voidedBy: b.userId } }),
      ),
    ).rejects.toThrow();
  });

  it('a void is never deleted: the runtime role has no DELETE', async () => {
    await expect(withTenant(db.prisma, a.context, (tx) => tx.evidenceVoid.deleteMany({}))).rejects.toThrow();
  });
});

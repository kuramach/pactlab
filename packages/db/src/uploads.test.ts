import { newId, type TenantContext } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TransactionClient } from './client';
import { withTenant } from './tenant';
import {
  addSyntheticDealMember,
  createSyntheticTenant,
  startTestDatabase,
  type SyntheticTenant,
  type TestDatabase,
} from './testing';
import { BILLING_UPLOAD_PROVIDER, sourceUploads } from './uploads';

describe('source uploads persistence and RLS', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let contributor: TenantContext;

  const inTenant = <T>(context: TenantContext, fn: (tx: TransactionClient) => Promise<T>) =>
    withTenant(db.prisma, context, fn);

  const upload = (context: TenantContext, visibility: 'SHARED' | 'BUYER_ONLY', tenant: SyntheticTenant = a) => {
    const id = newId();
    return inTenant(context, (tx) =>
      sourceUploads.create(tx, {
        id,
        organizationId: tenant.organizationId,
        dealId: tenant.dealId,
        target: 'BILLING_INVOICE_LINE',
        system: 'sap_s4hana',
        fileName: 'billing.csv',
        sha256: 'a'.repeat(64),
        sizeBytes: 100,
        rowCount: 2,
        header: ['Billing Document', 'Net Value'],
        objectKey: `${tenant.organizationId}/${tenant.dealId}/uploads/${id}/original`,
        visibility,
        uploadedBy: context.userId,
      }),
    );
  };

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    contributor = (await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR')).context;
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('keeps buyer-only uploads from target contributors and lets them upload shared ones', async () => {
    const buyerOnly = await upload(a.context, 'BUYER_ONLY');
    const shared = await upload(contributor, 'SHARED');
    await expect(upload(contributor, 'BUYER_ONLY')).rejects.toThrow();
    const seen = await inTenant(contributor, (tx) => sourceUploads.list(tx, a.dealId));
    expect(seen.map((row) => row.id)).toEqual([shared.id]);
    const all = await inTenant(a.context, (tx) => sourceUploads.list(tx, a.dealId));
    expect(all.map((row) => row.id).sort()).toEqual([buyerOnly.id, shared.id].sort());
  });

  it('hides uploads from other tenants and refuses cross-tenant inserts', async () => {
    await upload(a.context, 'BUYER_ONLY');
    expect(await inTenant(b.context, (tx) => sourceUploads.list(tx, a.dealId))).toEqual([]);
    await expect(upload(b.context, 'BUYER_ONLY', a)).rejects.toThrow();
  });

  it('records an import with its connection and sync run, reusing one connection per system and visibility', async () => {
    const created = await upload(a.context, 'BUYER_ONLY');
    await inTenant(a.context, async (tx) => {
      const scope = { organizationId: a.organizationId, dealId: a.dealId, system: 'sap_s4hana', systemLabel: 'SAP S/4HANA', createdBy: a.userId };
      const connection = await sourceUploads.connectionFor(tx, { ...scope, visibility: 'BUYER_ONLY' });
      expect(await sourceUploads.connectionFor(tx, { ...scope, visibility: 'BUYER_ONLY' })).toMatchObject({ id: connection.id });
      expect((await sourceUploads.connectionFor(tx, { ...scope, visibility: 'SHARED' })).id).not.toBe(connection.id);
      expect(connection).toMatchObject({ provider: BILLING_UPLOAD_PROVIDER, mode: 'LIVE', displayName: 'SAP S/4HANA billing export' });
      const run = await tx.syncRun.create({
        data: {
          organizationId: a.organizationId,
          dealId: a.dealId,
          connectionId: connection.id,
          connectorVersion: 'test',
          idempotencyKey: newId(),
          requestedBy: a.userId,
          correlationId: 'test',
        },
      });
      await sourceUploads.markImported(tx, created.id, {
        connectionId: connection.id,
        syncRunId: run.id,
        mapping: { target: 'BILLING_INVOICE_LINE' },
        mappingVersion: 'billing-mapping-1',
      });
    });
    expect(await inTenant(a.context, (tx) => sourceUploads.get(tx, a.dealId, created.id))).toMatchObject({ status: 'IMPORTED' });
  });

  it('enforces import and purge consistency, tenant-prefixed keys and no DELETE', async () => {
    const created = await upload(a.context, 'BUYER_ONLY');
    for (const sql of [
      `UPDATE source_uploads SET status = 'IMPORTED' WHERE id = '${created.id}'`,
      `UPDATE source_uploads SET status = 'PURGED' WHERE id = '${created.id}'`,
      `UPDATE source_uploads SET object_key = 'elsewhere/x' WHERE id = '${created.id}'`,
    ]) {
      await expect(inTenant(a.context, (tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow(/check constraint/);
    }
    await expect(inTenant(a.context, (tx) => tx.$executeRawUnsafe(`UPDATE source_uploads SET file_name = 'x'`))).rejects.toThrow(
      /permission denied/,
    );
    await expect(inTenant(a.context, (tx) => tx.$executeRawUnsafe(`DELETE FROM source_uploads`))).rejects.toThrow(/permission denied/);
  });
});

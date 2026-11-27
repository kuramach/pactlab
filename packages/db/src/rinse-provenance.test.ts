import { newId, type TenantContext } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TransactionClient } from './client';
import { withTenant } from './tenant';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from './testing';

/**
 * Rinse provenance under RLS (T-178d): a set and its document provenance are visible exactly as the
 * documents are. A seller sees shared sets and the provenance of shared documents, never the deal
 * team's buyer-only ones; another tenant sees nothing; nobody writes as someone else.
 */
describe('rinse sets and document provenance under RLS', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let seller: TenantContext;
  const inTenant = <T>(context: TenantContext, fn: (tx: TransactionClient) => Promise<T>) => withTenant(db.prisma, context, fn);

  const setData = (context: TenantContext, visibility: 'SHARED' | 'BUYER_ONLY', sha: string) => ({
    id: newId(),
    organizationId: a.organizationId,
    dealId: a.dealId,
    manifestSetId: newId(),
    manifestSha256: sha.repeat(64),
    name: 'Harbour Lane — diligence set (synthetic)',
    pack: 'MULTIFAMILY',
    preparedBy: { userId: newId(), name: 'Dana Whitlow', organization: 'Harbour Lane (synthetic)' },
    readyAt: new Date(),
    generatorVersion: '0.1.0',
    origin: 'ARCHIVE',
    visibility,
    documents: 1,
    gaps: [],
    sourceDiscrepancies: [],
    createdBy: context.userId,
  });
  const documentData = (context: TenantContext, visibility: 'SHARED' | 'BUYER_ONLY') => {
    const id = newId();
    return {
      id,
      organizationId: a.organizationId,
      dealId: a.dealId,
      fileName: 'Income statement.md',
      contentType: 'text/markdown',
      sizeBytes: 10,
      sha256: id.replace(/-/g, '').padEnd(64, '0'),
      objectKey: `${a.organizationId}/${a.dealId}/documents/${id}/original`,
      pageCount: 1,
      dataClass: 'BUSINESS' as const,
      aiExcluded: false,
      retentionClass: 'DEAL_TERM' as const,
      visibility,
      malwareScanner: 'signature-local-1',
      uploadedBy: context.userId,
      createdAt: new Date(),
    };
  };
  const provenanceData = (context: TenantContext, documentId: string, rinseSetId: string) => ({
    id: newId(),
    organizationId: a.organizationId,
    dealId: a.dealId,
    documentId,
    rinseSetId,
    manifestDocumentId: newId(),
    role: 'CONVERTED',
    canonicalPath: 'rinsed/Financials/Income statement.md',
    canonicalSha256: 'a'.repeat(64),
    originalPath: 'Financials/Income statement.md',
    originalSha256: 'b'.repeat(64),
    entry: { route: 'CONVERT' },
    createdBy: context.userId,
  });

  let sharedDocument = '';
  let buyerDocument = '';

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Rinse');
    b = await createSyntheticTenant(db.owner, 'Other');
    seller = (await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR')).context;
    // The seller's import is shared; the deal team's own is buyer-only.
    const shared = documentData(seller, 'SHARED');
    const sellerSet = setData(seller, 'SHARED', 'a');
    await inTenant(seller, async (tx) => {
      await tx.document.create({ data: shared });
      await tx.rinseSet.create({ data: sellerSet });
      await tx.documentProvenance.create({ data: provenanceData(seller, shared.id, sellerSet.id) });
    });
    const own = documentData(a.context, 'BUYER_ONLY');
    const buyerSet = setData(a.context, 'BUYER_ONLY', 'b');
    await inTenant(a.context, async (tx) => {
      await tx.document.create({ data: own });
      await tx.rinseSet.create({ data: buyerSet });
      await tx.documentProvenance.create({ data: provenanceData(a.context, own.id, buyerSet.id) });
      // The deal team may also record provenance for the seller's shared document from its own set.
      await tx.documentProvenance.create({ data: provenanceData(a.context, shared.id, buyerSet.id) });
    });
    sharedDocument = shared.id;
    buyerDocument = own.id;
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('the deal team sees every set and every provenance record', async () => {
    expect(await inTenant(a.context, (tx) => tx.rinseSet.count())).toBe(2);
    expect(await inTenant(a.context, (tx) => tx.documentProvenance.count())).toBe(3);
  });

  it('the seller sees the shared set, and only the provenance of documents shared with them', async () => {
    expect(await inTenant(seller, (tx) => tx.rinseSet.findMany({ select: { visibility: true } }))).toEqual([{ visibility: 'SHARED' }]);
    const rows = await inTenant(seller, (tx) => tx.documentProvenance.findMany({ select: { documentId: true } }));
    expect(rows.every((row) => row.documentId === sharedDocument)).toBe(true);
    expect(rows.some((row) => row.documentId === buyerDocument)).toBe(false);
  });

  it('another tenant sees nothing and cannot write into the pact', async () => {
    expect(await inTenant(b.context, (tx) => tx.rinseSet.count())).toBe(0);
    expect(await inTenant(b.context, (tx) => tx.documentProvenance.count())).toBe(0);
    await expect(inTenant(b.context, (tx) => tx.rinseSet.create({ data: { ...setData(b.context, 'SHARED', 'c') } }))).rejects.toThrow();
  });

  it('nobody records a set as someone else, a seller never records a buyer-only set, and rows are never changed', async () => {
    await expect(inTenant(seller, (tx) => tx.rinseSet.create({ data: { ...setData(seller, 'SHARED', 'd'), createdBy: a.userId } }))).rejects.toThrow();
    await expect(inTenant(seller, (tx) => tx.rinseSet.create({ data: setData(seller, 'BUYER_ONLY', 'e') }))).rejects.toThrow();
    // A seller cannot attach provenance to a document they cannot see.
    const sellerSet = await inTenant(seller, (tx) => tx.rinseSet.findFirst({ select: { id: true } }));
    await expect(inTenant(seller, (tx) => tx.documentProvenance.create({ data: provenanceData(seller, buyerDocument, sellerSet?.id ?? '') }))).rejects.toThrow();
    await expect(inTenant(a.context, (tx) => tx.rinseSet.updateMany({ data: { name: 'renamed' } }))).rejects.toThrow();
  });
});

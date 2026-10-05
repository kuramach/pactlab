import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, type TenantContext } from '@pactlab/domain';
import type { TransactionClient } from './client';
import { withTenant } from './tenant';
import {
  addSyntheticDealMember,
  createSyntheticTenant,
  startTestDatabase,
  type SyntheticTenant,
  type TestDatabase,
} from './testing';

const HASH = 'c'.repeat(64);

describe('documents persistence and RLS', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let contributor: TenantContext;
  let reviewer: TenantContext;

  const inTenant = <T>(context: TenantContext, fn: (tx: TransactionClient) => Promise<T>) =>
    withTenant(db.prisma, context, fn);

  function documentData(
    tenant: SyntheticTenant,
    uploadedBy: string,
    overrides: Partial<{ visibility: 'SHARED' | 'BUYER_ONLY'; dataClass: 'BUSINESS' | 'HR'; aiExcluded: boolean }> = {},
  ) {
    const id = newId();
    return {
      id,
      organizationId: tenant.organizationId,
      dealId: tenant.dealId,
      fileName: 'msa.txt',
      contentType: 'text/plain',
      sizeBytes: 10,
      sha256: HASH,
      objectKey: `${tenant.organizationId}/${tenant.dealId}/documents/${id}/original`,
      pageCount: 1,
      dataClass: overrides.dataClass ?? ('BUSINESS' as const),
      aiExcluded: overrides.aiExcluded ?? false,
      retentionClass: 'DEAL_TERM' as const,
      visibility: overrides.visibility ?? ('BUYER_ONLY' as const),
      malwareScanner: 'signature-local-1',
      uploadedBy,
      createdAt: new Date(),
    };
  }

  async function documentWithPage(
    context: TenantContext,
    tenant: SyntheticTenant,
    visibility: 'SHARED' | 'BUYER_ONLY',
  ) {
    const data = documentData(tenant, context.userId, { visibility });
    await inTenant(context, async (tx) => {
      await tx.document.create({ data });
      await tx.documentPage.create({
        data: {
          organizationId: tenant.organizationId,
          dealId: tenant.dealId,
          documentId: data.id,
          pageNumber: 1,
          text: 'Synthetic page',
          checksum: HASH,
        },
      });
    });
    return data.id;
  }

  async function draftFinding(documentId: string) {
    const aiRunId = newId();
    const findingId = newId();
    const scope = { organizationId: a.organizationId, dealId: a.dealId };
    await inTenant(a.context, async (tx) => {
      await tx.aiRun.create({
        data: {
          ...scope,
          id: aiRunId,
          taskType: 'document.contract_extraction',
          promptId: 'contract-extract',
          promptVersion: '1',
          promptHash: HASH,
          modelAlias: 'balanced',
          resolvedModelId: 'fixture',
          inputHashes: [HASH],
          outputHash: HASH,
          status: 'SUCCEEDED',
          repairAttempted: false,
          injectionSignals: 0,
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
          createdAt: new Date(),
        },
      });
      await tx.documentFinding.create({
        data: {
          ...scope,
          id: findingId,
          documentId,
          aiRunId,
          origin: 'AI_CONTRACT_EXTRACTION',
          kind: 'CLAUSE',
          subtype: 'CHANGE_OF_CONTROL',
          domain: 'LEGAL',
          title: 'Change of control',
          summary: 'Synthetic',
          severity: 'HIGH',
          fingerprint: newId(),
          citations: [{ citationId: 'p1', documentId, pageNumber: 1, quote: 'Synthetic page', quoteHash: HASH, charStart: 0, charEnd: 14 }],
          promptId: 'contract-extract',
          promptVersion: '1',
          promptHash: HASH,
          resolvedModelId: 'fixture',
          createdBy: a.userId,
          version: 1,
          createdAt: new Date(),
        },
      });
    });
    return findingId;
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    contributor = (await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR')).context;
    reviewer = (await addSyntheticDealMember(db.owner, a, 'REVIEWER')).context;
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('shows target contributors shared documents and pages only', async () => {
    const buyerOnly = await documentWithPage(a.context, a, 'BUYER_ONLY');
    const shared = await documentWithPage(contributor, a, 'SHARED');
    const seen = await inTenant(contributor, async (tx) => ({
      documents: (await tx.document.findMany()).map((d) => d.id),
      pages: (await tx.documentPage.findMany()).map((p) => p.documentId),
    }));
    expect(seen.documents).toEqual([shared]);
    expect(seen.pages).toEqual([shared]);
    expect(seen.documents).not.toContain(buyerOnly);
    // A contributor cannot upload a buyer-only document.
    await expect(
      inTenant(contributor, (tx) => tx.document.create({ data: documentData(a, contributor.userId) })),
    ).rejects.toThrow(/row-level security/);
  });

  it('isolates tenants', async () => {
    await documentWithPage(a.context, a, 'SHARED');
    expect(await inTenant(b.context, (tx) => tx.document.count())).toBe(0);
    expect(await inTenant(b.context, (tx) => tx.documentPage.count())).toBe(0);
    await expect(
      inTenant(b.context, (tx) => tx.document.create({ data: documentData(a, b.userId) })),
    ).rejects.toThrow(/row-level security/);
  });

  it('keeps AI runs and document findings away from target contributors', async () => {
    const documentId = await documentWithPage(contributor, a, 'SHARED');
    await draftFinding(documentId);
    expect(await inTenant(contributor, (tx) => tx.aiRun.count())).toBe(0);
    expect(await inTenant(contributor, (tx) => tx.documentFinding.count())).toBe(0);
    expect(await inTenant(a.context, (tx) => tx.documentFinding.count())).toBeGreaterThan(0);
  });

  it('records decisions only in the caller’s own name', async () => {
    const documentId = await documentWithPage(a.context, a, 'BUYER_ONLY');
    const findingId = await draftFinding(documentId);
    const decide = (context: TenantContext, reviewerUserId: string) =>
      inTenant(context, async (tx) => {
        await tx.documentFinding.updateMany({
          where: { id: findingId, version: 1 },
          data: { status: 'ACCEPTED', reviewerUserId, reviewerDisplayName: 'Reviewer', decidedAt: new Date(), version: 2 },
        });
        await tx.documentFindingReview.create({
          data: {
            organizationId: a.organizationId,
            dealId: a.dealId,
            findingId,
            decision: 'ACCEPT',
            reviewerUserId,
            reviewerDisplayName: 'Reviewer',
            rationale: 'Quote verified on page 1',
            decidedAt: new Date(),
          },
        });
      });
    await expect(decide(reviewer, a.userId)).rejects.toThrow(/row-level security/);
    await decide(reviewer, reviewer.userId);
  });

  it('enforces data-class, purge and decision invariants in the database', async () => {
    await expect(
      inTenant(a.context, (tx) => tx.document.create({ data: documentData(a, a.userId, { dataClass: 'HR', aiExcluded: false }) })),
    ).rejects.toThrow();
    const id = await documentWithPage(a.context, a, 'BUYER_ONLY');
    await expect(
      inTenant(a.context, (tx) => tx.document.updateMany({ where: { id }, data: { status: 'PURGED' } })),
    ).rejects.toThrow();
    const documentId = await documentWithPage(a.context, a, 'BUYER_ONLY');
    const findingId = await draftFinding(documentId);
    // Leaving DRAFT requires a named reviewer.
    await expect(
      inTenant(a.context, (tx) => tx.documentFinding.updateMany({ where: { id: findingId }, data: { status: 'ACCEPTED' } })),
    ).rejects.toThrow();
  });

  it('grants no DELETE and keeps runs, reviews and document metadata immutable', async () => {
    const statements = [
      `DELETE FROM documents`,
      `DELETE FROM document_pages`,
      `DELETE FROM ai_runs`,
      `DELETE FROM document_findings`,
      `DELETE FROM document_finding_reviews`,
      `UPDATE documents SET object_key = 'x'`,
      `UPDATE documents SET visibility = 'SHARED'`,
      `UPDATE document_pages SET checksum = 'x'`,
      `UPDATE ai_runs SET status = 'SUCCEEDED'`,
      `UPDATE document_findings SET citations = '[]'`,
      `UPDATE document_finding_reviews SET rationale = 'x'`,
    ];
    for (const sql of statements) {
      await expect(inTenant(a.context, (tx) => tx.$executeRawUnsafe(sql))).rejects.toThrow(/permission denied/);
    }
  });
});

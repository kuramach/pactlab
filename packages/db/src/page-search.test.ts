import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, type TenantContext } from '@pactlab/domain';
import type { TransactionClient } from './client';
import { keywordPhrases, keywordQuery, pageSizes, rankPages } from './page-search';
import { withTenant } from './tenant';
import {
  addSyntheticDealMember,
  createSyntheticTenant,
  startTestDatabase,
  type SyntheticTenant,
  type TestDatabase,
} from './testing';

const HASH = 'd'.repeat(64);
const CLAUSE = 'Customer may terminate this Agreement upon a Change of Control of Vendor.';

/** Keyword retrieval runs under RLS and never indexes excluded pages (T-139). */
describe('page search', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let contributor: TenantContext;

  const inTenant = <T>(context: TenantContext, fn: (tx: TransactionClient) => Promise<T>) => withTenant(db.prisma, context, fn);

  async function document(
    tenant: SyntheticTenant,
    pages: readonly string[],
    options: { visibility?: 'SHARED' | 'BUYER_ONLY'; dataClass?: 'BUSINESS' | 'HR'; aiExcluded?: boolean } = {},
  ) {
    const id = newId();
    await inTenant(tenant.context, async (tx) => {
      await tx.document.create({
        data: {
          id,
          organizationId: tenant.organizationId,
          dealId: tenant.dealId,
          fileName: `${id}.txt`,
          contentType: 'text/plain',
          sizeBytes: 10,
          sha256: HASH,
          objectKey: `${tenant.organizationId}/${tenant.dealId}/documents/${id}/original`,
          pageCount: pages.length,
          dataClass: options.dataClass ?? 'BUSINESS',
          aiExcluded: options.aiExcluded ?? false,
          retentionClass: 'DEAL_TERM',
          visibility: options.visibility ?? 'BUYER_ONLY',
          malwareScanner: 'signature-local-1',
          uploadedBy: tenant.userId,
          createdAt: new Date(),
        },
      });
      await tx.documentPage.createMany({
        data: pages.map((text, index) => ({ organizationId: tenant.organizationId, dealId: tenant.dealId, documentId: id, pageNumber: index + 1, text, checksum: HASH })),
      });
    });
    return id;
  }

  const indexed = async (documentId: string) =>
    ((await db.owner.query(`SELECT count(*)::int AS n FROM document_pages WHERE document_id = $1 AND search_vector IS NOT NULL`, [documentId])) as { rows: { n: number }[] }).rows[0]?.n;

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Alpha');
    b = await createSyntheticTenant(db.owner, 'Bravo');
    contributor = (await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR')).context;
  }, 60_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('asks for any of the question’s words', () => {
    expect(keywordQuery('Can they walk away if we buy them?')).toBe('can or they or walk or away or if or we or buy or them');
    expect(keywordQuery('Section 9 OR assignment')).toBe('section or 9 or assignment');
    expect(keywordQuery('?!')).toBe('');
    expect(keywordPhrases('a change of control')).toEqual(['"a change"', '"change of"', '"of control"', '"a change of"', '"change of control"']);
  });

  it('a phrase match outranks a page that only repeats the words', async () => {
    const id = await document(a, ['The control room may change its rota. Change requests are controlled; control of change is reviewed.', CLAUSE]);
    const ranked = await inTenant(a.context, (tx) => rankPages(tx, { dealId: a.dealId, documentIds: [id], question: 'change of control' }));
    expect(ranked.map((hit) => hit.pageNumber)).toEqual([2, 1]);
  });

  it('ranks the matching page first, deterministically, and reports sizes without text', async () => {
    const id = await document(a, ['Fees are payable monthly.', CLAUSE, 'Notices go to the registered office.']);
    const ranked = await inTenant(a.context, (tx) => rankPages(tx, { dealId: a.dealId, documentIds: [id], question: 'change of control termination' }));
    expect(ranked.map((hit) => hit.pageNumber)).toEqual([2]);
    const again = await inTenant(a.context, (tx) => rankPages(tx, { dealId: a.dealId, documentIds: [id], question: 'change of control termination' }));
    expect(again).toEqual(ranked);
    const sizes = await inTenant(a.context, (tx) => pageSizes(tx, { dealId: a.dealId, documentIds: [id] }));
    expect(sizes.map((size) => [size.pageNumber, size.chars])).toEqual([[1, 25], [2, CLAUSE.length], [3, 36]]);
  });

  it("never ranks another tenant's pages, even given their ids", async () => {
    const id = await document(a, [CLAUSE]);
    const foreign = await inTenant(b.context, (tx) => rankPages(tx, { dealId: a.dealId, documentIds: [id], question: 'change of control' }));
    expect(foreign).toEqual([]);
    const own = await inTenant(b.context, (tx) => rankPages(tx, { dealId: b.dealId, documentIds: [id], question: 'change of control' }));
    expect(own).toEqual([]);
    expect(await inTenant(b.context, (tx) => pageSizes(tx, { dealId: a.dealId, documentIds: [id] }))).toEqual([]);
  });

  it('a counterparty ranks only what is shared with them', async () => {
    const buyerOnly = await document(a, [CLAUSE]);
    const shared = await document(a, [CLAUSE], { visibility: 'SHARED' });
    const ranked = await inTenant(contributor, (tx) => rankPages(tx, { dealId: a.dealId, documentIds: [buyerOnly, shared], question: 'change of control' }));
    expect(ranked.map((hit) => hit.documentId)).toEqual([shared]);
  });

  it('never indexes people data or AI-excluded documents', async () => {
    const hr = await document(a, ['Salary bands and the change of control retention bonus.'], { dataClass: 'HR', aiExcluded: true });
    const excluded = await document(a, [CLAUSE], { aiExcluded: true });
    expect(await indexed(hr)).toBe(0);
    expect(await indexed(excluded)).toBe(0);
    const ranked = await inTenant(a.context, (tx) => rankPages(tx, { dealId: a.dealId, documentIds: [hr, excluded], question: 'change of control retention bonus' }));
    expect(ranked).toEqual([]);
  });

  it('drops a document from the index when it is excluded later or purged', async () => {
    const later = await document(a, [CLAUSE, CLAUSE]);
    const purged = await document(a, [CLAUSE]);
    expect(await indexed(later)).toBe(2);
    await inTenant(a.context, (tx) => tx.document.update({ where: { id: later }, data: { aiExcluded: true } }));
    expect(await indexed(later)).toBe(0);
    await inTenant(a.context, async (tx) => {
      await tx.document.update({ where: { id: purged }, data: { status: 'PURGED', purgedAt: new Date() } });
      await tx.documentPage.updateMany({ where: { documentId: purged }, data: { text: null } });
    });
    expect(await indexed(purged)).toBe(0);
  });
});

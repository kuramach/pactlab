import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { newId } from '@pactlab/domain';
import { createPrismaClient, type PrismaClient, type TransactionClient } from './client';
import { withTenant } from './tenant';
import { addSyntheticDealMember, createSyntheticTenant, type SyntheticTenant } from './testing/tenants';

/**
 * Buyer personas (T-105): evaluations, adoptions and briefs are buyer-side only;
 * term proposals reach the seller's contributors once proposed, never as drafts;
 * a proposed batch is frozen. Requires migrations applied (`pnpm db:migrate`).
 */
const runtimeUrl = process.env['DATABASE_URL'];
const ownerUrl = process.env['DATABASE_MIGRATION_URL'];

describe.runIf(runtimeUrl && ownerUrl)('buyer personas against PostgreSQL', () => {
  let prisma: PrismaClient;
  let owner: pg.Client;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let seller: Awaited<ReturnType<typeof addSyntheticDealMember>>;

  const evaluation = (tenant: SyntheticTenant) => ({
    organizationId: tenant.organizationId,
    dealId: tenant.dealId,
    persona: 'GRAVE_DANCER',
    personaVersion: 'personas-1',
    runIds: [newId()],
    cases: [],
    currency: 'USD',
    weightedPrice: '1000000.00',
    termMix: {},
    createdBy: tenant.userId,
  });

  const draftBatch = async (tx: TransactionClient, evaluationId: string, version: number) => {
    const batch = await tx.termProposalBatch.create({
      data: { organizationId: a.organizationId, dealId: a.dealId, evaluationId, version, currency: 'USD', createdBy: a.userId },
    });
    const term = await tx.termProposal.create({
      data: { organizationId: a.organizationId, dealId: a.dealId, batchId: batch.id, ordinal: 0, lever: 'ESCROW', amount: '250000.00', currency: 'USD', sellerNote: 'Held for 18 months' },
    });
    return { ...batch, terms: [term] };
  };

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl, options: '-c TimeZone=UTC' });
    await owner.connect();
    a = await createSyntheticTenant(owner, `Persona${Date.now()}`);
    b = await createSyntheticTenant(owner, `Other${Date.now()}`);
    seller = await addSyntheticDealMember(owner, a, 'TARGET_CONTRIBUTOR');
    prisma = createPrismaClient({ connectionString: runtimeUrl ?? '' });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await owner?.end();
  });

  it('keeps evaluations buyer-side and inside the tenant, and insert-only', async () => {
    const created = await withTenant(prisma, a.context, (tx) => tx.pricingEvaluation.create({ data: evaluation(a) }));
    await expect(withTenant(prisma, b.context, (tx) => tx.pricingEvaluation.findUnique({ where: { id: created.id } }))).resolves.toBeNull();
    await expect(withTenant(prisma, seller.context, (tx) => tx.pricingEvaluation.count())).resolves.toBe(0);
    await expect(withTenant(prisma, b.context, (tx) => tx.pricingEvaluation.create({ data: evaluation(a) }))).rejects.toThrow(/row-level security/);
    await expect(withTenant(prisma, seller.context, (tx) => tx.pricingEvaluation.create({ data: { ...evaluation(a), createdBy: seller.userId } }))).rejects.toThrow(/row-level security/);
    await expect(withTenant(prisma, a.context, (tx) => tx.pricingEvaluation.update({ where: { id: created.id }, data: { persona: 'VALUE_INVESTOR' } }))).rejects.toThrow(/permission denied/);
    await expect(withTenant(prisma, a.context, (tx) => tx.pricingEvaluation.deleteMany())).rejects.toThrow(/permission denied/);
  });

  it('shows the seller a proposed batch, never a draft, and freezes it once proposed', async () => {
    const { id: evaluationId } = await withTenant(prisma, a.context, (tx) => tx.pricingEvaluation.create({ data: evaluation(a) }));
    const draft = await withTenant(prisma, a.context, (tx) => draftBatch(tx, evaluationId, 1));
    await expect(withTenant(prisma, seller.context, (tx) => tx.termProposalBatch.count())).resolves.toBe(0);
    await expect(withTenant(prisma, seller.context, (tx) => tx.termProposal.count())).resolves.toBe(0);

    // A draft's seller note can change; nothing else about a term can.
    await withTenant(prisma, a.context, (tx) => tx.termProposal.update({ where: { id: draft.terms[0]!.id }, data: { sellerNote: 'Held for 12 months' } }));
    await expect(withTenant(prisma, a.context, (tx) => tx.termProposal.update({ where: { id: draft.terms[0]!.id }, data: { amount: '1.00' } }))).rejects.toThrow();

    await withTenant(prisma, a.context, (tx) => tx.termProposalBatch.update({ where: { id: draft.id }, data: { proposedAt: new Date(), proposedBy: a.userId } }));
    const seen = await withTenant(prisma, seller.context, (tx) => tx.termProposalBatch.findMany({ include: { terms: true } }));
    expect(seen.map((batch) => batch.id)).toEqual([draft.id]);
    expect(seen[0]?.terms.map((term) => term.sellerNote)).toEqual(['Held for 12 months']);
    expect(Object.keys(seen[0] ?? {})).not.toContain('persona');

    await expect(withTenant(prisma, a.context, (tx) => tx.termProposalBatch.update({ where: { id: draft.id }, data: { proposedAt: new Date() } }))).rejects.toThrow(/already proposed/);
    await expect(withTenant(prisma, a.context, (tx) => tx.termProposal.update({ where: { id: draft.terms[0]!.id }, data: { sellerNote: 'changed' } }))).rejects.toThrow(/frozen/);
    // The seller cannot propose, draft or edit.
    await expect(withTenant(prisma, seller.context, (tx) => draftBatch(tx, evaluationId, 2))).rejects.toThrow();
    await expect(withTenant(prisma, b.context, (tx) => tx.termProposalBatch.count())).resolves.toBe(0);
  });

  it('lets only an organization admin change the default persona', async () => {
    await withTenant(prisma, a.context, (tx) => tx.organization.update({ where: { id: a.organizationId }, data: { defaultPersona: 'QUALITY_COMPOUNDER' } }));
    const { rows } = (await owner.query('SELECT default_persona FROM organizations WHERE id = $1', [a.organizationId])) as { rows: { default_persona: string }[] };
    expect(rows[0]?.default_persona).toBe('QUALITY_COMPOUNDER');
    // A member (here the seller's contributor) updates no row.
    await expect(withTenant(prisma, seller.context, (tx) => tx.organization.updateMany({ where: { id: a.organizationId }, data: { defaultPersona: 'GRAVE_DANCER' } }))).resolves.toEqual({ count: 0 });
    await expect(withTenant(prisma, a.context, (tx) => tx.organization.update({ where: { id: a.organizationId }, data: { name: 'Renamed' } }))).rejects.toThrow(/permission denied/);
  });
});

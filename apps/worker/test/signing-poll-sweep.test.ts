import { FixtureSigningProvider } from '@pactlab/connectors';
import { signingOutcomes, withTenant } from '@pactlab/db';
import { createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import { newId } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processSigningPollSweep } from '../src/jobs/signing-poll-sweep';

describe('signing.poll-sweep', () => {
  let db: TestDatabase;
  let tenant: SyntheticTenant;
  let batchId: string;
  const fixture = new FixtureSigningProvider();

  beforeAll(async () => {
    db = await startTestDatabase();
    tenant = await createSyntheticTenant(db.owner, 'sweep');
    batchId = newId();
    await db.owner.query(`INSERT INTO term_proposal_batches (id, organization_id, deal_id, version, currency, initiated_by_side, created_by) VALUES ($1, $2, $3, 1, 'USD', 'SELLER', $4)`, [batchId, tenant.organizationId, tenant.dealId, tenant.userId]);
  }, 60_000);
  afterAll(async () => db?.stop());

  /** An open envelope on the fixture provider, as the API leaves it after sending. */
  async function openEnvelope(provider: 'FIXTURE' | 'BOLDSIGN', envelopeId: string) {
    return withTenant(db.prisma, tenant.context, async (tx) => {
      return tx.signatureEnvelope.create({
        data: { organizationId: tenant.organizationId, dealId: tenant.dealId, batchId, provider, providerEnvelopeId: envelopeId, termSheetSha256: 'a'.repeat(64), buyerSignatory: tenant.context.userId, sellerSignatory: tenant.context.userId, sentBy: tenant.context.userId },
      });
    });
  }

  const statusOf = (id: string) => withTenant(db.prisma, tenant.context, async (tx) => (await tx.signatureEnvelope.findUniqueOrThrow({ where: { id } })).status);

  it('moves an envelope whose webhook was missed, with no page open, and applies a repeat once', async () => {
    const { envelopeId } = await fixture.createEnvelope({ emailSubject: 's', documents: [{ name: 'a.pdf', fileExtension: 'pdf', bytes: new Uint8Array([1]) }], signers: [{ email: 'a@x.test', name: 'A', anchor: '{{sign|1|*}}' }] });
    const row = await openEnvelope('FIXTURE', envelopeId);
    fixture.sign(envelopeId, 'a@x.test');
    const deps = { prisma: db.prisma, signingProviders: { FIXTURE: fixture } };
    const first = await processSigningPollSweep(deps);
    expect(first.changed).toBeGreaterThanOrEqual(1);
    expect(await statusOf(row.id)).toBe('COMPLETED');
    // A webhook for the same event, and a second sweep, change nothing.
    expect(await signingOutcomes.observe(db.prisma, { provider: 'FIXTURE', envelopeId, status: 'COMPLETED', reason: null, eventId: 'poll:COMPLETED', source: 'WEBHOOK' })).toBeNull();
    await processSigningPollSweep(deps, () => Date.now() + 3_600_000);
    const events = await withTenant(db.prisma, tenant.context, (tx) => tx.signingEnvelopeEvent.count({ where: { envelopeId: row.id, status: 'COMPLETED' } }));
    expect(events).toBe(1);
  });

  it('audits an envelope it cannot poll on the pact, once, and moves on', async () => {
    const row = await openEnvelope('FIXTURE', 'fixture-unknown');
    const deps = { prisma: db.prisma, signingProviders: { FIXTURE: fixture } };
    const outcome = await processSigningPollSweep(deps);
    expect(outcome.failed).toBeGreaterThanOrEqual(1);
    await processSigningPollSweep(deps, () => Date.now() + 3_600_000);
    const audits = await withTenant(db.prisma, tenant.context, (tx) => tx.auditEvent.count({ where: { dealId: tenant.dealId, action: 'signing.poll_failed', targetId: row.id } }));
    expect(audits).toBe(1);
  });

  it('leaves an envelope alone when its provider is not configured here', async () => {
    await openEnvelope('BOLDSIGN', 'bs-1');
    const outcome = await processSigningPollSweep({ prisma: db.prisma, signingProviders: {} });
    expect(outcome.skipped).toBeGreaterThanOrEqual(1);
  });
});

import { createHash, randomUUID } from 'node:crypto';
import { newId, type TenantContext } from '@pactlab/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TransactionClient } from './client';
import { rinsePreparers } from './rinse-preparers';
import { withTenant } from './tenant';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from './testing';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Preparer accounts and prep invites (T-178b, ADR 0059): an invite creates the preparer's workspace and
 * binds it to one pact in one step; the binding gives no read access to the pact; the workspace holds no
 * pacts; only the pact's own side sees invites and bindings; AI rinse jobs are recorded on the bound pact.
 */
describe('rinse preparers', () => {
  let db: TestDatabase;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let seller: TenantContext;
  const inTenant = <T>(context: TenantContext, fn: (tx: TransactionClient) => Promise<T>) => withTenant(db.prisma, context, fn);

  const invite = async (email: string, expires = new Date(Date.now() + 14 * 86_400_000)) => {
    const token = randomUUID();
    await inTenant(a.context, (tx) =>
      tx.rinsePrepInvite.create({ data: { id: newId(), organizationId: a.organizationId, dealId: a.dealId, email, tokenHash: hash(token), createdBy: a.userId, expiresAt: expires } }),
    );
    return hash(token);
  };

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'RinseA');
    b = await createSyntheticTenant(db.owner, 'RinseB');
    seller = (await addSyntheticDealMember(db.owner, a, 'TARGET_CONTRIBUTOR')).context;
  }, 60_000);
  afterAll(() => db?.stop());

  it('creates the preparer workspace and binds the invite in one step', async () => {
    const token = await invite('dana@harbour.example');
    const peek = await rinsePreparers.peek(db.prisma, token);
    expect(peek).toMatchObject({ email: 'dana@harbour.example', pactName: a.dealName, state: 'PENDING' });

    expect(await rinsePreparers.begin(db.prisma, { tokenHash: token, email: 'other@harbour.example', displayName: 'X', codeHash: hash('1'), ipHash: hash('ip1') })).toBeNull();
    const begun = await rinsePreparers.begin(db.prisma, { tokenHash: token, email: 'Dana@Harbour.example', displayName: 'Dana Whitlow', codeHash: hash('111111'), ipHash: hash('ip1') });
    expect(begun).toMatchObject({ kind: 'code' });
    expect(await rinsePreparers.verify(db.prisma, { email: 'dana@harbour.example', codeHash: hash('999999') })).toBeNull();
    const created = await rinsePreparers.verify(db.prisma, { email: 'dana@harbour.example', codeHash: hash('111111') });
    expect(created?.binding).toMatchObject({ organizationId: a.organizationId, dealId: a.dealId });

    const [workspace] = await db.owner.query<{ created_via: string; status: string; auth_method: string }>(`SELECT created_via::text, status::text, auth_method::text FROM organizations WHERE id = $1`, [created?.organizationId]).then((r) => r.rows);
    expect(workspace).toEqual({ created_via: 'PREPARER', status: 'ACTIVE', auth_method: 'EMAIL_CODE' });
    expect((await rinsePreparers.peek(db.prisma, token))?.state).toBe('ACCEPTED');
    // Single use: a second sign-up or acceptance binds nothing.
    expect(await rinsePreparers.accept(db.prisma, created?.session.sessionId ?? '', token)).toBeNull();

    const bindings = await rinsePreparers.bindings(db.prisma, created?.session.sessionId ?? '');
    expect(bindings).toEqual([expect.objectContaining({ dealId: a.dealId, pactName: a.dealName, organizationName: 'RinseA Capital (synthetic)' })]);
    const [audit] = await db.owner.query<{ action: string }>(`SELECT action FROM audit_events WHERE deal_id = $1 AND action = 'rinse.preparer_bound'`, [a.dealId]).then((r) => r.rows);
    expect(audit?.action).toBe('rinse.preparer_bound');
  });

  it('holds no pacts and reads nothing of the bound pact', async () => {
    const token = await invite('lee@harbour.example');
    await rinsePreparers.begin(db.prisma, { tokenHash: token, email: 'lee@harbour.example', displayName: 'Lee', codeHash: hash('222222'), ipHash: hash('ip2') });
    const created = await rinsePreparers.verify(db.prisma, { email: 'lee@harbour.example', codeHash: hash('222222') });
    const workspace = { organizationId: created?.organizationId, userId: created?.userId, organizationRole: 'ORG_OWNER', dealIds: [] } as unknown as TenantContext;
    await expect(
      inTenant(workspace, (tx) =>
        tx.deal.create({ data: { id: newId(), organizationId: created?.organizationId ?? '', name: 'Mine', targetName: 'T', transactionType: 'PRIVATE_ACQUIRER', createdBy: created?.userId ?? '' } }),
      ),
    ).rejects.toThrow();
    // Even with the bound pact named in its context, the workspace session is another tenant: nothing reads.
    const intruder = { ...workspace, dealIds: [a.dealId] } as unknown as TenantContext;
    expect(await inTenant(intruder, (tx) => tx.deal.findMany({ where: { id: a.dealId }, take: 1 }))).toEqual([]);
    expect(await inTenant(intruder, (tx) => tx.rinsePreparerBinding.findMany({ take: 10 }))).toEqual([]);
  });

  it('shows invites and bindings to the pact’s own side only', async () => {
    expect((await inTenant(a.context, (tx) => tx.rinsePrepInvite.findMany({ take: 10 }))).length).toBeGreaterThan(0);
    expect((await inTenant(a.context, (tx) => tx.rinsePreparerBinding.findMany({ take: 10 }))).length).toBeGreaterThan(0);
    expect(await inTenant(seller, (tx) => tx.rinsePrepInvite.findMany({ take: 10 }))).toEqual([]);
    expect(await inTenant(seller, (tx) => tx.rinsePreparerBinding.findMany({ take: 10 }))).toEqual([]);
    expect(await inTenant(b.context, (tx) => tx.rinsePrepInvite.findMany({ take: 10 }))).toEqual([]);
    await expect(inTenant(seller, (tx) => tx.rinsePrepInvite.create({ data: { id: newId(), organizationId: a.organizationId, dealId: a.dealId, email: 'x@y.example', tokenHash: hash('s'), createdBy: seller.userId, expiresAt: new Date() } }))).rejects.toThrow();
  });

  it('refuses expired and revoked invites, and an existing user signs in instead', async () => {
    const expired = await invite('old@harbour.example', new Date(Date.now() - 1000));
    expect(await rinsePreparers.begin(db.prisma, { tokenHash: expired, email: 'old@harbour.example', displayName: 'Old', codeHash: hash('3'), ipHash: hash('ip3') })).toBeNull();
    const revoked = await invite('gone@harbour.example');
    await inTenant(a.context, (tx) => tx.rinsePrepInvite.updateMany({ where: { tokenHash: revoked }, data: { revokedAt: new Date(), revokedBy: a.userId } }));
    expect((await rinsePreparers.peek(db.prisma, revoked))?.state).toBe('REVOKED');
    expect(await rinsePreparers.begin(db.prisma, { tokenHash: revoked, email: 'gone@harbour.example', displayName: 'Gone', codeHash: hash('4'), ipHash: hash('ip4') })).toBeNull();
    const again = await invite('dana@harbour.example');
    expect(await rinsePreparers.begin(db.prisma, { tokenHash: again, email: 'dana@harbour.example', displayName: 'Dana', codeHash: hash('5'), ipHash: hash('ip5') })).toEqual({ kind: 'existing-user' });
  });

  it('records AI rinse jobs on the bound pact, and checks bindings at sync', async () => {
    const token = await invite('ai@harbour.example');
    await rinsePreparers.begin(db.prisma, { tokenHash: token, email: 'ai@harbour.example', displayName: 'Ai', codeHash: hash('666666'), ipHash: hash('ip6') });
    const created = await rinsePreparers.verify(db.prisma, { email: 'ai@harbour.example', codeHash: hash('666666') });
    const session = created?.session.sessionId ?? '';
    const binding = created?.binding?.bindingId ?? '';
    const run = (promptId: string) => ({ id: newId(), taskType: 'DOCUMENT_CLASSIFY', promptId, promptVersion: '1', promptHash: 'h', modelAlias: 'fast', resolvedModelId: 'm', jobType: 'classification', inputHashes: [], outputHash: null, status: 'SUCCEEDED', inputTokens: 10, outputTokens: 5, latencyMs: 3, createdAt: new Date().toISOString() });
    expect(await rinsePreparers.recordRun(db.prisma, session, binding, run('document.classify'))).toBe(true);
    expect(await rinsePreparers.recordRun(db.prisma, session, binding, run('document.qa'))).toBe(false);
    expect(await rinsePreparers.recordRun(db.prisma, session, newId(), run('document.classify'))).toBe(false);
    expect(await rinsePreparers.runsToday(db.prisma, session)).toBe(1);
    const [row] = await db.owner.query<{ organization_id: string; deal_id: string; requested_by: string }>(`SELECT organization_id::text, deal_id::text, requested_by::text FROM ai_runs WHERE requested_by = $1`, [created?.userId]).then((r) => r.rows);
    expect(row).toEqual({ organization_id: a.organizationId, deal_id: a.dealId, requested_by: created?.userId });

    expect(await inTenant(seller, (tx) => rinsePreparers.bindingLive(tx, a.dealId, binding))).toBe(true);
    expect(await inTenant(b.context, (tx) => rinsePreparers.bindingLive(tx, a.dealId, binding))).toBe(false);
    await inTenant(a.context, (tx) => tx.rinsePreparerBinding.update({ where: { id: binding }, data: { revokedAt: new Date(), revokedBy: a.userId } }));
    expect(await inTenant(seller, (tx) => rinsePreparers.bindingLive(tx, a.dealId, binding))).toBe(false);
    expect(await rinsePreparers.recordRun(db.prisma, session, binding, run('document.classify'))).toBe(false);
    expect(await rinsePreparers.bindings(db.prisma, session)).toEqual([]);
  });
});

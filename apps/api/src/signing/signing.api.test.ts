import 'reflect-metadata';
import { createHash, createHmac } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { BoldSignSigningProvider, BoldSignWebhook, DocuSignOAuth, MemorySecretStore, type FetchLike } from '@pactlab/connectors';
import { addSyntheticDealMember, createSyntheticTenant, startTestDatabase, type SyntheticTenant, type TestDatabase } from '@pactlab/db/testing';
import type { SigningSettingsView, SigningView } from '@pactlab/domain';
import { createLogger } from '@pactlab/observability';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { JwtIdentityVerifier } from '../auth/identity';
import { InMemoryObjectStore } from '../documents/testing';

const ISSUER = 'https://pactlab-test.example/';
const AUDIENCE = 'https://api.pactlab.test';
const WEBHOOK_SECRET = 'whsec-boldsign-test';
const SIGNED_PDF = Buffer.from('%PDF-1.7 signed by both sides (synthetic)');
const AUDIT_PDF = Buffer.from('%PDF-1.7 BoldSign audit trail (synthetic)');

type Body = Record<string, unknown>;
type Method = 'GET' | 'POST' | 'PUT';

/** BoldSign's documented endpoints, played by a fake: no envelope ever leaves the test (CLAUDE.md). */
function fakeBoldSign() {
  const documents = new Map<string, { status: string; viewed: boolean; declineMessage?: string; signers: string[] }>();
  const sent: { Signers: { EmailAddress: string; SignerOrder: number }[]; ExpiryDays?: number }[] = [];
  let next = 1;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    if (init?.headers?.['X-API-KEY'] !== 'bs-key') return json({}, 401);
    const id = url.searchParams.get('documentId') ?? '';
    const document = documents.get(id);
    switch (url.pathname) {
      case '/v1/document/send': {
        const body = JSON.parse(init?.body ?? '{}') as (typeof sent)[number];
        sent.push(body);
        const documentId = `bs-${String(next++).padStart(4, '0')}-doc`;
        documents.set(documentId, { status: 'InProgress', viewed: false, signers: body.Signers.map((signer) => signer.EmailAddress) });
        return json({ documentId }, 201);
      }
      case '/v1/document/properties':
        return document ? json({ documentId: id, status: document.status, signerDetails: document.signers.map((signerEmail) => ({ signerEmail, isViewed: document.viewed, status: document.status === 'Declined' ? 'Declined' : 'NotCompleted', declineMessage: document.declineMessage ?? null })) }) : json({}, 404);
      case '/v1/document/getEmbeddedSignLink':
        return document?.signers.includes(url.searchParams.get('signerEmail') ?? '') ? json({ signLink: `https://app.boldsign.com/document/sign/?documentId=${id}&s=${encodeURIComponent(url.searchParams.get('signerEmail')!)}&back=${encodeURIComponent(url.searchParams.get('redirectUrl')!)}` }) : json({}, 400);
      case '/v1/document/download':
        return document?.status === 'Completed' ? new Response(SIGNED_PDF, { status: 200 }) : json({}, 400);
      case '/v1/document/downloadAuditLog':
        return document?.status === 'Completed' ? new Response(AUDIT_PDF, { status: 200 }) : json({}, 400);
      default:
        return json({}, 404);
    }
  };
  return { fetchImpl, documents, sent };
}

describe('in-workflow signing on the provider seam (T-136)', () => {
  let db: TestDatabase;
  let app: NestFastifyApplication;
  let guardedApp: NestFastifyApplication;
  let a: SyntheticTenant;
  let b: SyntheticTenant;
  let key: CryptoKey;
  const boldsign = fakeBoldSign();
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const token = (subject: string, org: string) =>
    new SignJWT({ org_id: org }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m').sign(key);

  async function call(who: string, method: Method, url: string, payload?: Body, on = app) {
    const response = await on.inject({ method, url, headers: { authorization: `Bearer ${tokens[who]!}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.headers['content-type']?.includes('json') ? response.json() : {}) as Body, raw: response.rawPayload, text: response.body };
  }
  const deal = (path: string, dealId = a.dealId) => `/v1/deals/${dealId}${path}`;
  const signing = async (who: string) => (await call(who, 'GET', deal('/signing'))).body as unknown as SigningView;
  const loi = async (who: string) => (await call(who, 'GET', deal('/loi'))).body as { canDraft: boolean; exclusivity: { daysLeft: number } | null; current: { id: string; version: number; status: string } | null };
  const fields = { exclusivityDays: 30, governingLaw: 'the State of Delaware', expenses: 'Each party bears its own costs.', diligenceDays: 21, targetSigningDate: '2027-01-15', responseDays: 7, conditions: ['A definitive agreement'] };
  const webhook = (payload: unknown, headers: Record<string, string> = {}) => {
    const raw = JSON.stringify(payload);
    const t = Math.floor(Date.now() / 1000);
    const signature = `t=${t}, s0=${createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex')}`;
    return app.inject({ method: 'POST', url: '/v1/webhooks/signing/boldsign', headers: { 'content-type': 'application/json', 'x-boldsign-signature': signature, 'x-boldsign-event': 'Document', ...headers }, payload: raw });
  };
  const event = (id: string, eventType: string, documentId: string, data: Body = {}) => ({ event: { id, created: Math.floor(Date.now() / 1000), eventType, environment: 'Test' }, data: { object: 'document', documentId, status: eventType, ...data } });

  /** Draft and send the next letter of intent by e-signature; returns its provider document id. */
  async function sendLoi(): Promise<{ loiId: string; documentId: string; envelopeId: string }> {
    const drafted = await call('lead', 'POST', deal('/loi'));
    expect(drafted.status, drafted.text).toBe(201);
    const loiId = (await loi('lead')).current!.id;
    expect((await call('lead', 'PUT', deal(`/loi/${loiId}/fields`), fields)).status).toBe(200);
    const sent = await call('lead', 'POST', deal(`/loi/${loiId}/send`), { method: 'ESIGN' });
    expect(sent.status, sent.text).toBe(200);
    const envelope = (await signing('lead')).envelopes.find((row) => row.subject === 'LOI' && row.status === 'SENT')!;
    const documentId = ((await db.owner.query(`SELECT provider_envelope_id FROM signature_envelopes WHERE id = $1`, [envelope.id])).rows[0] as { provider_envelope_id: string }).provider_envelope_id;
    return { loiId, documentId, envelopeId: envelope.id };
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    a = await createSyntheticTenant(db.owner, 'Signer');
    b = await createSyntheticTenant(db.owner, 'Elsewhere');
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' };
    const base = {
      prisma: db.prisma,
      identityVerifier: new JwtIdentityVerifier({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
      logger: createLogger('api-test', { level: 'silent' }),
      documents: { objectStore: new InMemoryObjectStore() },
      providers: { secrets: new MemorySecretStore() },
    };
    const boldsignDeps = { provider: new BoldSignSigningProvider({ apiKey: 'bs-key', baseUrl: 'https://api.boldsign.com' }, boldsign.fetchImpl), webhook: new BoldSignWebhook(WEBHOOK_SECRET) };
    const docusign = { oauth: new DocuSignOAuth({ integrationKey: 'ik', clientSecret: 'cs', authHost: 'account-d.docusign.com' }), connectHmacKey: 'connect-key', redirectUri: 'https://app.pactlab.test/settings/docusign/callback' };
    app = await createApp({ ...base, signing: { fixture: true, docusign, boldsign: boldsignDeps, pollIntervalMs: 0 } });
    // A non-live environment before the production go: test recipients only.
    guardedApp = await createApp({ ...base, signing: { fixture: false, docusign: null, boldsign: boldsignDeps, testRecipients: ['@buyer.example'], pollIntervalMs: 0 } });
    tokens['lead'] = await token(a.subject, a.auth0OrganizationId);
    ids['lead'] = a.userId;
    tokens['lead_b'] = await token(b.subject, b.auth0OrganizationId);
    for (const role of ['ANALYST', 'TARGET_CONTRIBUTOR'] as const) {
      const member = await addSyntheticDealMember(db.owner, a, role);
      tokens[role.toLowerCase()] = await token(member.subject, a.auth0OrganizationId);
      ids[role.toLowerCase()] = member.userId;
    }
    await db.owner.query(`UPDATE users SET email = 'lead@buyer.example' WHERE id = $1`, [a.userId]);
    await db.owner.query(`UPDATE users SET email = 'seller@seller.example' WHERE id = $1`, [ids['target_contributor']]);
    await db.owner.query(`INSERT INTO deal_parties (id, organization_id, deal_id, role, name, ownership, company_type, updated_at) VALUES (gen_random_uuid(), $1, $2, 'SELLER', 'TargetCo (synthetic)', 'PRIVATE', 'SOFTWARE_SAAS', now()), (gen_random_uuid(), $1, $2, 'BUYER', 'Signer Capital (synthetic)', 'PRIVATE', NULL, now())`, [a.organizationId, a.dealId]);
    // Agreed terms: the buyer prices and proposes, the seller accepts every term.
    const scenario = await call('lead', 'POST', deal('/valuation/scenarios'), { name: 'Base', scenarioCase: 'BASE', values: { assumptions: { method: 'ARR_MULTIPLE', arr: '10000000.00', multiple: '6' }, bridge: { cash: '0', debt: '0', debtLikeItems: '0', workingCapitalAdjustment: '0' } } });
    expect(scenario.status, scenario.text).toBe(201);
    expect((await call('lead', 'POST', deal('/pricing/evaluations'), { persona: 'VALUE_INVESTOR' })).status).toBe(201);
    const drafted = (await call('lead', 'POST', deal('/pricing/terms'))).body as { batches: { id: string }[] };
    expect((await call('lead', 'POST', deal(`/pricing/terms/${drafted.batches[0]!.id}/propose`))).status).toBe(201);
    const proposed = (await call('target_contributor', 'GET', deal('/terms/proposed'))).body['proposed'] as { terms: { ordinal: number }[] };
    expect((await call('target_contributor', 'POST', deal('/terms/proposed/responses'), { responses: proposed.terms.map((term) => ({ ordinal: term.ordinal, decision: 'ACCEPT' })) })).status).toBe(201);
    await call('lead', 'PUT', deal('/signatories/BUYER'), { userId: ids['lead']! });
    await call('target_contributor', 'PUT', deal('/signatories/SELLER'), { userId: ids['target_contributor']! });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await guardedApp?.close();
    await db?.stop();
  });

  it('defaults to Pactlab signing; only owners and admins change it, and only to a connected DocuSign', async () => {
    const settings = (await call('lead', 'GET', '/v1/organization/signing')).body as unknown as SigningSettingsView;
    expect(settings).toMatchObject({ current: 'PACTLAB', effective: { provider: 'Pactlab signing', note: null }, canEdit: true });
    expect(settings.options.find((option) => option.choice === 'DOCUSIGN')).toMatchObject({ available: false });
    expect((await call('analyst', 'PUT', '/v1/organization/signing', { provider: 'PACTLAB' })).status).toBe(403);
    expect((await call('lead', 'PUT', '/v1/organization/signing', { provider: 'DOCUSIGN' })).body['code']).toBe('DOCUSIGN_NOT_CONNECTED');
  });

  it('sends nothing to a real counterparty from a non-live environment', async () => {
    const drafted = await call('lead', 'POST', deal('/loi'), undefined, guardedApp);
    expect(drafted.status, drafted.text).toBe(201);
    const loiId = ((await call('lead', 'GET', deal('/loi'), undefined, guardedApp)).body['current'] as { id: string }).id;
    await call('lead', 'PUT', deal(`/loi/${loiId}/fields`), fields, guardedApp);
    const before = boldsign.sent.length;
    const refused = await call('lead', 'POST', deal(`/loi/${loiId}/send`), { method: 'ESIGN' }, guardedApp);
    expect(refused.status).toBe(422);
    expect(refused.body['code']).toBe('ESIGN_TEST_RECIPIENTS_ONLY');
    expect(boldsign.sent.length).toBe(before);
    // Nothing was sent: the draft is still a draft.
    expect((await loi('lead')).current).toMatchObject({ id: loiId, status: 'DRAFT' });
    // Send it in the app instead and decline it, so the next tests start from a settled letter.
    expect((await call('lead', 'POST', deal(`/loi/${loiId}/send`), { method: 'IN_APP' })).status).toBe(200);
    expect((await call('target_contributor', 'POST', deal(`/loi/${loiId}/decline`))).status).toBe(200);
  });

  it('a declined envelope lands in the pact with its reason, via the webhook', async () => {
    const { documentId, loiId } = await sendLoi();
    // Sent with BoldSign, buyer first, expiring with the letter's answer date.
    expect(boldsign.sent.at(-1)).toMatchObject({ ExpiryDays: 7, Signers: [{ EmailAddress: 'lead@buyer.example', SignerOrder: 1 }, { EmailAddress: 'seller@seller.example', SignerOrder: 2 }] });
    const response = await webhook(event('evt-decline-1', 'Declined', documentId, { signerDetails: [{ signerEmail: 'seller@seller.example', status: 'Declined', declineMessage: 'Exclusivity is too long' }] }));
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ recorded: true });
    expect((await loi('target_contributor')).current).toMatchObject({ id: loiId, status: 'DECLINED' });
    const envelope = (await signing('target_contributor')).envelopes.find((row) => row.subject === 'LOI')!;
    expect(envelope).toMatchObject({ provider: 'Pactlab signing', status: 'DECLINED', statusLabel: 'Declined', reason: 'Exclusivity is too long' });
    expect(envelope.timeline.map((entry) => [entry.status, entry.source])).toEqual([['SENT', 'APP'], ['DECLINED', 'WEBHOOK']]);
  });

  it('an envelope expiring unsigned expires the letter: the exclusivity clock never starts (polling, no webhook)', async () => {
    const { documentId, loiId } = await sendLoi();
    boldsign.documents.get(documentId)!.status = 'Expired';
    const view = await loi('lead');
    expect(view.current).toMatchObject({ id: loiId, status: 'EXPIRED' });
    expect(view.exclusivity).toBeNull();
    const envelope = (await signing('lead')).envelopes.find((row) => row.status === 'EXPIRED')!;
    expect(envelope.timeline.map((entry) => [entry.status, entry.source])).toEqual([['SENT', 'APP'], ['EXPIRED', 'POLL']]);
    const audit = await db.owner.query(`SELECT 1 FROM audit_events WHERE deal_id = $1 AND action = 'loi.esign_expired'`, [a.dealId]);
    expect(audit.rows.length).toBe(1);
  });

  it('end to end: the guest signer signs in an embedded session; the webhook settles it once; the signed files are stored byte-for-byte', async () => {
    const { documentId, loiId, envelopeId } = await sendLoi();
    // Only the envelope's signatories open embedded sessions, each for themselves, returning to the pact.
    expect((await call('analyst', 'POST', deal(`/signing/${envelopeId}/session`))).status).toBe(403);
    expect((await call('lead_b', 'POST', deal(`/signing/${envelopeId}/session`))).status).toBeGreaterThanOrEqual(403);
    const mine = (await signing('target_contributor')).envelopes.find((row) => row.id === envelopeId)!;
    expect(mine.canSignEmbedded).toBe(true);
    const session = await call('target_contributor', 'POST', deal(`/signing/${envelopeId}/session`));
    expect(session.status, session.text).toBe(200);
    const link = new URL(session.body['url'] as string);
    expect(link.origin).toBe('https://app.boldsign.com');
    expect(link.searchParams.get('s')).toBe('seller@seller.example');
    expect(link.searchParams.get('back')).toBe(`http://localhost:3000/deals/${a.dealId}/sign/${envelopeId}/done`);

    // Opened, then completed; BoldSign delivers the completion twice.
    expect((await webhook(event('evt-viewed-3', 'Viewed', documentId))).json()).toEqual({ recorded: true });
    boldsign.documents.get(documentId)!.status = 'Completed';
    const first = await webhook(event('evt-completed-3', 'Completed', documentId));
    expect(first.json()).toEqual({ recorded: true });
    const counts = async () => (await db.owner.query(`SELECT (SELECT count(*) FROM signing_envelope_events WHERE envelope_id = $1)::int AS events, (SELECT count(*) FROM audit_events WHERE deal_id = $2)::int AS audit, (SELECT count(*) FROM signing_artifacts WHERE envelope_id = $1)::int AS artifacts, (SELECT count(*) FROM loi_signoffs WHERE loi_id = $3)::int AS signoffs`, [envelopeId, a.dealId, loiId])).rows[0] as Record<string, number>;
    const once = await counts();
    const again = await webhook(event('evt-completed-3', 'Completed', documentId));
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ recorded: false });
    expect(await counts()).toEqual(once);
    expect(once).toMatchObject({ events: 3, artifacts: 2, signoffs: 2 });

    const view = await loi('target_contributor');
    expect(view.current).toMatchObject({ id: loiId, status: 'COUNTERSIGNED' });
    expect(view.exclusivity?.daysLeft).toBe(30);
    const envelope = (await signing('target_contributor')).envelopes.find((row) => row.id === envelopeId)!;
    expect(envelope.timeline.map((entry) => entry.status)).toEqual(['SENT', 'DELIVERED', 'COMPLETED']);
    expect(envelope).toMatchObject({ status: 'COMPLETED', artifactsPending: false, canSignEmbedded: false });
    expect(envelope.artifacts.map((artifact) => [artifact.kind, artifact.sha256])).toEqual([
      ['CERTIFICATE', createHash('sha256').update(AUDIT_PDF).digest('hex')],
      ['SIGNED_DOCUMENT', createHash('sha256').update(SIGNED_PDF).digest('hex')],
    ]);
    // Both sides download the signed record, byte-for-byte; another organization cannot.
    const signed = await call('target_contributor', 'GET', deal(`/signing/${envelopeId}/artifacts/signed`));
    expect(signed.status).toBe(200);
    expect(Buffer.compare(signed.raw, SIGNED_PDF)).toBe(0);
    expect(Buffer.compare((await call('lead', 'GET', deal(`/signing/${envelopeId}/artifacts/certificate`))).raw, AUDIT_PDF)).toBe(0);
    expect((await call('lead_b', 'GET', deal(`/signing/${envelopeId}/artifacts/signed`))).status).toBeGreaterThanOrEqual(403);
    expect((await call('lead_b', 'GET', deal('/signing'))).status).toBeGreaterThanOrEqual(403);
    // Stored files are kept as received.
    await expect(db.owner.query(`UPDATE signing_artifacts SET sha256 = repeat('0', 64) WHERE envelope_id = $1`, [envelopeId])).rejects.toThrow(/kept as received/);
  });

  it('refuses a webhook without a valid signature, and answers the endpoint check', async () => {
    const bad = await app.inject({ method: 'POST', url: '/v1/webhooks/signing/boldsign', headers: { 'content-type': 'application/json', 'x-boldsign-signature': `t=${Math.floor(Date.now() / 1000)}, s0=${'a'.repeat(64)}` }, payload: JSON.stringify(event('evt-x', 'Completed', 'bs-0001-doc')) });
    expect(bad.statusCode).toBe(403);
    const ping = await app.inject({ method: 'POST', url: '/v1/webhooks/signing/boldsign', headers: { 'content-type': 'application/json', 'x-boldsign-event': 'Verification' }, payload: '{}' });
    expect(ping.statusCode).toBe(200);
  });

  it('polling fallback: with the webhook suppressed, the agreed terms still converge to signed, with their files', async () => {
    const view = (await call('lead', 'GET', deal('/close'))).body as { agreed: { batchId: string } };
    const sent = await call('lead', 'POST', deal(`/terms/${view.agreed.batchId}/esign`), {});
    expect(sent.status, sent.text).toBe(201);
    const close = (await call('lead', 'GET', deal('/close'))).body as { agreed: { envelope: { id: string; provider: string; status: string } } };
    expect(close.agreed.envelope).toMatchObject({ provider: 'BOLDSIGN', status: 'SENT' });
    const documentId = ((await db.owner.query(`SELECT provider_envelope_id FROM signature_envelopes WHERE id = $1`, [close.agreed.envelope.id])).rows[0] as { provider_envelope_id: string }).provider_envelope_id;
    boldsign.documents.get(documentId)!.status = 'Completed';
    const after = (await call('target_contributor', 'GET', deal('/close'))).body as { agreed: { envelope: { status: string }; signoffs: { side: string; method: string }[] } };
    expect(after.agreed.envelope.status).toBe('COMPLETED');
    expect(after.agreed.signoffs.map((signoff) => [signoff.side, signoff.method]).sort()).toEqual([['BUYER', 'ESIGN'], ['SELLER', 'ESIGN']]);
    const envelope = (await signing('lead')).envelopes.find((row) => row.id === close.agreed.envelope.id)!;
    expect(envelope.timeline.map((entry) => [entry.status, entry.source])).toEqual([['SENT', 'APP'], ['COMPLETED', 'POLL']]);
    expect(envelope.artifacts).toHaveLength(2);
    // A late webhook for the same completion changes nothing.
    expect((await webhook(event('evt-late', 'Completed', documentId))).json()).toEqual({ recorded: false });
  });

  it('switching to the organization’s own DocuSign affects new envelopes only, and a disconnected DocuSign falls back, saying so', async () => {
    await db.owner.query(`INSERT INTO organization_connections (id, organization_id, provider, credential_ref, account_id, account_name, base_uri, connected_by) VALUES (gen_random_uuid(), $1, 'docusign', $2, 'acct-1', 'Signer Capital DocuSign', 'https://demo.docusign.net', $3)`, [a.organizationId, `secretref:${a.organizationId}/docusign/test`, a.userId]);
    const changed = await call('lead', 'PUT', '/v1/organization/signing', { provider: 'DOCUSIGN' });
    expect(changed.status, changed.text).toBe(200);
    expect(changed.body).toMatchObject({ current: 'DOCUSIGN', effective: { provider: 'Your DocuSign', note: null } });
    const audit = await db.owner.query(`SELECT 1 FROM audit_events WHERE organization_id = $1 AND action = 'organization.signing_provider_changed'`, [a.organizationId]);
    expect(audit.rows.length).toBe(1);
    // Every envelope already sent keeps the provider it went out with.
    const providers = (await db.owner.query(`SELECT DISTINCT provider FROM signature_envelopes WHERE deal_id = $1`, [a.dealId])).rows.map((row) => (row as { provider: string }).provider);
    expect(providers).toEqual(['BOLDSIGN']);
    expect((await signing('lead')).envelopes.every((row) => row.provider === 'Pactlab signing')).toBe(true);
    expect(((await call('lead', 'GET', deal('/close'))).body as { esign: { provider: string } }).esign.provider).toBe('DOCUSIGN');
    // Disconnected: new envelopes fall back to Pactlab signing, and the page says so.
    await call('lead', 'DELETE' as Method, '/v1/organization/docusign');
    await db.owner.query(`UPDATE organization_connections SET disconnected_at = now() WHERE organization_id = $1`, [a.organizationId]);
    const fallback = (await call('lead', 'GET', '/v1/organization/signing')).body as unknown as SigningSettingsView;
    expect(fallback.current).toBe('DOCUSIGN');
    expect(fallback.effective.provider).toBe('Pactlab signing');
    expect(fallback.effective.note).toMatch(/not connected/);
    expect(((await call('lead', 'GET', deal('/close'))).body as { esign: { provider: string; note: string } }).esign).toMatchObject({ provider: 'BOLDSIGN', note: expect.stringMatching(/not connected/) });
  });
});

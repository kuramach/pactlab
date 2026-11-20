import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../http/cassette';
import {
  BoldSignSigningProvider,
  BoldSignWebhook,
  DocuSignOAuth,
  DocuSignSigningProvider,
  DocuSignWebhook,
  FixtureSigningProvider,
  parseDocuSignConnect,
  restrictRecipients,
  signHereMarker,
  SIGNING_PROVIDERS,
  SigningRecipientRefused,
  verifyDocuSignConnect,
  type EnvelopeRequest,
  type SigningProvider,
  type SigningProviderName,
} from './index';

const app = { integrationKey: 'ik-test', clientSecret: 'secret-test', authHost: 'account-d.docusign.com' };
const ENVELOPE = '4b7e9a2c-1f3d-4c1a-9b2e-0a1b2c3d4e5f';
const PDF = new Uint8Array([37, 80, 68, 70, 45, 49]);

/** Records requests and answers from a script; no network. */
function scripted(responses: Record<string, { status: number; body: unknown }>) {
  const requests: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    requests.push({ url, method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body });
    const key = Object.keys(responses).find((path) => url.split('?')[0]!.endsWith(path));
    const reply = key ? responses[key]! : { status: 404, body: {} };
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, requests };
}

/** A stateful stand-in for BoldSign's documented endpoints (shapes from developers.boldsign.com). */
function fakeBoldSign() {
  const documents = new Map<string, { status: string; viewed: boolean; declineMessage?: string; signers: string[] }>();
  const requests: { url: URL; method: string; headers: Record<string, string>; body?: string }[] = [];
  let next = 1;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    requests.push({ url, method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body });
    if (init?.headers?.['X-API-KEY'] !== 'bs-key') return json({ error: 'Unauthorized' }, 401);
    const id = url.searchParams.get('documentId') ?? '';
    const document = documents.get(id);
    switch (url.pathname) {
      case '/v1/document/send': {
        const body = JSON.parse(init?.body ?? '{}') as { Signers: { EmailAddress: string }[] };
        const documentId = `bs-doc-${next++}`;
        documents.set(documentId, { status: 'InProgress', viewed: false, signers: body.Signers.map((signer) => signer.EmailAddress) });
        return json({ documentId }, 201);
      }
      case '/v1/document/properties':
        return document ? json({ documentId: id, status: document.status, declineMessage: document.declineMessage ?? null, signerDetails: document.signers.map((signerEmail) => ({ signerEmail, status: document.status === 'Declined' ? 'Declined' : 'NotCompleted', isViewed: document.viewed, declineMessage: document.declineMessage ?? null })) }) : json({}, 404);
      case '/v1/document/getEmbeddedSignLink':
        return document && document.signers.includes(url.searchParams.get('signerEmail') ?? '') ? json({ signLink: `https://app.boldsign.com/document/sign/?documentId=${id}` }) : json({ error: 'Invalid signer' }, 400);
      case '/v1/document/download':
      case '/v1/document/downloadAuditLog':
        return document?.status === 'Completed' ? new Response(url.pathname.endsWith('AuditLog') ? 'audit-trail-pdf' : 'signed-pdf', { status: 200, headers: { 'content-type': 'application/pdf' } }) : json({}, 400);
      default:
        return json({}, 404);
    }
  };
  return { fetchImpl, requests, documents };
}

/** A stateful stand-in for DocuSign's documented eSignature v2.1 endpoints. */
function fakeDocuSign() {
  const envelopes = new Map<string, { status: string }>();
  const fetchImpl: FetchLike = async (input, init) => {
    const path = new URL(input).pathname;
    const created = /\/envelopes$/.exec(path);
    if (created && init?.method === 'POST') {
      const envelopeId = `00000000-0000-4000-8000-${String(envelopes.size + 1).padStart(12, '0')}`;
      envelopes.set(envelopeId, { status: 'sent' });
      return new Response(JSON.stringify({ envelopeId, status: 'sent' }), { status: 201 });
    }
    const document = /\/envelopes\/([^/]+)\/documents\/(combined|certificate)$/.exec(path);
    if (document) return envelopes.get(document[1]!)?.status === 'completed' ? new Response(document[2] === 'combined' ? 'signed-pdf' : 'certificate-pdf', { status: 200 }) : new Response('{}', { status: 400 });
    const one = /\/envelopes\/([^/]+)$/.exec(path);
    const envelope = one ? envelopes.get(one[1]!) : undefined;
    return envelope ? new Response(JSON.stringify(envelope), { status: 200 }) : new Response('{}', { status: 404 });
  };
  return { fetchImpl, envelopes };
}

const request = (signers = [{ email: 'buyer@x.test', name: 'Buyer', anchor: signHereMarker(1) }, { email: 'seller@x.test', name: 'Seller', anchor: signHereMarker(2) }]): EnvelopeRequest => ({
  emailSubject: 'Sign the letter of intent (v1)',
  documents: [{ name: 'Letter of intent v1.pdf', fileExtension: 'pdf', bytes: PDF }],
  signers,
  expiresInDays: 14,
});

interface ContractSubject {
  readonly provider: SigningProvider;
  /** Moves an envelope at the "provider" the way its signers would. */
  settle(envelopeId: string, outcome: 'COMPLETED' | 'DECLINED' | 'EXPIRED'): void;
}

/** The bar every signing adapter passes (T-136): the same tests, run against each one. */
function signingContract(name: SigningProviderName, subject: () => ContractSubject) {
  describe(`signing contract: ${name}`, () => {
    it('sends an envelope, which starts open', async () => {
      const { provider } = subject();
      expect(provider.name).toBe(name);
      const { envelopeId } = await provider.createEnvelope(request());
      expect(envelopeId).toMatch(/\S{8,}/);
      expect(['SENT', 'DELIVERED']).toContain((await provider.status(envelopeId)).status);
    });

    it('reports completion and returns the signed document and certificate, both non-empty', async () => {
      const { provider, settle } = subject();
      const { envelopeId } = await provider.createEnvelope(request());
      settle(envelopeId, 'COMPLETED');
      expect(await provider.status(envelopeId)).toEqual({ status: 'COMPLETED', reason: null });
      const artifacts = await provider.artifacts(envelopeId);
      expect(artifacts.document.length).toBeGreaterThan(0);
      expect(artifacts.certificate.length).toBeGreaterThan(0);
    });

    it('reports a decline and an expiry as settled states, never as open', async () => {
      const { provider, settle } = subject();
      const declined = await provider.createEnvelope(request());
      settle(declined.envelopeId, 'DECLINED');
      expect((await provider.status(declined.envelopeId)).status).toBe('DECLINED');
      const expired = await provider.createEnvelope(request());
      settle(expired.envelopeId, 'EXPIRED');
      // DocuSign voids an envelope that expires; either way it is settled and not signed.
      expect(['EXPIRED', 'VOIDED']).toContain((await provider.status(expired.envelopeId)).status);
    });

    it('opens an embedded session exactly when the registry says it can', async () => {
      const { provider } = subject();
      const { envelopeId } = await provider.createEnvelope(request());
      const url = await provider.embeddedSigningUrl(envelopeId, 'seller@x.test', 'https://app.pactlab.test/deals/d/loi');
      if (SIGNING_PROVIDERS[name].embedded) expect(url).toMatch(/^https:\/\//);
      else expect(url).toBeNull();
    });

    it('sends nothing to a recipient outside the test recipients', async () => {
      const { provider } = subject();
      const guarded = restrictRecipients(provider, ['@x.test']);
      await expect(guarded.createEnvelope(request([{ email: 'counterparty@real.example', name: 'Real', anchor: signHereMarker(1) }]))).rejects.toBeInstanceOf(SigningRecipientRefused);
      await expect(guarded.createEnvelope(request())).resolves.toMatchObject({ envelopeId: expect.any(String) });
    });
  });
}

signingContract('FIXTURE', () => {
  const provider = new FixtureSigningProvider();
  return {
    provider,
    settle: (envelopeId, outcome) => {
      if (outcome === 'COMPLETED') for (const email of ['buyer@x.test', 'seller@x.test']) provider.sign(envelopeId, email);
      else if (outcome === 'DECLINED') provider.decline(envelopeId, 'Terms changed');
      else provider.expire(envelopeId);
    },
  };
});

signingContract('BOLDSIGN', () => {
  const fake = fakeBoldSign();
  return {
    provider: new BoldSignSigningProvider({ apiKey: 'bs-key', baseUrl: 'https://api.boldsign.com' }, fake.fetchImpl),
    settle: (envelopeId, outcome) => {
      const document = fake.documents.get(envelopeId)!;
      document.status = outcome === 'COMPLETED' ? 'Completed' : outcome === 'DECLINED' ? 'Declined' : 'Expired';
      if (outcome === 'DECLINED') document.declineMessage = 'Terms changed';
    },
  };
});

signingContract('DOCUSIGN', () => {
  const fake = fakeDocuSign();
  return {
    provider: new DocuSignSigningProvider({ accountId: 'a1', accountName: 'C', baseUri: 'https://demo.docusign.net' }, async () => 'at', fake.fetchImpl),
    settle: (envelopeId, outcome) => {
      fake.envelopes.get(envelopeId)!.status = outcome === 'COMPLETED' ? 'completed' : outcome === 'DECLINED' ? 'declined' : 'voided';
    },
  };
});

describe('the seam (T-136)', () => {
  it('has one marker per signer that every adapter places a signature on', () => {
    expect([signHereMarker(1), signHereMarker(2)]).toEqual(['{{sign|1|*}}', '{{sign|2|*}}']);
    expect(() => signHereMarker(0)).toThrow();
  });

  it('a guarded provider with no test recipients sends nothing at all', async () => {
    await expect(restrictRecipients(new FixtureSigningProvider(), []).createEnvelope(request())).rejects.toBeInstanceOf(SigningRecipientRefused);
  });
});

describe('BoldSign adapter (T-136)', () => {
  it('sends JSON with the API key, base64 files, ordered signers and text tags, and BoldSign emails off', async () => {
    const fake = fakeBoldSign();
    const provider = new BoldSignSigningProvider({ apiKey: 'bs-key', baseUrl: 'https://api.boldsign.com' }, fake.fetchImpl);
    const { envelopeId } = await provider.createEnvelope(request());
    expect(envelopeId).toBe('bs-doc-1');
    const sent = fake.requests[0]!;
    expect(sent.url.origin + sent.url.pathname).toBe('https://api.boldsign.com/v1/document/send');
    expect(sent.headers['X-API-KEY']).toBe('bs-key');
    expect(JSON.parse(sent.body ?? '{}')).toMatchObject({
      Title: 'Sign the letter of intent (v1)',
      DisableEmails: true,
      EnableSigningOrder: true,
      UseTextTags: true,
      ExpiryDays: 14,
      Signers: [
        { Name: 'Buyer', EmailAddress: 'buyer@x.test', SignerType: 'Signer', SignerOrder: 1 },
        { Name: 'Seller', EmailAddress: 'seller@x.test', SignerType: 'Signer', SignerOrder: 2 },
      ],
      Files: [{ base64: `data:application/pdf;base64,${Buffer.from(PDF).toString('base64')}`, fileName: 'Letter of intent v1.pdf' }],
    });
  });

  it('asks for a short-lived embedded link for one signer, returning to Pactlab', async () => {
    const fake = fakeBoldSign();
    const provider = new BoldSignSigningProvider({ apiKey: 'bs-key', baseUrl: 'https://api.boldsign.com' }, fake.fetchImpl, () => Date.parse('2026-11-19T10:00:00Z'));
    const { envelopeId } = await provider.createEnvelope(request());
    await provider.embeddedSigningUrl(envelopeId, 'seller@x.test', 'https://app.pactlab.test/back');
    const link = fake.requests.at(-1)!.url;
    expect(link.pathname).toBe('/v1/document/getEmbeddedSignLink');
    expect(Object.fromEntries(link.searchParams)).toEqual({ documentId: envelopeId, signerEmail: 'seller@x.test', redirectUrl: 'https://app.pactlab.test/back', signLinkValidTill: '2026-11-19T10:10:00.000Z' });
  });

  it('reads an opened envelope as delivered and passes the decline reason through', async () => {
    const fake = fakeBoldSign();
    const provider = new BoldSignSigningProvider({ apiKey: 'bs-key', baseUrl: 'https://api.boldsign.com' }, fake.fetchImpl);
    const { envelopeId } = await provider.createEnvelope(request());
    fake.documents.get(envelopeId)!.viewed = true;
    expect(await provider.status(envelopeId)).toEqual({ status: 'DELIVERED', reason: null });
    Object.assign(fake.documents.get(envelopeId)!, { status: 'Declined', declineMessage: 'Price is wrong' });
    expect(await provider.status(envelopeId)).toEqual({ status: 'DECLINED', reason: 'Price is wrong' });
  });

  it('maps a refused key and a rejected request to distinct errors, and refuses a non-https base', async () => {
    const fake = fakeBoldSign();
    await expect(new BoldSignSigningProvider({ apiKey: 'wrong', baseUrl: 'https://api.boldsign.com' }, fake.fetchImpl).status('x')).rejects.toMatchObject({ kind: 'AUTH' });
    await expect(new BoldSignSigningProvider({ apiKey: 'bs-key', baseUrl: 'https://api.boldsign.com' }, fake.fetchImpl).embeddedSigningUrl('nope', 'a@x.test', 'https://x')).rejects.toMatchObject({ kind: 'REJECTED' });
    expect(() => new BoldSignSigningProvider({ apiKey: 'k', baseUrl: 'http://api.boldsign.com' })).toThrow();
  });
});

describe('BoldSign webhooks (T-136)', () => {
  const secret = 'whsec-test';
  const body = (eventType: string, data: Record<string, unknown> = {}) => Buffer.from(JSON.stringify({ event: { id: `evt-${eventType}`, created: 1_763_546_400, eventType, environment: 'Test' }, data: { object: 'document', documentId: 'bs-doc-1', status: 'Completed', ...data } }));
  const sign = (raw: Buffer, t: number, key = secret) => `t=${t}, s0=${createHmac('sha256', key).update(`${t}.${raw.toString()}`).digest('hex')}`;
  const now = 1_763_546_400_000;
  const webhook = new BoldSignWebhook(secret);

  it('accepts the documented signature (hex HMAC of "t.body"), under s0 or s1, within five minutes', () => {
    const raw = body('Completed');
    expect(webhook.verify(raw, { 'x-boldsign-signature': sign(raw, now / 1000) }, now)).toBe(true);
    const rolled = `t=${now / 1000}, s0=${'0'.repeat(64)}, s1=${sign(raw, now / 1000).split('s0=')[1]}`;
    expect(webhook.verify(raw, { 'X-BoldSign-Signature': rolled }, now)).toBe(true);
  });

  it('refuses a changed body, another key, a stale timestamp, no header and no secret', () => {
    const raw = body('Completed');
    const header = sign(raw, now / 1000);
    expect(webhook.verify(Buffer.from(`${raw.toString()} `), { 'x-boldsign-signature': header }, now)).toBe(false);
    expect(webhook.verify(raw, { 'x-boldsign-signature': sign(raw, now / 1000, 'other') }, now)).toBe(false);
    expect(webhook.verify(raw, { 'x-boldsign-signature': header }, now + 301_000)).toBe(false);
    expect(webhook.verify(raw, {}, now)).toBe(false);
    expect(new BoldSignWebhook('').verify(raw, { 'x-boldsign-signature': header }, now)).toBe(false);
  });

  it('answers the endpoint check and reduces document events to what Pactlab records', () => {
    expect(webhook.isPing({ 'x-boldsign-event': 'Verification' })).toBe(true);
    expect(webhook.parse(body('Completed'))).toEqual({ eventId: 'evt-Completed', envelopeId: 'bs-doc-1', status: 'COMPLETED', reason: null });
    expect(webhook.parse(body('Viewed'))?.status).toBe('DELIVERED');
    expect(webhook.parse(body('Expired'))?.status).toBe('EXPIRED');
    expect(webhook.parse(body('Declined', { signerDetails: [{ signerEmail: 'seller@x.test', status: 'Declined', declineMessage: 'Not these terms' }] }))).toMatchObject({ status: 'DECLINED', reason: 'Not these terms' });
    expect(webhook.parse(body('Revoked', { revokeMessage: 'Superseded' }))).toMatchObject({ status: 'VOIDED', reason: 'Superseded' });
    expect(webhook.parse(body('SendFailed', { signerDetails: null, errorMessage: 'Unable to find the text tag' }))).toMatchObject({ status: 'VOIDED', reason: 'BoldSign could not send it: Unable to find the text tag' });
    expect(webhook.parse(body('Sent'))).toBeNull();
    expect(webhook.parse(body('Signed'))).toBeNull();
    expect(webhook.parse(Buffer.from('not json'))).toBeNull();
  });
});

describe('DocuSign OAuth (T-107)', () => {
  it('builds the authorization URL for the signature scope', () => {
    const url = new URL(new DocuSignOAuth(app).authorizeUrl('https://app.pactlab.test/settings/docusign/callback', 'state-1'));
    expect(url.origin + url.pathname).toBe('https://account-d.docusign.com/oauth/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({ response_type: 'code', scope: 'signature', client_id: 'ik-test', redirect_uri: 'https://app.pactlab.test/settings/docusign/callback', state: 'state-1' });
  });

  it('exchanges the code with Basic auth and reads the default account', async () => {
    const { fetchImpl, requests } = scripted({
      '/oauth/token': { status: 200, body: { access_token: 'at', refresh_token: 'rt', expires_in: 28800, token_type: 'Bearer' } },
      '/oauth/userinfo': { status: 200, body: { accounts: [{ account_id: 'a2', account_name: 'Other', base_uri: 'https://na3.docusign.net', is_default: false }, { account_id: 'a1', account_name: 'Charlie Capital', base_uri: 'https://demo.docusign.net', is_default: true }] } },
    });
    const oauth = new DocuSignOAuth(app, fetchImpl, () => 1_000);
    expect(await oauth.exchangeCode('code-1')).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresAt: 1_000 + 28_800_000 });
    expect(requests[0]?.headers['authorization']).toBe(`Basic ${Buffer.from('ik-test:secret-test').toString('base64')}`);
    expect(requests[0]?.body).toBe('grant_type=authorization_code&code=code-1');
    expect(await oauth.defaultAccount('at')).toEqual({ accountId: 'a1', accountName: 'Charlie Capital', baseUri: 'https://demo.docusign.net' });
    await oauth.refresh('rt');
    expect(requests.at(-1)?.body).toBe('grant_type=refresh_token&refresh_token=rt');
  });

  it('refuses unknown auth hosts and accounts outside docusign.net', async () => {
    expect(() => new DocuSignOAuth({ ...app, authHost: 'evil.example' })).toThrow();
    const { fetchImpl } = scripted({ '/oauth/userinfo': { status: 200, body: { accounts: [{ account_id: 'a', account_name: 'x', base_uri: 'https://evil.example', is_default: true }] } } });
    await expect(new DocuSignOAuth(app, fetchImpl).defaultAccount('at')).rejects.toThrow();
  });
});

describe('DocuSign envelopes (T-107)', () => {
  it('sends base64 documents to both signers in order, with anchored sign-here tabs', async () => {
    const { fetchImpl, requests } = scripted({ '/accounts/a1/envelopes': { status: 201, body: { envelopeId: ENVELOPE, status: 'sent' } } });
    const provider = new DocuSignSigningProvider({ accountId: 'a1', accountName: 'C', baseUri: 'https://demo.docusign.net' }, async () => 'at', fetchImpl);
    const result = await provider.createEnvelope({
      emailSubject: 'Project Troubled: sign the agreed terms (v2)',
      documents: [{ name: 'Term sheet v2.pdf', fileExtension: 'pdf', bytes: new Uint8Array([37, 80, 68, 70]) }],
      signers: [{ email: 'lead@charlie.example', name: 'Lead', anchor: signHereMarker(1) }, { email: 'seller@x.test', name: 'Seller', anchor: signHereMarker(2) }],
    });
    expect(result).toEqual({ envelopeId: ENVELOPE });
    expect(requests[0]?.url).toBe('https://demo.docusign.net/restapi/v2.1/accounts/a1/envelopes');
    const body = JSON.parse(requests[0]?.body ?? '{}');
    expect(body).toMatchObject({ status: 'sent', documents: [{ documentId: '1', name: 'Term sheet v2.pdf', fileExtension: 'pdf', documentBase64: 'JVBERg==' }] });
    expect(body.recipients.signers.map((signer: { routingOrder: string; tabs: { signHereTabs: { anchorString: string }[] } }) => [signer.routingOrder, signer.tabs.signHereTabs[0]?.anchorString])).toEqual([['1', '{{sign|1|*}}'], ['2', '{{sign|2|*}}']]);
  });

  it('maps an expired authorization and a rejection to distinct errors', async () => {
    const account = { accountId: 'a1', accountName: 'C', baseUri: 'https://demo.docusign.net' };
    const expired = new DocuSignSigningProvider(account, async () => 'at', scripted({ '/envelopes': { status: 401, body: {} } }).fetchImpl);
    await expect(expired.createEnvelope({ emailSubject: 's', documents: [], signers: [] })).rejects.toMatchObject({ kind: 'AUTH' });
    const rejected = new DocuSignSigningProvider(account, async () => 'at', scripted({ '/envelopes': { status: 400, body: { errorCode: 'INVALID' } } }).fetchImpl);
    await expect(rejected.createEnvelope({ emailSubject: 's', documents: [], signers: [] })).rejects.toMatchObject({ kind: 'REJECTED' });
  });
});

describe('DocuSign Connect (T-107)', () => {
  const body = Buffer.from(JSON.stringify({ event: 'envelope-completed', apiVersion: 'v2.1', data: { accountId: 'a1', envelopeId: ENVELOPE } }));
  const signature = createHmac('sha256', 'connect-key').update(body).digest('base64');

  it('accepts a body signed with the HMAC key, under any signature header, and nothing else', () => {
    expect(verifyDocuSignConnect('connect-key', body, { 'x-docusign-signature-2': signature })).toBe(true);
    expect(verifyDocuSignConnect('connect-key', Buffer.from(`${body.toString()} `), { 'x-docusign-signature-1': signature })).toBe(false);
    expect(verifyDocuSignConnect('other-key', body, { 'x-docusign-signature-1': signature })).toBe(false);
    expect(verifyDocuSignConnect('', body, { 'x-docusign-signature-1': signature })).toBe(false);
    expect(verifyDocuSignConnect('connect-key', body, {})).toBe(false);
    expect(new DocuSignWebhook('connect-key').verify(body, { 'x-docusign-signature-1': signature })).toBe(true);
  });

  it('reduces events to the outcomes Pactlab records, keyed by event and envelope', () => {
    expect(parseDocuSignConnect(body)).toEqual({ eventId: `envelope-completed:${ENVELOPE}`, envelopeId: ENVELOPE, status: 'COMPLETED', reason: null });
    expect(parseDocuSignConnect(Buffer.from(JSON.stringify({ event: 'envelope-sent', data: { envelopeId: ENVELOPE } })))).toBeNull();
    expect(parseDocuSignConnect(Buffer.from('not json'))).toBeNull();
  });
});

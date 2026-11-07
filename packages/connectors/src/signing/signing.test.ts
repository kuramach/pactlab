import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../http/cassette';
import { DocuSignOAuth, DocuSignSigningProvider, FixtureSigningProvider, parseDocuSignConnect, verifyDocuSignConnect } from './index';

const app = { integrationKey: 'ik-test', clientSecret: 'secret-test', authHost: 'account-d.docusign.com' };
const ENVELOPE = '4b7e9a2c-1f3d-4c1a-9b2e-0a1b2c3d4e5f';

/** Records requests and answers from a script; no network. */
function scripted(responses: Record<string, { status: number; body: unknown }>) {
  const requests: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    requests.push({ url, method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body });
    const key = Object.keys(responses).find((path) => url.endsWith(path));
    const reply = key ? responses[key]! : { status: 404, body: {} };
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, requests };
}

describe('fixture signing provider (T-107)', () => {
  it('completes once every signer has signed', async () => {
    const provider = new FixtureSigningProvider();
    const { envelopeId } = await provider.createEnvelope({ emailSubject: 'Sign', documents: [{ name: 'Term sheet.pdf', fileExtension: 'pdf', bytes: new Uint8Array([1]) }], signers: [{ email: 'Buyer@x.test', name: 'B', anchor: '/b/' }, { email: 'seller@x.test', name: 'S', anchor: '/s/' }] });
    expect(provider.sign(envelopeId, 'buyer@x.test')).toBe('SENT');
    expect(() => provider.sign(envelopeId, 'stranger@x.test')).toThrow();
    expect(provider.sign(envelopeId, 'seller@x.test')).toBe('COMPLETED');
    expect(await provider.status(envelopeId)).toBe('COMPLETED');
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
      signers: [{ email: 'lead@charlie.example', name: 'Lead', anchor: '/pl-buyer/' }, { email: 'seller@x.test', name: 'Seller', anchor: '/pl-seller/' }],
    });
    expect(result).toEqual({ envelopeId: ENVELOPE });
    expect(requests[0]?.url).toBe('https://demo.docusign.net/restapi/v2.1/accounts/a1/envelopes');
    const body = JSON.parse(requests[0]?.body ?? '{}');
    expect(body).toMatchObject({ status: 'sent', documents: [{ documentId: '1', name: 'Term sheet v2.pdf', fileExtension: 'pdf', documentBase64: 'JVBERg==' }] });
    expect(body.recipients.signers.map((signer: { routingOrder: string; tabs: { signHereTabs: { anchorString: string }[] } }) => [signer.routingOrder, signer.tabs.signHereTabs[0]?.anchorString])).toEqual([['1', '/pl-buyer/'], ['2', '/pl-seller/']]);
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
  });

  it('reduces events to the outcomes Pactlab records', () => {
    expect(parseDocuSignConnect(body)).toEqual({ envelopeId: ENVELOPE, status: 'COMPLETED' });
    expect(parseDocuSignConnect(Buffer.from(JSON.stringify({ event: 'envelope-sent', data: { envelopeId: ENVELOPE } })))).toBeNull();
    expect(parseDocuSignConnect(Buffer.from('not json'))).toBeNull();
  });
});

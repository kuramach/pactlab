import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FixtureLineMessenger } from './fixture.adapter';
import { LineMessagingApi, parseLineEvents, verifyLineSignature } from './line.adapter';
import { ChannelSendError } from './types';

type Call = { url: string; init: RequestInit };
const USER = `U${'a'.repeat(32)}`;
const options = { channelSecret: 'line-secret', channelAccessToken: 'line-token', loginChannelId: '1234567890', loginChannelSecret: 'login-secret', basicId: '@pactlab' };

/** Answers each documented endpoint the way LINE's reference describes. */
function stub(calls: Call[], overrides: Record<string, { status?: number; body: unknown }> = {}) {
  const defaults: Record<string, { status?: number; body: unknown }> = {
    '/oauth2/v2.1/token': { body: { access_token: 'at', id_token: 'it', token_type: 'Bearer', expires_in: 2592000, scope: 'profile openid' } },
    '/oauth2/v2.1/verify': { body: { iss: 'https://access.line.me', sub: USER, aud: '1234567890', nonce: 'n-1' } },
    '/friendship/v1/status': { body: { friendFlag: true } },
    '/v2/bot/message/push': { body: { sentMessages: [{ id: '1', quoteToken: 'q' }] } },
    '/v2/bot/message/reply': { body: { sentMessages: [{ id: '2', quoteToken: 'q' }] } },
    '/v2/bot/message/quota': { body: { type: 'limited', value: 200 } },
    '/v2/bot/message/quota/consumption': { body: { totalUsage: 37 } },
  };
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const answer = overrides[new URL(url).pathname] ?? defaults[new URL(url).pathname] ?? { status: 404, body: {} };
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}
const json = (call: Call | undefined) => JSON.parse(String(call?.init.body)) as Record<string, unknown>;
const form = (call: Call | undefined) => Object.fromEntries(new URLSearchParams(String(call?.init.body)));

describe('LINE adapter (T-182)', () => {
  it('builds the LINE Login URL with PKCE S256, the openid and profile scopes and the add-friend prompt', () => {
    const url = new URL(new LineMessagingApi(options).authorizeUrl({ state: 's', nonce: 'n', codeChallenge: 'c', redirectUri: 'https://app.pactlab.ai/settings/profile/line/callback' }));
    expect(url.origin + url.pathname).toBe('https://access.line.me/oauth2/v2.1/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: '1234567890',
      redirect_uri: 'https://app.pactlab.ai/settings/profile/line/callback',
      state: 's',
      scope: 'openid profile',
      nonce: 'n',
      bot_prompt: 'aggressive',
      code_challenge: 'c',
      code_challenge_method: 'S256',
    });
  });

  it('completes LINE Login: token with the verifier, ID token verified with the nonce, then the friendship status', async () => {
    const calls: Call[] = [];
    const result = await new LineMessagingApi({ ...options, fetch: stub(calls) }).completeLogin({ code: 'code-1', codeVerifier: 'v-1', nonce: 'n-1', redirectUri: 'https://app/cb' });
    expect(result).toEqual({ userId: USER, friend: true });
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(['/oauth2/v2.1/token', '/oauth2/v2.1/verify', '/friendship/v1/status']);
    expect(form(calls[0])).toEqual({ grant_type: 'authorization_code', code: 'code-1', redirect_uri: 'https://app/cb', client_id: '1234567890', client_secret: 'login-secret', code_verifier: 'v-1' });
    expect(form(calls[1])).toEqual({ id_token: 'it', client_id: '1234567890', nonce: 'n-1' });
    expect((calls[2]?.init.headers as Record<string, string>).authorization).toBe('Bearer at');
    expect(calls.every((call) => call.init.redirect === 'manual')).toBe(true);
  });

  it('refuses an ID token for another channel or nonce, and reports refusals by status only', async () => {
    const wrongAud = stub([], { '/oauth2/v2.1/verify': { body: { sub: USER, aud: '999', nonce: 'n-1' } } });
    await expect(new LineMessagingApi({ ...options, fetch: wrongAud }).completeLogin({ code: 'c', codeVerifier: 'v', nonce: 'n-1', redirectUri: 'r' })).rejects.toThrow('LineLoginVerifyMismatch');
    const refused = stub([], { '/oauth2/v2.1/token': { status: 400, body: { error: 'invalid_grant', error_description: 'secret detail' } } });
    const error = await new LineMessagingApi({ ...options, fetch: refused }).completeLogin({ code: 'c', codeVerifier: 'v', nonce: 'n', redirectUri: 'r' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChannelSendError);
    expect((error as Error).message).toBe('LineLoginToken400');
  });

  it('pushes and replies one text message with the channel access token', async () => {
    const calls: Call[] = [];
    const api = new LineMessagingApi({ ...options, fetch: stub(calls) });
    await api.push(USER, 'Pactlab: hello');
    await api.reply('reply_token-1', 'Pactlab: hi');
    expect(calls[0]?.url).toBe('https://api.line.me/v2/bot/message/push');
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe('Bearer line-token');
    expect(json(calls[0])).toEqual({ to: USER, messages: [{ type: 'text', text: 'Pactlab: hello' }] });
    expect(json(calls[1])).toEqual({ replyToken: 'reply_token-1', messages: [{ type: 'text', text: 'Pactlab: hi' }] });
    await expect(api.push('not-a-user', 'x')).rejects.toMatchObject({ recipientGone: true });
  });

  it("reads this month's usage and the account's target limit", async () => {
    expect(await new LineMessagingApi({ ...options, fetch: stub([]) }).monthlyUsage()).toEqual({ used: 37, accountLimit: 200 });
    const none = stub([], { '/v2/bot/message/quota': { body: { type: 'none' } } });
    expect(await new LineMessagingApi({ ...options, fetch: none }).monthlyUsage()).toEqual({ used: 37, accountLimit: null });
  });

  it('verifies x-line-signature over the raw body and rejects a bad one', () => {
    const body = Buffer.from('{"destination":"U0","events":[]}');
    const signature = createHmac('sha256', 'line-secret').update(body).digest('base64');
    const api = new LineMessagingApi(options);
    expect(api.verifySignature(body, new Headers({ 'x-line-signature': signature }))).toBe(true);
    expect(api.verifySignature(Buffer.from('{}'), new Headers({ 'x-line-signature': signature }))).toBe(false);
    expect(verifyLineSignature('other-secret', body, signature)).toBe(false);
    expect(api.verifySignature(body, new Headers())).toBe(false);
  });

  it('reads follow and unfollow from one-on-one chats and ignores the rest', () => {
    const body = {
      destination: 'Ubot',
      events: [
        { type: 'follow', replyToken: 'rt1', source: { type: 'user', userId: USER }, follow: { isUnblocked: false } },
        { type: 'unfollow', source: { type: 'user', userId: USER } },
        { type: 'message', replyToken: 'rt2', source: { type: 'user', userId: USER }, message: { type: 'text', text: 'hi' } },
        { type: 'follow', source: { type: 'group', groupId: 'C1' } },
      ],
    };
    expect(parseLineEvents(Buffer.from(JSON.stringify(body)))).toEqual([{ kind: 'FOLLOW', userId: USER, replyToken: 'rt1' }, { kind: 'UNFOLLOW', userId: USER }, { kind: 'IGNORED' }, { kind: 'IGNORED' }]);
    expect(parseLineEvents(Buffer.from('not json'))).toEqual([]);
  });

  it('the fixture keeps the Pactlab sender, counts pushes, and refuses past its limit as LINE does', async () => {
    const line = new FixtureLineMessenger();
    line.accountLimit = 1;
    await line.push(USER, 'Pactlab: one');
    await expect(line.push(USER, 'Pactlab: two')).rejects.toThrow('LinePush429');
    await line.reply('rt', 'Pactlab: reply');
    expect(line.outbox.map((m) => [m.kind, m.sender, m.text.startsWith('Pactlab:')])).toEqual([
      ['PUSH', 'Pactlab', true],
      ['REPLY', 'Pactlab', true],
    ]);
    expect(await line.monthlyUsage()).toEqual({ used: 1, accountLimit: 1 });
  });
});

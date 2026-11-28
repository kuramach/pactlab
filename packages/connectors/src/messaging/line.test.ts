import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FixtureLineChannel } from './fixture.adapter';
import {
  LINE_MONTHLY_LIMIT,
  LineApi,
  parseLineEvents,
  pkceChallenge,
  verifyLineSignature,
} from './line.adapter';
import { ChannelSendError } from './types';

type Call = { url: string; init: RequestInit };
const USER = 'U0123456789abcdef0123456789abcdef';
const options = {
  channelAccessToken: 'line-token',
  channelSecret: 'line-secret',
  loginChannelId: '1650000000',
  loginChannelSecret: 'login-secret',
  addFriendUrl: 'https://lin.ee/fixture',
};

/** Answers each request with the next queued response, recording what was sent. */
function stub(calls: Call[], responses: { status: number; body: unknown }[]) {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}
const form = (call: Call | undefined) =>
  Object.fromEntries(new URLSearchParams(String(call?.init.body)));
const headers = (call: Call | undefined) => call?.init.headers as Record<string, string>;

describe('LINE Messaging API and LINE Login adapter (T-182)', () => {
  it('pushes one text message with the bearer token and the retry key', async () => {
    const calls: Call[] = [];
    await new LineApi({
      ...options,
      fetch: stub(calls, [{ status: 200, body: { sentMessages: [] } }]),
    }).push(USER, 'Pactlab: hello', '0190a000-0000-7000-8000-000000000001');
    expect(calls[0]?.url).toBe('https://api.line.me/v2/bot/message/push');
    expect(headers(calls[0])).toMatchObject({
      authorization: 'Bearer line-token',
      'content-type': 'application/json',
      'x-line-retry-key': '0190a000-0000-7000-8000-000000000001',
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      to: USER,
      messages: [{ type: 'text', text: 'Pactlab: hello' }],
    });
  });

  it('treats an accepted retry key (409) as sent, and the monthly limit (429) as its own error', async () => {
    await expect(
      new LineApi({
        ...options,
        fetch: stub([], [{ status: 409, body: { message: 'The retry key is already accepted' } }]),
      }).push(USER, 'x', 'k'),
    ).resolves.toBeUndefined();
    const limit = await new LineApi({
      ...options,
      fetch: stub([], [{ status: 429, body: { message: 'You have reached your monthly limit.' } }]),
    })
      .push(USER, 'x', 'k')
      .catch((e: unknown) => e);
    expect(limit).toBeInstanceOf(ChannelSendError);
    expect((limit as ChannelSendError).errorClass).toBe(LINE_MONTHLY_LIMIT);
    const rate = await new LineApi({
      ...options,
      fetch: stub(
        [],
        [
          {
            status: 429,
            body: { message: 'The API rate limit has been exceeded. Try again later.' },
          },
        ],
      ),
    })
      .push(USER, 'x', 'k')
      .catch((e: unknown) => e);
    expect((rate as ChannelSendError).errorClass).toBe('Line429');
    // Never a push to something that is not a LINE user id, and never the provider's text in an error.
    await expect(new LineApi(options).push('not-a-user', 'x', 'k')).rejects.toMatchObject({
      errorClass: 'LineBadRecipient',
    });
  });

  it('replies with the reply token (replies do not count toward the allowance)', async () => {
    const calls: Call[] = [];
    await new LineApi({ ...options, fetch: stub(calls, [{ status: 200, body: {} }]) }).reply(
      'reply-token',
      'Pactlab: connected',
    );
    expect(calls[0]?.url).toBe('https://api.line.me/v2/bot/message/reply');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      replyToken: 'reply-token',
      messages: [{ type: 'text', text: 'Pactlab: connected' }],
    });
  });

  it('builds the LINE Login authorize URL with state, nonce, PKCE S256 and bot_prompt', () => {
    const url = new URL(
      new LineApi(options).authorizeUrl({
        state: 'state_1',
        nonce: 'nonce_1',
        codeChallenge: pkceChallenge('verifier'),
        redirectUri: 'https://app.pactlab.ai/settings/profile/line/callback',
        locale: 'ja',
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe('https://access.line.me/oauth2/v2.1/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: '1650000000',
      redirect_uri: 'https://app.pactlab.ai/settings/profile/line/callback',
      state: 'state_1',
      scope: 'profile openid',
      nonce: 'nonce_1',
      bot_prompt: 'aggressive',
      code_challenge: pkceChallenge('verifier'),
      code_challenge_method: 'S256',
      ui_locales: 'ja',
    });
    // S256: Base64URL (no padding) of the verifier's SHA-256.
    expect(pkceChallenge('verifier')).toBe(
      createHash('sha256').update('verifier').digest('base64url'),
    );
    expect(pkceChallenge('verifier')).not.toMatch(/[+/=]/);
  });

  it('completes LINE Login: token, ID token verified with the nonce, then the friendship status', async () => {
    const calls: Call[] = [];
    const api = new LineApi({
      ...options,
      fetch: stub(calls, [
        {
          status: 200,
          body: {
            access_token: 'user-access',
            id_token: 'id.token.jwt',
            token_type: 'Bearer',
            expires_in: 2592000,
          },
        },
        {
          status: 200,
          body: { iss: 'https://access.line.me', sub: USER, aud: '1650000000', nonce: 'nonce_1' },
        },
        { status: 200, body: { friendFlag: false } },
      ]),
    });
    expect(
      await api.completeLogin({
        code: 'code_1',
        redirectUri: 'https://app/cb',
        codeVerifier: 'verifier',
        nonce: 'nonce_1',
      }),
    ).toEqual({ userId: USER, isFriend: false });
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.line.me/oauth2/v2.1/token',
      'https://api.line.me/oauth2/v2.1/verify',
      'https://api.line.me/friendship/v1/status',
    ]);
    expect(headers(calls[0])['content-type']).toBe('application/x-www-form-urlencoded');
    expect(form(calls[0])).toEqual({
      grant_type: 'authorization_code',
      code: 'code_1',
      redirect_uri: 'https://app/cb',
      client_id: '1650000000',
      client_secret: 'login-secret',
      code_verifier: 'verifier',
    });
    expect(form(calls[1])).toEqual({
      id_token: 'id.token.jwt',
      client_id: '1650000000',
      nonce: 'nonce_1',
    });
    expect(headers(calls[2])).toMatchObject({ authorization: 'Bearer user-access' });
  });

  it('refuses an ID token for another channel or nonce', async () => {
    for (const claims of [
      { iss: 'https://access.line.me', sub: USER, aud: '999', nonce: 'nonce_1' },
      { iss: 'https://access.line.me', sub: USER, aud: '1650000000', nonce: 'other' },
      { iss: 'https://evil.example', sub: USER, aud: '1650000000', nonce: 'nonce_1' },
      { iss: 'https://access.line.me', sub: 'not-a-user', aud: '1650000000', nonce: 'nonce_1' },
    ]) {
      const api = new LineApi({
        ...options,
        fetch: stub(
          [],
          [
            { status: 200, body: { access_token: 'a', id_token: 'i' } },
            { status: 200, body: claims },
            { status: 200, body: { friendFlag: true } },
          ],
        ),
      });
      await expect(
        api.completeLogin({
          code: 'c',
          redirectUri: 'https://app/cb',
          codeVerifier: 'v',
          nonce: 'nonce_1',
        }),
      ).rejects.toBeInstanceOf(ChannelSendError);
    }
  });

  it('verifies x-line-signature as Base64 HMAC-SHA256 of the raw body with the channel secret', () => {
    const body = Buffer.from('{"destination":"U1","events":[]}');
    const signature = createHmac('sha256', 'line-secret').update(body).digest('base64');
    const api = new LineApi(options);
    expect(api.verifySignature(body, new Headers({ 'X-Line-Signature': signature }))).toBe(true);
    expect(
      api.verifySignature(
        Buffer.from('{"destination":"U1","events":[] }'),
        new Headers({ 'x-line-signature': signature }),
      ),
    ).toBe(false);
    expect(api.verifySignature(body, new Headers())).toBe(false);
    expect(verifyLineSignature('other-secret', body, signature)).toBe(false);
  });

  it('reads follow and unfollow from users only; anything else is ignored', () => {
    const events = [
      { type: 'follow', mode: 'active', source: { type: 'user', userId: USER }, replyToken: 'r1' },
      { type: 'follow', mode: 'standby', source: { type: 'user', userId: USER }, replyToken: 'r2' },
      { type: 'unfollow', source: { type: 'user', userId: USER } },
      { type: 'follow', source: { type: 'user' }, replyToken: 'r3' },
      { type: 'follow', source: { type: 'group', groupId: 'C1', userId: USER } },
      {
        type: 'message',
        source: { type: 'user', userId: USER },
        message: { type: 'text', text: 'hi' },
      },
    ];
    expect(parseLineEvents(Buffer.from(JSON.stringify({ destination: 'U1', events })))).toEqual([
      { kind: 'FOLLOW', userId: USER, replyToken: 'r1' },
      { kind: 'FOLLOW', userId: USER, replyToken: null },
      { kind: 'UNFOLLOW', userId: USER },
      { kind: 'IGNORED' },
      { kind: 'IGNORED' },
      { kind: 'IGNORED' },
    ]);
    expect(parseLineEvents(Buffer.from('not json'))).toEqual([]);
  });

  it('reads the monthly quota and its consumption', async () => {
    const calls: Call[] = [];
    const api = new LineApi({
      ...options,
      fetch: stub(calls, [
        { status: 200, body: { type: 'limited', value: 200 } },
        { status: 200, body: { totalUsage: 42 } },
      ]),
    });
    expect(await api.quota()).toEqual({ limit: 200, used: 42 });
    expect(calls.map((call) => call.url).sort()).toEqual([
      'https://api.line.me/v2/bot/message/quota',
      'https://api.line.me/v2/bot/message/quota/consumption',
    ]);
  });

  it('refuses a misconfigured channel at start', () => {
    expect(() => new LineApi({ ...options, loginChannelId: 'abc' })).toThrow();
    expect(() => new LineApi({ ...options, addFriendUrl: 'http://lin.ee/x' })).toThrow();
  });
});

describe('fixture LINE channel (T-182)', () => {
  it('checks PKCE and the nonce as LINE does, and stops at its monthly limit', async () => {
    const line = new FixtureLineChannel();
    line.authorizeUrl({
      state: 's',
      nonce: 'n',
      codeChallenge: pkceChallenge('v'),
      redirectUri: 'https://app/cb',
    });
    line.addLogin('c1', USER, true);
    await expect(
      line.completeLogin({
        code: 'c1',
        redirectUri: 'https://app/cb',
        codeVerifier: 'wrong',
        nonce: 'n',
      }),
    ).rejects.toBeInstanceOf(ChannelSendError);
    expect(
      await line.completeLogin({
        code: 'c1',
        redirectUri: 'https://app/cb',
        codeVerifier: 'v',
        nonce: 'n',
      }),
    ).toEqual({ userId: USER, isFriend: true });
    line.monthlyLimit = 1;
    await line.push(USER, 'Pactlab: one', 'k1');
    // The same retry key again is the same message.
    await line.push(USER, 'Pactlab: one', 'k1');
    await expect(line.push(USER, 'Pactlab: two', 'k2')).rejects.toMatchObject({
      errorClass: LINE_MONTHLY_LIMIT,
    });
    expect(line.outbox).toHaveLength(1);
    expect(line.outbox[0]).toMatchObject({ sender: 'Pactlab', via: 'PUSH' });
  });
});

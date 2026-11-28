import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LineApi, parseLineEvents, safeAddFriendUrl, verifyLineSignature } from './line.adapter';
import type { ChannelSendError } from './types';

type Call = { url: string; init: RequestInit };
const USER = `U${'4'.repeat(32)}`;
const KEY = '0193a5b2-7c4d-7e8f-9a0b-1c2d3e4f5a6b';
const options = { channelSecret: 'channel-secret', channelAccessToken: 'access-token', loginChannelId: '1234567890', loginChannelSecret: 'login-secret' };
function stub(calls: Call[], responses: { status?: number; body?: unknown }[]) {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift() ?? {};
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

describe('LINE Messaging API adapter (T-182)', () => {
  it('pushes a text message as documented, with the retry key and no redirect following', async () => {
    const calls: Call[] = [];
    const line = new LineApi({ ...options, fetch: stub(calls, [{}]) });
    await line.push(USER, 'Pactlab: hello', KEY);
    expect(calls[0]?.url).toBe('https://api.line.me/v2/bot/message/push');
    expect(calls[0]?.init.redirect).toBe('manual');
    expect(calls[0]?.init.headers).toMatchObject({ authorization: 'Bearer access-token', 'x-line-retry-key': KEY, 'content-type': 'application/json' });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ to: USER, messages: [{ type: 'text', text: 'Pactlab: hello' }] });
  });

  it('treats an already-accepted retry as sent, and the monthly limit as its own class', async () => {
    await new LineApi({ ...options, fetch: stub([], [{ status: 409, body: { message: 'The retry key is already accepted' } }]) }).push(USER, 'x', KEY);
    const limit = await new LineApi({ ...options, fetch: stub([], [{ status: 429, body: { message: 'You have reached your monthly limit.' } }]) }).push(USER, 'x', KEY).catch((e: unknown) => e);
    expect((limit as ChannelSendError).errorClass).toBe('LineMonthlyLimit');
    const rate = await new LineApi({ ...options, fetch: stub([], [{ status: 429, body: { message: 'Too Many Requests' } }]) }).push(USER, 'x', KEY).catch((e: unknown) => e);
    expect((rate as ChannelSendError).errorClass).toBe('Line429');
    // A refusal never carries the user ID or the provider text.
    const refused = await new LineApi({ ...options, fetch: stub([], [{ status: 400, body: { message: `bad ${USER}` } }]) }).push(USER, 'x', KEY).catch((e: unknown) => e);
    expect((refused as Error).message).toBe('Line400');
    await expect(new LineApi({ ...options, fetch: stub([], []) }).push('not-a-user', 'x', KEY)).rejects.toThrow('LineUserIdInvalid');
  });

  it('replies with the reply token (not counted toward the allowance)', async () => {
    const calls: Call[] = [];
    await new LineApi({ ...options, fetch: stub(calls, [{}]) }).reply('reply-token', 'Pactlab: hi');
    expect(calls[0]?.url).toBe('https://api.line.me/v2/bot/message/reply');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ replyToken: 'reply-token', messages: [{ type: 'text', text: 'Pactlab: hi' }] });
    expect(calls[0]?.init.headers).not.toHaveProperty('x-line-retry-key');
  });

  it('verifies x-line-signature as the Base64 HMAC-SHA256 of the raw body', () => {
    const body = Buffer.from('{"destination":"U0","events":[]}');
    const good = createHmac('sha256', 'channel-secret').update(body).digest('base64');
    expect(verifyLineSignature('channel-secret', body, good)).toBe(true);
    expect(verifyLineSignature('other-secret', body, good)).toBe(false);
    expect(verifyLineSignature('channel-secret', Buffer.from(`${body.toString()} `), good)).toBe(false);
    expect(verifyLineSignature('channel-secret', body, null)).toBe(false);
    expect(new LineApi(options).verifySignature(body, new Headers({ 'X-Line-Signature': good }))).toBe(true);
  });

  it('reads follow, unfollow and text events from one-to-one chats only', () => {
    const body = Buffer.from(
      JSON.stringify({
        destination: `U${'f'.repeat(32)}`,
        events: [
          { type: 'follow', mode: 'active', replyToken: 'r1', source: { type: 'user', userId: USER } },
          { type: 'unfollow', mode: 'active', source: { type: 'user', userId: USER } },
          { type: 'message', mode: 'active', replyToken: 'r2', source: { type: 'user', userId: USER }, message: { type: 'text', text: 'STOP' } },
          { type: 'follow', mode: 'standby', replyToken: 'r3', source: { type: 'user', userId: USER } },
          { type: 'message', replyToken: 'r4', source: { type: 'group', groupId: `C${'1'.repeat(32)}`, userId: USER }, message: { type: 'text', text: 'hi' } },
          { type: 'follow', source: { type: 'user', userId: 'not-an-id' } },
        ],
      }),
    );
    expect(parseLineEvents(body)).toEqual([
      { kind: 'FOLLOW', userId: USER, replyToken: 'r1' },
      { kind: 'UNFOLLOW', userId: USER },
      { kind: 'TEXT', userId: USER, text: 'STOP', replyToken: 'r2' },
      { kind: 'FOLLOW', userId: USER, replyToken: null },
      { kind: 'IGNORED' },
      { kind: 'IGNORED' },
    ]);
    expect(parseLineEvents(Buffer.from('not json'))).toEqual([]);
    expect(parseLineEvents(Buffer.from('{"destination":"U0","events":[]}'))).toEqual([]);
  });

  it('builds the LINE Login URL with openid profile and the add-friend screen', () => {
    const url = new URL(new LineApi(options).loginUrl('state-1', 'nonce-1', 'https://app.pactlab.ai/settings/profile/line/callback'));
    expect(url.origin + url.pathname).toBe('https://access.line.me/oauth2/v2.1/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: '1234567890',
      redirect_uri: 'https://app.pactlab.ai/settings/profile/line/callback',
      state: 'state-1',
      scope: 'openid profile',
      nonce: 'nonce-1',
      bot_prompt: 'aggressive',
    });
  });

  it('completes LINE Login: token, verified ID token, then friendship; keeps no token', async () => {
    const calls: Call[] = [];
    const line = new LineApi({
      ...options,
      fetch: stub(calls, [{ body: { access_token: 'at', id_token: 'idt', scope: 'openid profile' } }, { body: { sub: USER, aud: '1234567890', nonce: 'n1' } }, { body: { friendFlag: true } }]),
    });
    expect(await line.completeLogin('code-1', 'https://app.pactlab.ai/cb', 'n1')).toEqual({ userId: USER, friend: true });
    expect(calls.map((call) => call.url)).toEqual(['https://api.line.me/oauth2/v2.1/token', 'https://api.line.me/oauth2/v2.1/verify', 'https://api.line.me/friendship/v1/status']);
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]?.init.body)))).toEqual({ grant_type: 'authorization_code', code: 'code-1', redirect_uri: 'https://app.pactlab.ai/cb', client_id: '1234567890', client_secret: 'login-secret' });
    expect(Object.fromEntries(new URLSearchParams(String(calls[1]?.init.body)))).toEqual({ id_token: 'idt', client_id: '1234567890', nonce: 'n1' });
    expect(calls[2]?.init.headers).toEqual({ authorization: 'Bearer at' });
  });

  it('refuses an ID token for another channel, another nonce or no user ID', async () => {
    const login = (claims: unknown) =>
      new LineApi({ ...options, fetch: stub([], [{ body: { access_token: 'at', id_token: 'idt' } }, { body: claims }, { body: { friendFlag: true } }]) }).completeLogin('c', 'https://x.test/cb', 'n1');
    await expect(login({ sub: USER, aud: '999', nonce: 'n1' })).rejects.toThrow('LineLoginClaims');
    await expect(login({ sub: USER, aud: '1234567890', nonce: 'n2' })).rejects.toThrow('LineLoginClaims');
    await expect(login({ aud: '1234567890', nonce: 'n1' })).rejects.toThrow('LineLoginClaims');
  });

  it('accepts only LINE add-friend links', () => {
    expect(safeAddFriendUrl('https://lin.ee/abc')).toBe('https://lin.ee/abc');
    expect(safeAddFriendUrl('https://line.me/R/ti/p/@pactlab')).toBe('https://line.me/R/ti/p/@pactlab');
    expect(safeAddFriendUrl('http://lin.ee/abc')).toBeNull();
    expect(safeAddFriendUrl('https://evil.example/lin.ee')).toBeNull();
    expect(() => new LineApi({ ...options, addFriendUrl: 'https://evil.example' })).toThrow(/LINE_ADD_FRIEND_URL/);
  });
});

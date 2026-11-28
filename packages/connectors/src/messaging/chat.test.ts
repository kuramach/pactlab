import { createHmac } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { CHAT_BRAND, slackAppManifest, teamsAppManifest } from './chat-manifests';
import { withRateLimit } from './chat-common';
import { FixtureSlackApp, FixtureTeamsBot } from './fixture.adapter';
import { parseSlackInbound, SLACK_BOT_SCOPES, SlackWebApi, verifySlackSignature } from './slack.adapter';
import { BotFrameworkTeamsBot, parseTeamsActivity, safeServiceUrl } from './teams.adapter';
import { ChannelSendError, type ChatMessage } from './types';

const SIGNING = 'test-signing-secret';
const TENANT = '11111111-2222-4333-8444-555555555555';
const AAD = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SERVICE = 'https://smba.trafficmanager.net/emea/';
const APP_ID = '00000000-0000-4000-8000-00000000a11d';

const signed = (body: string, at = Math.floor(Date.now() / 1000)) => {
  const headers = new Headers({ 'x-slack-request-timestamp': String(at) });
  headers.set('x-slack-signature', `v0=${createHmac('sha256', SIGNING).update(`v0:${at}:${body}`).digest('hex')}`);
  return headers;
};
const bytes = (text: string) => new TextEncoder().encode(text);

/** A fetch that answers from a queue and records each request. */
function scripted(...answers: (() => Response)[]) {
  const calls: { url: string; body: string; headers: Headers }[] = [];
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? ''), headers: new Headers(init?.headers) });
    const next = answers.shift();
    if (!next) throw new Error('unexpected request');
    return next();
  }) as typeof fetch;
  return { fetcher, calls };
}
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => () => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('Slack (T-181)', () => {
  it('verifies the v0 signature and refuses a stale or altered request', () => {
    const body = '{"type":"url_verification","challenge":"abc"}';
    expect(verifySlackSignature(SIGNING, bytes(body), signed(body))).toBe(true);
    expect(verifySlackSignature(SIGNING, bytes(`${body} `), signed(body))).toBe(false);
    expect(verifySlackSignature(SIGNING, bytes(body), signed(body, Math.floor(Date.now() / 1000) - 600))).toBe(false);
    expect(verifySlackSignature('other', bytes(body), signed(body))).toBe(false);
  });

  it('reads events and interactions, and ignores anything else', () => {
    expect(parseSlackInbound(bytes('{"type":"url_verification","challenge":"c1"}'), 'application/json')).toEqual({ kind: 'URL_VERIFICATION', challenge: 'c1' });
    expect(parseSlackInbound(bytes('{"type":"event_callback","team_id":"T1","event":{"type":"app_uninstalled"}}'), 'application/json')).toEqual({ kind: 'UNINSTALLED', teamId: 'T1' });
    expect(parseSlackInbound(bytes('{"type":"event_callback","team_id":"T1","event":{"type":"tokens_revoked","tokens":{"bot":["B1"]}}}'), 'application/json')).toEqual({ kind: 'TOKENS_REVOKED', teamId: 'T1' });
    expect(parseSlackInbound(bytes('{"type":"event_callback","team_id":"T1","event":{"type":"tokens_revoked","tokens":{"oauth":["U1"]}}}'), 'application/json')).toEqual({ kind: 'IGNORED' });
    const action = (id: string, value?: string) => `payload=${encodeURIComponent(JSON.stringify({ type: 'block_actions', team: { id: 'T1' }, user: { id: 'U1' }, actions: [{ action_id: id, value }] }))}`;
    expect(parseSlackInbound(bytes(action('pactlab_confirm', 'tok_abcdefghijklmnop')), 'application/x-www-form-urlencoded')).toEqual({ kind: 'CONFIRM', teamId: 'T1', userId: 'U1', value: 'tok_abcdefghijklmnop' });
    expect(parseSlackInbound(bytes(action('pactlab_disconnect')), 'application/x-www-form-urlencoded')).toEqual({ kind: 'DISCONNECT', teamId: 'T1', userId: 'U1' });
    expect(parseSlackInbound(bytes('not json'), 'application/json')).toEqual({ kind: 'IGNORED' });
  });

  it('installs with the least-privilege bot scopes only, and refuses a workspace that granted less', async () => {
    const app = new SlackWebApi({ clientId: 'c', clientSecret: 's', signingSecret: SIGNING, fetch: scripted(json({ ok: true, access_token: 'xoxb-1', scope: 'chat:write', team: { id: 'T1', name: 'W' } })).fetcher });
    expect(new URL(app.installUrl('state', 'https://app.test/cb')).searchParams.get('scope')).toBe('chat:write,im:write,users:read,users:read.email');
    await expect(app.exchangeCode('code', 'https://app.test/cb')).rejects.toMatchObject({ errorClass: 'SlackScopesMissing' });
  });

  it('sends into the direct message the bot opened, never a channel, with no unfurl', async () => {
    const { fetcher, calls } = scripted(json({ ok: true, channel: { id: 'D123' } }), json({ ok: true }));
    const app = new SlackWebApi({ clientId: 'c', clientSecret: 's', signingSecret: SIGNING, fetch: fetcher });
    const message: ChatMessage = { text: 'Pactlab: A pact needs you.', action: { kind: 'LINK', label: 'Open Pactlab', url: 'https://app.test/notifications' } };
    await app.sendDirect('xoxb-1', 'U1', message);
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(['/api/conversations.open', '/api/chat.postMessage']);
    const post = new URLSearchParams(calls[1]!.body);
    expect(post.get('channel')).toBe('D123');
    expect(post.get('unfurl_links')).toBe('false');
    expect(calls[1]!.headers.get('authorization')).toBe('Bearer xoxb-1');
    // A conversation that is not a DM is refused before anything is posted.
    const channel = new SlackWebApi({ clientId: 'c', clientSecret: 's', signingSecret: SIGNING, fetch: scripted(json({ ok: true, channel: { id: 'C123' } })).fetcher });
    await expect(channel.sendDirect('xoxb-1', 'U1', message)).rejects.toMatchObject({ errorClass: 'SlackNotDirect' });
  });

  it('a missing member is null; a gone member is marked gone; errors never quote Slack', async () => {
    const app = new SlackWebApi({ clientId: 'c', clientSecret: 's', signingSecret: SIGNING, fetch: scripted(json({ ok: false, error: 'users_not_found' }), json({ ok: false, error: 'user_not_found' }), json({ ok: true, channel: { id: 'D12' } }), json({ ok: false, error: 'bad thing with "quotes"' })).fetcher });
    expect(await app.lookupUserByEmail('xoxb-1', 'a@b.test')).toBeNull();
    await expect(app.sendDirect('xoxb-1', 'U1', { text: 'x', action: null })).rejects.toMatchObject({ errorClass: 'Slack_user_not_found', recipientGone: true });
    await expect(app.sendDirect('xoxb-1', 'U1', { text: 'x', action: null })).rejects.toMatchObject({ errorClass: 'Slack_badthingwithquotes' });
  });

  it('respects Retry-After once, and gives up on a long or second rate limit', async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    const ok = await withRateLimit('Slack', scripted(json({}, 429, { 'retry-after': '2' }), json({ ok: true })).fetcher.bind(null, 'https://x.test'), { sleep });
    expect(ok.status).toBe(200);
    expect(waits).toEqual([2000]);
    await expect(withRateLimit('Slack', scripted(json({}, 429, { 'retry-after': '120' })).fetcher.bind(null, 'https://x.test'), { sleep })).rejects.toMatchObject({ errorClass: 'Slack429' });
    await expect(withRateLimit('Teams', scripted(json({}, 429, { 'retry-after': '1' }), json({}, 429, { 'retry-after': '1' })).fetcher.bind(null, 'https://x.test'), { sleep })).rejects.toMatchObject({ errorClass: 'Teams429' });
  });

  it('the fixture app records the Block Kit payload it would send', async () => {
    const slack = new FixtureSlackApp();
    slack.addWorkspace('code-1', 'T1');
    const install = await slack.exchangeCode('code-1');
    await slack.sendDirect(install.botToken, 'U1', { text: 'Pactlab: hello', action: { kind: 'CONFIRM', label: 'Confirm', value: 'v' } });
    expect(slack.outbox[0]).toMatchObject({ channel: 'SLACK', tenant: 'T1', to: 'U1', sender: 'Pactlab' });
    await slack.revoke(install.botToken);
    await expect(slack.sendDirect(install.botToken, 'U1', { text: 'x', action: null })).rejects.toBeInstanceOf(ChannelSendError);
  });
});

describe('Microsoft Teams (T-181)', () => {
  const activity = (overrides: Record<string, unknown> = {}) => ({
    type: 'installationUpdate',
    action: 'add',
    channelId: 'msteams',
    serviceUrl: SERVICE,
    from: { id: '29:member', aadObjectId: AAD },
    conversation: { id: 'a:personal-1', conversationType: 'personal', tenantId: TENANT },
    ...overrides,
  });

  it('verifies the Bot Framework JWT: issuer, audience, signature and the serviceUrl claim', async () => {
    const pair = await generateKeyPair('RS256');
    const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }] });
    const bot = new BotFrameworkTeamsBot({ appId: APP_ID, appPassword: 'p', keys });
    const token = (claims: Record<string, unknown>, audience = APP_ID, issuer = 'https://api.botframework.com') =>
      new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
    expect(await bot.verifyInbound(`Bearer ${await token({ serviceurl: SERVICE })}`, activity())).toBe(true);
    expect(await bot.verifyInbound(`Bearer ${await token({ serviceurl: 'https://evil.test/' })}`, activity())).toBe(false);
    expect(await bot.verifyInbound(`Bearer ${await token({ serviceurl: SERVICE }, 'other-app')}`, activity())).toBe(false);
    expect(await bot.verifyInbound(`Bearer ${await token({ serviceurl: SERVICE }, APP_ID, 'https://sts.example')}`, activity())).toBe(false);
    expect(await bot.verifyInbound(null, activity())).toBe(false);
  });

  it('reads personal installs, removals, confirmations and disconnects; ignores channels and groups', () => {
    expect(parseTeamsActivity(activity())).toEqual({ kind: 'INSTALLED', memberId: '29:member', ref: { tenantId: TENANT, aadObjectId: AAD, serviceUrl: SERVICE, conversationId: 'a:personal-1' } });
    expect(parseTeamsActivity(activity({ action: 'remove' }))).toEqual({ kind: 'UNINSTALLED', tenantId: TENANT, aadObjectId: AAD });
    expect(parseTeamsActivity(activity({ type: 'message', value: { pactlab: 'confirm', token: 'tok_abcdefghijklmnop' } }))).toMatchObject({ kind: 'CONFIRM', value: 'tok_abcdefghijklmnop' });
    expect(parseTeamsActivity(activity({ type: 'message', text: 'stop' }))).toMatchObject({ kind: 'DISCONNECT' });
    expect(parseTeamsActivity(activity({ conversation: { id: '19:x', conversationType: 'channel', tenantId: TENANT } }))).toEqual({ kind: 'IGNORED' });
    // A serviceUrl outside the Bot Connector hosts is never stored (SSRF).
    expect(parseTeamsActivity(activity({ serviceUrl: 'https://169.254.169.254/' }))).toEqual({ kind: 'IGNORED' });
    expect(safeServiceUrl('https://smba.trafficmanager.net/amer')).toBe('https://smba.trafficmanager.net/amer/');
    expect(safeServiceUrl('http://smba.trafficmanager.net/amer')).toBeNull();
    expect(safeServiceUrl('https://smba.trafficmanager.net.evil.test/')).toBeNull();
  });

  it('sends a proactive message into the personal chat, with a cached token; a removed app marks the person gone', async () => {
    const { fetcher, calls } = scripted(json({ access_token: 'bf-token', expires_in: 3600 }), json({ id: '1' }, 201), json({}, 403));
    const bot = new BotFrameworkTeamsBot({ appId: APP_ID, appPassword: 'p', fetch: fetcher });
    const ref = { tenantId: TENANT, aadObjectId: AAD, serviceUrl: SERVICE, conversationId: 'a:personal-1' };
    await bot.send(ref, { text: 'Pactlab: A pact needs you.', action: { kind: 'LINK', label: 'Open Pactlab', url: 'https://app.test/notifications' } });
    expect(calls[0]!.url).toBe('https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token');
    expect(new URLSearchParams(calls[0]!.body).get('scope')).toBe('https://api.botframework.com/.default');
    expect(calls[1]!.url).toBe('https://smba.trafficmanager.net/emea/v3/conversations/a%3Apersonal-1/activities');
    expect(calls[1]!.headers.get('authorization')).toBe('Bearer bf-token');
    await expect(bot.send(ref, { text: 'x', action: null })).rejects.toMatchObject({ errorClass: 'Teams403', recipientGone: true });
    expect(calls).toHaveLength(3);
  });

  it('learns the admin tenant from the id token of a Microsoft sign-in', async () => {
    const pair = await generateKeyPair('RS256');
    const idToken = await new SignJWT({ tid: TENANT }).setProtectedHeader({ alg: 'RS256' }).sign(pair.privateKey);
    const bot = new BotFrameworkTeamsBot({ appId: APP_ID, appPassword: 'p', fetch: scripted(json({ id_token: idToken })).fetcher });
    expect(new URL(bot.tenantSignInUrl('s', 'https://app.test/cb')).searchParams.get('scope')).toBe('openid');
    expect(await bot.exchangeTenantCode('code', 'https://app.test/cb')).toEqual({ tenantId: TENANT });
  });

  it('the fixture bot refuses a wrong inbound secret', async () => {
    const teams = new FixtureTeamsBot();
    expect(await teams.verifyInbound('Bearer wrong', activity())).toBe(false);
    expect(await teams.verifyInbound(`Bearer ${teams.inboundSecret}`, activity())).toBe(true);
  });
});

describe('the Slack and Teams app definitions carry Pactlab branding', () => {
  it('Slack: name, tagline, navy background, least-privilege scopes, Pactlab endpoints', () => {
    const manifest = slackAppManifest({ apiOrigin: 'https://app.pactlab.ai', webOrigin: 'https://app.pactlab.ai' });
    expect(manifest.display_information).toEqual({ name: 'Pactlab', description: 'Test the pact before you sign it.', background_color: CHAT_BRAND.navy });
    expect(manifest.features.bot_user.display_name).toBe('Pactlab');
    expect(manifest.oauth_config.scopes.bot).toEqual([...SLACK_BOT_SCOPES]);
    expect(manifest.settings.event_subscriptions.bot_events).toEqual(expect.arrayContaining(['app_uninstalled', 'tokens_revoked']));
  });

  it('Teams: personal bot only, name, colour and outline icons, navy accent', () => {
    const manifest = teamsAppManifest({ botAppId: APP_ID, version: '1.0.0', webOrigin: 'https://app.pactlab.ai' });
    expect(manifest).toMatchObject({ name: { short: 'Pactlab' }, icons: { color: 'color.png', outline: 'outline.png' }, accentColor: '#081127', bots: [{ botId: APP_ID, scopes: ['personal'] }] });
    expect(manifest.description.short).toBe('Test the pact before you sign it.');
  });
});

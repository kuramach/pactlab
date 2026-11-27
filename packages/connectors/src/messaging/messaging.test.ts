import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FixtureTelegramBot, FixtureWhatsAppSender } from './fixture.adapter';
import { TelegramBotApi, parseTelegramUpdate } from './telegram.adapter';
import { ChannelSendError } from './types';
import { WhatsAppCloudApi } from './whatsapp.adapter';

type Call = { url: string; init: RequestInit };
const stub = (calls: Call[], status = 200, body: unknown = { ok: true, result: true }) =>
  (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
const json = (call: Call | undefined) => JSON.parse(String(call?.init.body)) as Record<string, unknown>;

describe('Telegram Bot API adapter (T-180)', () => {
  it('sends a message as the documented sendMessage call, with no link preview', async () => {
    const calls: Call[] = [];
    const bot = new TelegramBotApi({ token: '123:ABC', username: 'PactlabBot', webhookSecret: 'secret_1', fetch: stub(calls) });
    await bot.sendMessage('424242', 'Pactlab: hello');
    expect(calls[0]?.url).toBe('https://api.telegram.org/bot123:ABC/sendMessage');
    expect(json(calls[0])).toEqual({ chat_id: '424242', text: 'Pactlab: hello', link_preview_options: { is_disabled: true }, protect_content: true });
  });

  it('reports a refusal by status only, never the provider text', async () => {
    const bot = new TelegramBotApi({ token: 't', username: 'PactlabBot', webhookSecret: 's', fetch: stub([], 403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user 424242' }) });
    const error = await bot.sendMessage('424242', 'x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChannelSendError);
    expect((error as Error).message).toBe('Telegram403');
  });

  it('sets the bot profile and webhook with the documented methods and limits', async () => {
    const calls: Call[] = [];
    const bot = new TelegramBotApi({ token: 't', username: 'PactlabBot', webhookSecret: 'secret_1', fetch: stub(calls) });
    await bot.setProfile({ name: 'Pactlab', description: 'Test the pact before you sign it.', shortDescription: 'Test the pact before you sign it.' });
    await bot.setWebhook('https://app.pactlab.ai/v1/webhooks/telegram');
    expect(calls.map((call) => call.url.split('/').pop())).toEqual(['setMyName', 'setMyDescription', 'setMyShortDescription', 'setWebhook']);
    expect(json(calls[3])).toEqual({ url: 'https://app.pactlab.ai/v1/webhooks/telegram', secret_token: 'secret_1', allowed_updates: ['message', 'my_chat_member'] });
    await expect(bot.setWebhook('http://insecure.example')).rejects.toThrow(/https/);
  });

  it('checks the secret-token header and refuses a bad secret at start', () => {
    const bot = new TelegramBotApi({ token: 't', username: 'PactlabBot', webhookSecret: 'secret_1' });
    expect(bot.verifyWebhook(new Headers({ 'X-Telegram-Bot-Api-Secret-Token': 'secret_1' }))).toBe(true);
    expect(bot.verifyWebhook(new Headers({ 'X-Telegram-Bot-Api-Secret-Token': 'secret_2' }))).toBe(false);
    expect(bot.verifyWebhook(new Headers())).toBe(false);
    expect(() => new TelegramBotApi({ token: 't', username: 'PactlabBot', webhookSecret: 'has space' })).toThrow();
  });

  it('reads /start <token>, /stop and a block from private chats only', () => {
    const chat = { id: 424242, type: 'private' };
    expect(parseTelegramUpdate({ message: { chat, text: '/start abc_DEF-123' } })).toEqual({ kind: 'START', chatId: '424242', payload: 'abc_DEF-123' });
    expect(parseTelegramUpdate({ message: { chat, text: '/start' } })).toEqual({ kind: 'START', chatId: '424242', payload: null });
    expect(parseTelegramUpdate({ message: { chat, text: '/stop' } })).toEqual({ kind: 'STOP', chatId: '424242' });
    expect(parseTelegramUpdate({ my_chat_member: { chat, new_chat_member: { status: 'kicked' } } })).toEqual({ kind: 'BLOCKED', chatId: '424242' });
    expect(parseTelegramUpdate({ my_chat_member: { chat, new_chat_member: { status: 'member' } } })).toEqual({ kind: 'IGNORED' });
    expect(parseTelegramUpdate({ message: { chat: { id: -100, type: 'group' }, text: '/start x' } })).toEqual({ kind: 'IGNORED' });
    expect(parseTelegramUpdate({ message: { chat, text: '/start <script>' } })).toEqual({ kind: 'IGNORED' });
    expect(parseTelegramUpdate(null)).toEqual({ kind: 'IGNORED' });
  });
});

describe('WhatsApp Cloud API adapter (T-180)', () => {
  const options = { accessToken: 'wa-token', phoneNumberId: '1234567890', appSecret: 'app-secret', verifyToken: 'verify-1', apiVersion: 'v27.0' };

  it('sends the verification code as an authentication template, the code in body and button', async () => {
    const calls: Call[] = [];
    await new WhatsAppCloudApi({ ...options, fetch: stub(calls) }).sendCode('+15555550100', '482913');
    expect(calls[0]?.url).toBe('https://graph.facebook.com/v27.0/1234567890/messages');
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe('Bearer wa-token');
    expect(json(calls[0])).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '15555550100',
      type: 'template',
      template: {
        name: 'pactlab_verify',
        language: { code: 'en' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: '482913' }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '482913' }] },
        ],
      },
    });
  });

  it('sends a notification as a utility template with only the link', async () => {
    const calls: Call[] = [];
    await new WhatsAppCloudApi({ ...options, fetch: stub(calls) }).sendTemplate('+15555550100', 'ACT_NOW', 'https://app.pactlab.ai/notifications');
    expect(json(calls[0]).template).toEqual({ name: 'pactlab_act_now', language: { code: 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'https://app.pactlab.ai/notifications' }] }] });
  });

  it('verifies X-Hub-Signature-256 and the subscription handshake', () => {
    const api = new WhatsAppCloudApi(options);
    const body = Buffer.from('{"object":"whatsapp_business_account"}');
    const signature = `sha256=${createHmac('sha256', 'app-secret').update(body).digest('hex')}`;
    expect(api.verifySignature(body, new Headers({ 'X-Hub-Signature-256': signature }))).toBe(true);
    expect(api.verifySignature(Buffer.from('{}'), new Headers({ 'X-Hub-Signature-256': signature }))).toBe(false);
    expect(api.verifySignature(body, new Headers())).toBe(false);
    expect(api.verifySubscription({ mode: 'subscribe', token: 'verify-1', challenge: '1158201444' })).toBe('1158201444');
    expect(api.verifySubscription({ mode: 'subscribe', token: 'wrong', challenge: '1158201444' })).toBeNull();
  });

  it('reads inbound text messages and skips status updates', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messages: [{ from: '15555550100', id: 'wamid.1', type: 'text', text: { body: 'STOP' } }, { from_user_id: 'US.1', type: 'text', text: { body: 'hi' } }], statuses: [{ id: 'wamid.0', status: 'delivered' }] } }] }],
    };
    expect(new WhatsAppCloudApi(options).parseInbound(Buffer.from(JSON.stringify(payload)))).toEqual([{ from: '+15555550100', text: 'STOP' }]);
    expect(new WhatsAppCloudApi(options).parseInbound(Buffer.from('not json'))).toEqual([]);
  });
});

describe('fixture channels (T-180)', () => {
  it('keep every message with the Pactlab sender, and a blocked chat fails as Telegram would', async () => {
    const bot = new FixtureTelegramBot();
    await bot.sendMessage('1', 'Pactlab: hi');
    expect(bot.outbox).toEqual([{ channel: 'TELEGRAM', to: '1', sender: 'Pactlab', template: null, text: 'Pactlab: hi' }]);
    bot.blocked.add('2');
    await expect(bot.sendMessage('2', 'x')).rejects.toMatchObject({ recipientGone: true });
    const wa = new FixtureWhatsAppSender();
    await wa.sendCode('+15555550100', '111111');
    expect(wa.outbox[0]).toMatchObject({ template: 'VERIFY', sender: 'Pactlab' });
  });
});

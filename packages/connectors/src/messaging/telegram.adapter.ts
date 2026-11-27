import { timingSafeEqual } from 'node:crypto';
import { ChannelSendError, type TelegramBot, type TelegramProfile, type TelegramUpdate } from './types';

/**
 * The Telegram Bot API (core.telegram.org/bots/api, Bot API 10.5, read 2026-11-27):
 * `https://api.telegram.org/bot<token>/METHOD`, JSON `{ ok, result, description, error_code }`.
 * Webhooks carry the secret token in `X-Telegram-Bot-Api-Secret-Token` (1–256 of `A-Za-z0-9_-`).
 * In a private chat `my_chat_member` arrives only when the user blocks or unblocks the bot.
 */
export interface TelegramBotOptions {
  readonly token: string;
  readonly username: string;
  readonly webhookSecret: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

const SECRET = /^[A-Za-z0-9_-]{1,256}$/;

export class TelegramBotApi implements TelegramBot {
  readonly name = 'TELEGRAM' as const;
  readonly username: string;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: TelegramBotOptions) {
    if (!SECRET.test(options.webhookSecret)) throw new Error('TELEGRAM_WEBHOOK_SECRET must be 1-256 of A-Z a-z 0-9 _ -');
    if (!/^[A-Za-z0-9_]{5,32}$/.test(options.username)) throw new Error('TELEGRAM_BOT_USERNAME is not a bot username');
    this.username = options.username;
    this.fetcher = options.fetch ?? fetch;
  }

  private async call(method: string, body: Record<string, unknown>): Promise<unknown> {
    const base = this.options.baseUrl ?? 'https://api.telegram.org';
    let response: Response;
    try {
      response = await this.fetcher(`${base}/bot${this.options.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'manual',
      });
    } catch {
      throw new ChannelSendError('TelegramUnreachable');
    }
    const json = (await response.json().catch(() => null)) as { ok?: boolean; result?: unknown } | null;
    // Never echo the description: it may quote the chat.
    if (!response.ok || json?.ok !== true) throw new ChannelSendError(`Telegram${response.status}`);
    return json.result;
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    // No link preview: the preview card would render the page title on a lock screen.
    await this.call('sendMessage', { chat_id: chatId, text, link_preview_options: { is_disabled: true }, protect_content: true });
  }

  verifyWebhook(headers: Headers): boolean {
    const given = headers.get('x-telegram-bot-api-secret-token') ?? '';
    const expected = Buffer.from(this.options.webhookSecret);
    const actual = Buffer.from(given);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  parseUpdate(body: unknown): TelegramUpdate {
    return parseTelegramUpdate(body);
  }

  async setProfile(profile: TelegramProfile): Promise<void> {
    await this.call('setMyName', { name: profile.name.slice(0, 64) });
    await this.call('setMyDescription', { description: profile.description.slice(0, 512) });
    await this.call('setMyShortDescription', { short_description: profile.shortDescription.slice(0, 120) });
  }

  async setWebhook(url: string): Promise<void> {
    if (!url.startsWith('https://')) throw new Error('the webhook URL must be https');
    await this.call('setWebhook', { url, secret_token: this.options.webhookSecret, allowed_updates: ['message', 'my_chat_member'] });
  }
}

type Chat = { id?: number | string; type?: string };

/** Shared by the live and fixture bots: an Update reduced to START, STOP, BLOCKED or IGNORED. */
export function parseTelegramUpdate(body: unknown): TelegramUpdate {
  if (!body || typeof body !== 'object') return { kind: 'IGNORED' };
  const update = body as {
    message?: { chat?: Chat; text?: string };
    my_chat_member?: { chat?: Chat; new_chat_member?: { status?: string } };
  };
  const chatId = (chat: Chat | undefined) => (chat?.type === 'private' && /^\d{1,20}$/.test(String(chat.id ?? '')) ? String(chat.id) : null);
  const member = update.my_chat_member;
  if (member) {
    const id = chatId(member.chat);
    // A ChatMemberBanned's status is always "kicked": in a private chat, the user blocked the bot.
    return id && member.new_chat_member?.status === 'kicked' ? { kind: 'BLOCKED', chatId: id } : { kind: 'IGNORED' };
  }
  const message = update.message;
  const id = chatId(message?.chat);
  const text = typeof message?.text === 'string' ? message.text.trim() : '';
  if (!id || !text) return { kind: 'IGNORED' };
  const start = /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{1,64}))?$/.exec(text);
  if (start) return { kind: 'START', chatId: id, payload: start[1] ?? null };
  if (/^\/stop(?:@\w+)?$/i.test(text)) return { kind: 'STOP', chatId: id };
  return { kind: 'IGNORED' };
}

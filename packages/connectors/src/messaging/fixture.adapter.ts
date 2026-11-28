import { addFriendUrl, LINE_USER_ID, parseLineEvents, verifyLineSignature } from './line.adapter';
import { parseTelegramUpdate } from './telegram.adapter';
import { ChannelSendError, type LineEvent, type LineLoginResult, type LineMessenger, type LineMonthlyUsage, type TelegramBot, type TelegramProfile, type TelegramUpdate, type WhatsAppInbound, type WhatsAppSender, type WhatsAppTemplate } from './types';
import { parseWhatsAppInbound, verifyMetaSignature, verifyMetaSubscription } from './whatsapp.adapter';

/** One message a fixture channel "sent", kept in memory so tests can assert sender, prefix and wording. */
export interface FixtureMessage {
  readonly channel: 'TELEGRAM' | 'WHATSAPP' | 'LINE';
  readonly to: string;
  readonly sender: 'Pactlab';
  readonly template: WhatsAppTemplate | null;
  readonly text: string;
}

/** Telegram without Telegram: the same parsing and webhook check, messages kept in `outbox`. */
export class FixtureTelegramBot implements TelegramBot {
  readonly name = 'FIXTURE' as const;
  readonly outbox: FixtureMessage[] = [];
  profile: TelegramProfile | null = null;
  webhookUrl: string | null = null;
  /** Chats that "blocked" the bot: sending to them fails as Telegram would. */
  readonly blocked = new Set<string>();

  constructor(
    readonly username = 'PactlabFixtureBot',
    private readonly webhookSecret = 'fixture-telegram-secret',
  ) {}

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (this.blocked.has(chatId)) throw new ChannelSendError('Telegram403', true);
    this.outbox.push({ channel: 'TELEGRAM', to: chatId, sender: 'Pactlab', template: null, text });
  }

  verifyWebhook(headers: Headers): boolean {
    return headers.get('x-telegram-bot-api-secret-token') === this.webhookSecret;
  }

  parseUpdate(body: unknown): TelegramUpdate {
    return parseTelegramUpdate(body);
  }

  async setProfile(profile: TelegramProfile): Promise<void> {
    this.profile = profile;
  }

  async setWebhook(url: string): Promise<void> {
    this.webhookUrl = url;
  }
}

/** WhatsApp without Meta: the same signature check and parsing, messages kept in `outbox`. */
export class FixtureWhatsAppSender implements WhatsAppSender {
  readonly name = 'FIXTURE' as const;
  readonly outbox: FixtureMessage[] = [];

  constructor(
    private readonly appSecret = 'fixture-whatsapp-secret',
    private readonly verifyToken = 'fixture-whatsapp-verify',
    /** The words each template renders, so tests see what a person would read. */
    private readonly render: (template: Exclude<WhatsAppTemplate, 'VERIFY'>, link: string) => string = (_template, link) => link,
  ) {}

  async sendCode(to: string, code: string): Promise<void> {
    this.outbox.push({ channel: 'WHATSAPP', to, sender: 'Pactlab', template: 'VERIFY', text: `${code} is your verification code.` });
  }

  async sendTemplate(to: string, template: Exclude<WhatsAppTemplate, 'VERIFY'>, link: string): Promise<void> {
    this.outbox.push({ channel: 'WHATSAPP', to, sender: 'Pactlab', template, text: this.render(template, link) });
  }

  verifySignature(rawBody: Uint8Array, headers: Headers): boolean {
    return verifyMetaSignature(this.appSecret, rawBody, headers.get('x-hub-signature-256'));
  }

  verifySubscription(query: { mode?: string; token?: string; challenge?: string }): string | null {
    return verifyMetaSubscription(this.verifyToken, query);
  }

  parseInbound(rawBody: Uint8Array): WhatsAppInbound[] {
    return parseWhatsAppInbound(rawBody);
  }
}

/**
 * LINE without LINE: the same signature check and event parsing; LINE Login answers from `logins`
 * (code → result), pushes and replies kept in `outbox`, and the month's usage counted against `accountLimit`.
 */
export class FixtureLineMessenger implements LineMessenger {
  readonly name = 'FIXTURE' as const;
  readonly outbox: (FixtureMessage & { readonly kind: 'PUSH' | 'REPLY' })[] = [];
  /** What a LINE Login code "returns": the test sets it before the callback. */
  readonly logins = new Map<string, LineLoginResult>();
  /** The nonces LINE was asked to check, by code (a test can assert the right one was sent). */
  readonly nonces = new Map<string, string>();
  readonly addFriendUrl: string;
  /** Pushes this month, as LINE would count them. */
  used = 0;
  accountLimit: number | null = 200;
  /** The quota endpoint fails (LINE unreachable). */
  quotaDown = false;

  constructor(
    readonly basicId = '@pactlabfixture',
    private readonly channelSecret = 'fixture-line-secret',
  ) {
    this.addFriendUrl = addFriendUrl(basicId);
  }

  authorizeUrl(input: { state: string; nonce: string; codeChallenge: string; redirectUri: string }): string {
    const url = new URL('https://access.line.me/oauth2/v2.1/authorize');
    url.search = new URLSearchParams({ response_type: 'code', client_id: '1234567890', redirect_uri: input.redirectUri, state: input.state, scope: 'openid profile', nonce: input.nonce, bot_prompt: 'aggressive', code_challenge: input.codeChallenge, code_challenge_method: 'S256' }).toString();
    return url.toString();
  }

  async completeLogin(input: { code: string; codeVerifier: string; nonce: string; redirectUri: string }): Promise<LineLoginResult> {
    const result = this.logins.get(input.code);
    if (!result) throw new ChannelSendError('LineLoginToken400');
    this.logins.delete(input.code);
    this.nonces.set(input.code, input.nonce);
    return result;
  }

  async push(userId: string, text: string): Promise<void> {
    if (!LINE_USER_ID.test(userId)) throw new ChannelSendError('LineBadRecipient', true);
    if (this.accountLimit !== null && this.used >= this.accountLimit) throw new ChannelSendError('LinePush429');
    this.used += 1;
    this.outbox.push({ channel: 'LINE', kind: 'PUSH', to: userId, sender: 'Pactlab', template: null, text });
  }

  async reply(replyToken: string, text: string): Promise<void> {
    this.outbox.push({ channel: 'LINE', kind: 'REPLY', to: replyToken, sender: 'Pactlab', template: null, text });
  }

  async monthlyUsage(): Promise<LineMonthlyUsage> {
    if (this.quotaDown) throw new ChannelSendError('LineQuotaUnreachable');
    return { used: this.used, accountLimit: this.accountLimit };
  }

  verifySignature(rawBody: Uint8Array, headers: Headers): boolean {
    return verifyLineSignature(this.channelSecret, rawBody, headers.get('x-line-signature'));
  }

  parseEvents(rawBody: Uint8Array): LineEvent[] {
    return parseLineEvents(rawBody);
  }
}

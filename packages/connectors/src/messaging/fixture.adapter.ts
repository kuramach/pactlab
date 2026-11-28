import { parseTelegramUpdate } from './telegram.adapter';
import { ChannelSendError, type TelegramBot, type TelegramProfile, type TelegramUpdate, type WhatsAppInbound, type WhatsAppSender, type WhatsAppTemplate } from './types';
import { parseWhatsAppInbound, verifyMetaSignature, verifyMetaSubscription } from './whatsapp.adapter';

/** One message a fixture channel "sent", kept in memory so tests can assert sender, prefix and wording. */
export interface FixtureMessage {
  readonly channel: 'TELEGRAM' | 'WHATSAPP';
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

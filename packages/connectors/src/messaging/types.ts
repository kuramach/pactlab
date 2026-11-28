/**
 * Message channels (T-180, T-182; ADR 0064): Telegram, WhatsApp and LINE behind one seam each, with fixture
 * adapters for tests and local runs. All are off by default. Pact code sees only these types.
 * Handles (chat ids, numbers) are personal data: adapters never log them or put them in errors.
 */

/** A provider refused or failed a message; `errorClass` is safe to store and log (no handle, no text). */
export class ChannelSendError extends Error {
  constructor(
    readonly errorClass: string,
    /** The recipient can no longer be messaged on this channel (e.g. blocked the bot). */
    readonly recipientGone = false,
  ) {
    super(errorClass);
    this.name = 'ChannelSendError';
  }
}

/** What the Telegram webhook tells Pactlab, reduced to what Pactlab acts on. Private chats only. */
export type TelegramUpdate =
  | { readonly kind: 'START'; readonly chatId: string; readonly payload: string | null }
  | { readonly kind: 'STOP'; readonly chatId: string }
  | { readonly kind: 'BLOCKED'; readonly chatId: string }
  | { readonly kind: 'IGNORED' };

export interface TelegramProfile {
  /** setMyName: 0–64 characters. */
  readonly name: string;
  /** setMyDescription: 0–512 characters. */
  readonly description: string;
  /** setMyShortDescription: 0–120 characters. */
  readonly shortDescription: string;
}

export interface TelegramBot {
  readonly name: 'TELEGRAM' | 'FIXTURE';
  /** The bot's username, for the `https://t.me/<bot>?start=<token>` deep link. */
  readonly username: string;
  sendMessage(chatId: string, text: string): Promise<void>;
  /** The secret-token header matches (`X-Telegram-Bot-Api-Secret-Token`). */
  verifyWebhook(headers: Headers): boolean;
  parseUpdate(body: unknown): TelegramUpdate;
  /** Setup (runbook): the bot's name, description and short description, from the brand. */
  setProfile(profile: TelegramProfile): Promise<void>;
  /** Setup (runbook): point the bot's webhook at Pactlab with the secret token. */
  setWebhook(url: string): Promise<void>;
}

/** A message received on WhatsApp, reduced to the sender and its text. */
export interface WhatsAppInbound {
  readonly from: string;
  readonly text: string;
}

/** Template names Meta approves (runbook). Their wording is the shared channel text (`channelMessage`). */
export const WHATSAPP_TEMPLATES = {
  /** AUTHENTICATION, copy-code button: the one-time code that verifies a number. */
  VERIFY: 'pactlab_verify',
  /** UTILITY: "Pactlab: A pact needs you. Open Pactlab to see what: {{1}}". */
  ACT_NOW: 'pactlab_act_now',
  /** UTILITY: "Pactlab: This is a test message. …{{1}}". */
  TEST: 'pactlab_test',
} as const;

export type WhatsAppTemplate = keyof typeof WHATSAPP_TEMPLATES;

export interface WhatsAppSender {
  readonly name: 'WHATSAPP_CLOUD' | 'FIXTURE';
  /** An authentication template carrying the one-time code (body and copy-code button). */
  sendCode(to: string, code: string): Promise<void>;
  /** A utility template with the link as its one parameter. */
  sendTemplate(to: string, template: Exclude<WhatsAppTemplate, 'VERIFY'>, link: string): Promise<void>;
  /** `X-Hub-Signature-256` over the raw body with the app secret. */
  verifySignature(rawBody: Uint8Array, headers: Headers): boolean;
  /** The verification GET: the challenge to echo, or null. */
  verifySubscription(query: { mode?: string; token?: string; challenge?: string }): string | null;
  parseInbound(rawBody: Uint8Array): WhatsAppInbound[];
}

/** What the LINE webhook tells Pactlab, reduced to what Pactlab acts on. One-on-one chats only. */
export type LineEvent =
  | { readonly kind: 'FOLLOW'; readonly userId: string; readonly replyToken: string | null }
  | { readonly kind: 'UNFOLLOW'; readonly userId: string }
  | { readonly kind: 'IGNORED' };

/** A LINE Login result: the person's LINE user id (the ID token's `sub`) and whether they are a friend of the account. */
export interface LineLoginResult {
  readonly userId: string;
  readonly friend: boolean;
}

/** This month's push messages, as LINE counts them (Messaging API quota endpoints). */
export interface LineMonthlyUsage {
  /** Messages sent this month (`totalUsage`), including those sent from LINE Official Account Manager. */
  readonly used: number;
  /** The target limit set on the account (`value` when `type` is `limited`), else null. */
  readonly accountLimit: number | null;
}

export interface LineMessenger {
  readonly name: 'LINE' | 'FIXTURE';
  /** The LINE Login authorization URL: OpenID Connect, PKCE (S256), and the add-friend prompt after consent. */
  authorizeUrl(input: { state: string; nonce: string; codeChallenge: string; redirectUri: string }): string;
  /** Exchange the code, verify the ID token (nonce checked by LINE) and read the friendship status. */
  completeLogin(input: { code: string; codeVerifier: string; nonce: string; redirectUri: string }): Promise<LineLoginResult>;
  /** The URL that opens the account's add-friend screen. */
  readonly addFriendUrl: string;
  /** A push message: counts towards the month's allowance. */
  push(userId: string, text: string): Promise<void>;
  /** A reply to a webhook event (its `replyToken`): does not count towards the allowance. */
  reply(replyToken: string, text: string): Promise<void>;
  monthlyUsage(): Promise<LineMonthlyUsage>;
  /** `x-line-signature`: base64 HMAC-SHA256 of the raw body with the channel secret. */
  verifySignature(rawBody: Uint8Array, headers: Headers): boolean;
  parseEvents(rawBody: Uint8Array): LineEvent[];
}

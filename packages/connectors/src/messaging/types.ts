/**
 * Message channels (T-180, ADR 0064): Telegram and WhatsApp behind one seam each, with fixture
 * adapters for tests and local runs. Both are off by default. Pact code sees only these types.
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

/**
 * Slack and Microsoft Teams (T-181, ADR 0065): a direct message from the Pactlab bot, never a channel
 * post. Workspace and tenant ids, user ids, tokens and conversation references are personal or
 * credential data: adapters never log them or put them in errors.
 */

/** One message for a chat platform: the shared "Pactlab:" words and at most one button. */
export interface ChatMessage {
  readonly text: string;
  readonly action:
    | { readonly kind: 'LINK'; readonly label: string; readonly url: string }
    | { readonly kind: 'CONFIRM'; readonly label: string; readonly value: string }
    | null;
}

/** What Slack's OAuth v2 install gives back: the workspace and its bot token (kept in the secret store). */
export interface SlackInstall {
  readonly teamId: string;
  readonly teamName: string;
  readonly botToken: string;
}

/** What Slack's Events API and interactivity endpoint tell Pactlab, reduced to what Pactlab acts on. */
export type SlackInbound =
  | { readonly kind: 'URL_VERIFICATION'; readonly challenge: string }
  | { readonly kind: 'UNINSTALLED'; readonly teamId: string }
  | { readonly kind: 'TOKENS_REVOKED'; readonly teamId: string }
  | { readonly kind: 'HOME_OPENED'; readonly teamId: string; readonly userId: string }
  | { readonly kind: 'CONFIRM'; readonly teamId: string; readonly userId: string; readonly value: string }
  | { readonly kind: 'DISCONNECT'; readonly teamId: string; readonly userId: string }
  | { readonly kind: 'IGNORED' };

export interface SlackApp {
  readonly name: 'SLACK' | 'FIXTURE';
  /** `https://slack.com/oauth/v2/authorize` with the bot scopes and a signed state. */
  installUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<SlackInstall>;
  /** `auth.revoke` with the bot token (uninstall from Pactlab). */
  revoke(botToken: string): Promise<void>;
  /** `users.lookupByEmail`: the member id, or null when no member has that address. */
  lookupUserByEmail(botToken: string, email: string): Promise<string | null>;
  /** `conversations.open` then `chat.postMessage` into the direct message. */
  sendDirect(botToken: string, userId: string, message: ChatMessage): Promise<void>;
  /** `views.publish`: the app home tab, with Disconnect when the member is linked. */
  publishHome(botToken: string, userId: string, linked: boolean): Promise<void>;
  /** `X-Slack-Signature` (v0 HMAC-SHA256 over `v0:<timestamp>:<body>`) and a timestamp within 5 minutes. */
  verifyRequest(rawBody: Uint8Array, headers: Headers, now?: Date): boolean;
  /** An Events API body (JSON) or an interactivity body (`payload=` form field). */
  parseInbound(rawBody: Uint8Array, contentType: string | null): SlackInbound;
}

/** Where a Teams personal chat with the bot lives: captured when the app is installed for the person. */
export interface TeamsConversationRef {
  readonly tenantId: string;
  readonly aadObjectId: string;
  readonly serviceUrl: string;
  readonly conversationId: string;
}

export type TeamsInbound =
  | { readonly kind: 'INSTALLED'; readonly ref: TeamsConversationRef; readonly memberId: string }
  | { readonly kind: 'UNINSTALLED'; readonly tenantId: string; readonly aadObjectId: string }
  | { readonly kind: 'CONFIRM'; readonly tenantId: string; readonly aadObjectId: string; readonly value: string }
  | { readonly kind: 'DISCONNECT'; readonly tenantId: string; readonly aadObjectId: string }
  | { readonly kind: 'IGNORED' };

export interface TeamsMember {
  readonly aadObjectId: string;
  readonly tenantId: string;
  /** The member's email or user principal name, lower-cased; null when Teams gives neither. */
  readonly email: string | null;
}

export interface TeamsBot {
  readonly name: 'TEAMS' | 'FIXTURE';
  /** The bot's Microsoft App ID: the token audience and the manifest's bot id. */
  readonly appId: string;
  /** Bot Framework JWT on an inbound activity: signature, issuer, audience, expiry and the serviceUrl claim. */
  verifyInbound(authorization: string | null, activity: unknown): Promise<boolean>;
  parseActivity(activity: unknown): TeamsInbound;
  /** Bot Connector `GET /v3/conversations/{id}/members/{memberId}`: the member's email for matching. */
  getMember(ref: TeamsConversationRef, memberId: string): Promise<TeamsMember | null>;
  /** A proactive message into the person's personal chat with the bot. */
  send(ref: TeamsConversationRef, message: ChatMessage): Promise<void>;
  /** The organization admin signs in with Microsoft so Pactlab learns their tenant id (`tid`). */
  tenantSignInUrl(state: string, redirectUri: string): string;
  exchangeTenantCode(code: string, redirectUri: string): Promise<{ readonly tenantId: string }>;
}

/**
 * LINE (T-182, ADR 0066): the Pactlab LINE Official Account, through its Messaging API channel, and a
 * LINE Login channel under the same provider (so both see the same user ID). A LINE user ID is personal
 * data: adapters never log it or put it in errors.
 */

/** What a verified LINE webhook tells Pactlab, reduced to what Pactlab acts on. One-to-one chats only. */
export type LineInbound =
  | { readonly kind: 'FOLLOW'; readonly userId: string; readonly replyToken: string | null }
  | { readonly kind: 'UNFOLLOW'; readonly userId: string }
  | { readonly kind: 'TEXT'; readonly userId: string; readonly text: string; readonly replyToken: string | null }
  | { readonly kind: 'IGNORED' };

/** LINE Login, completed: the person's user ID, and whether they are a friend of the official account now. */
export interface LineLoginResult {
  readonly userId: string;
  readonly friend: boolean;
}

export interface LineBot {
  readonly name: 'LINE' | 'FIXTURE';
  /** The official account's add-friend link, as LINE Official Account Manager shows it (runbook); null when not set. */
  readonly addFriendUrl: string | null;
  /**
   * A push message (counted toward the monthly allowance). `retryKey` is a UUID sent as `X-Line-Retry-Key`,
   * so LINE accepts it at most once. The monthly limit fails as `LineMonthlyLimit`.
   */
  push(userId: string, text: string, retryKey: string): Promise<void>;
  /** A reply to a webhook event (not counted toward the allowance). */
  reply(replyToken: string, text: string): Promise<void>;
  /** `x-line-signature`: Base64 HMAC-SHA256 of the raw body with the channel secret. */
  verifySignature(rawBody: Uint8Array, headers: Headers): boolean;
  parseEvents(rawBody: Uint8Array): LineInbound[];
  /** LINE Login's authorization URL: `openid profile`, the add-friend screen after consent (`bot_prompt=aggressive`). */
  loginUrl(state: string, nonce: string, redirectUri: string): string;
  /** Code → tokens → the verified ID token's `sub`, then the friendship status. No token is kept. */
  completeLogin(code: string, redirectUri: string, nonce: string): Promise<LineLoginResult>;
}

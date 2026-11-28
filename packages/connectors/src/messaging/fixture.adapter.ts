import { lineLoginUrl, parseLineEvents, safeAddFriendUrl, verifyLineSignature } from './line.adapter';
import { parseTelegramUpdate } from './telegram.adapter';
import { plainText } from './chat-common';
import { parseSlackInbound, SLACK_BOT_SCOPES, slackBlocks, verifySlackSignature } from './slack.adapter';
import { parseTeamsActivity, safeServiceUrl, teamsCard } from './teams.adapter';
import {
  ChannelSendError,
  type ChatMessage,
  type LineBot,
  type LineInbound,
  type LineLoginResult,
  type SlackApp,
  type SlackInbound,
  type SlackInstall,
  type TeamsBot,
  type TeamsConversationRef,
  type TeamsInbound,
  type TeamsMember,
  type TelegramBot,
  type TelegramProfile,
  type TelegramUpdate,
  type WhatsAppInbound,
  type WhatsAppSender,
  type WhatsAppTemplate,
} from './types';
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

/** One message a fixture Slack or Teams app "sent": the platform payload, so tests read what Slack or Teams would. */
export interface FixtureChatMessage {
  readonly channel: 'SLACK' | 'TEAMS';
  /** The workspace or tenant, and the member. */
  readonly tenant: string;
  readonly to: string;
  readonly sender: 'Pactlab';
  readonly message: ChatMessage;
  /** The exact body the live adapter would send (Block Kit, or the Bot Framework activity). */
  readonly payload: unknown;
}

/** Slack without Slack: one workspace per install code, members by email, messages in `outbox`. */
export class FixtureSlackApp implements SlackApp {
  readonly name = 'FIXTURE' as const;
  readonly outbox: FixtureChatMessage[] = [];
  readonly homes: { teamId: string; userId: string; linked: boolean }[] = [];
  readonly revoked: string[] = [];
  /** `code` → the workspace an install with that code joins. */
  readonly workspaces = new Map<string, { teamId: string; teamName: string }>();
  /** `teamId` → email → member id. */
  readonly members = new Map<string, Map<string, string>>();
  /** Members who "left": sending to them fails as Slack would. */
  readonly gone = new Set<string>();
  /** The next send fails with a 429 this many times. */
  rateLimited = 0;

  constructor(private readonly signingSecret = 'fixture-slack-signing-secret') {}

  addWorkspace(code: string, teamId: string, teamName = 'Fixture workspace'): void {
    this.workspaces.set(code, { teamId, teamName });
    if (!this.members.has(teamId)) this.members.set(teamId, new Map());
  }

  addMember(teamId: string, email: string, userId: string): void {
    this.members.get(teamId)?.set(email.toLowerCase(), userId);
  }

  private teamOf(botToken: string): string {
    const match = /^xoxb-fixture-([A-Z0-9]+)$/.exec(botToken);
    if (!match?.[1] || this.revoked.includes(botToken)) throw new ChannelSendError('Slack_token_revoked');
    return match[1];
  }

  installUrl(state: string, redirectUri: string): string {
    const url = new URL('https://slack.fixture.test/oauth/v2/authorize');
    url.searchParams.set('scope', SLACK_BOT_SCOPES.join(','));
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<SlackInstall> {
    const workspace = this.workspaces.get(code);
    if (!workspace) throw new ChannelSendError('Slack_invalid_code');
    return { ...workspace, botToken: `xoxb-fixture-${workspace.teamId}` };
  }

  async revoke(botToken: string): Promise<void> {
    this.revoked.push(botToken);
  }

  async lookupUserByEmail(botToken: string, email: string): Promise<string | null> {
    return this.members.get(this.teamOf(botToken))?.get(email.toLowerCase()) ?? null;
  }

  async sendDirect(botToken: string, userId: string, message: ChatMessage): Promise<void> {
    const teamId = this.teamOf(botToken);
    if (this.gone.has(userId)) throw new ChannelSendError('Slack_user_not_found', true);
    if (this.rateLimited > 0) {
      this.rateLimited -= 1;
      throw new ChannelSendError('Slack429');
    }
    this.outbox.push({ channel: 'SLACK', tenant: teamId, to: userId, sender: 'Pactlab', message, payload: { text: plainText(message), blocks: slackBlocks(message) } });
  }

  async publishHome(botToken: string, userId: string, linked: boolean): Promise<void> {
    this.homes.push({ teamId: this.teamOf(botToken), userId, linked });
  }

  verifyRequest(rawBody: Uint8Array, headers: Headers, now?: Date): boolean {
    return verifySlackSignature(this.signingSecret, rawBody, headers, now);
  }

  parseInbound(rawBody: Uint8Array, contentType: string | null): SlackInbound {
    return parseSlackInbound(rawBody, contentType);
  }
}

/** Teams without Microsoft: a shared bearer secret stands for the Bot Framework JWT; members by id; messages in `outbox`. */
export class FixtureTeamsBot implements TeamsBot {
  readonly name = 'FIXTURE' as const;
  readonly appId = '00000000-0000-4000-8000-00000000b075';
  readonly outbox: FixtureChatMessage[] = [];
  /** `tenant:aad` → email. */
  readonly members = new Map<string, string>();
  /** `code` → tenant id an admin's sign-in returns. */
  readonly signIns = new Map<string, string>();
  readonly gone = new Set<string>();

  constructor(readonly inboundSecret = 'fixture-teams-inbound') {}

  addMember(tenantId: string, aadObjectId: string, email: string): void {
    this.members.set(`${tenantId}:${aadObjectId}`, email.toLowerCase());
  }

  async verifyInbound(authorization: string | null, activity: unknown): Promise<boolean> {
    const serviceUrl = (activity as { serviceUrl?: unknown } | null)?.serviceUrl;
    return authorization === `Bearer ${this.inboundSecret}` && typeof serviceUrl === 'string';
  }

  parseActivity(activity: unknown): TeamsInbound {
    return parseTeamsActivity(activity);
  }

  async getMember(ref: TeamsConversationRef): Promise<TeamsMember | null> {
    const email = this.members.get(`${ref.tenantId}:${ref.aadObjectId}`);
    return email ? { aadObjectId: ref.aadObjectId, tenantId: ref.tenantId, email } : null;
  }

  async send(ref: TeamsConversationRef, message: ChatMessage): Promise<void> {
    if (!safeServiceUrl(ref.serviceUrl)) throw new ChannelSendError('TeamsServiceUrlRefused');
    if (this.gone.has(ref.aadObjectId)) throw new ChannelSendError('Teams403', true);
    this.outbox.push({
      channel: 'TEAMS',
      tenant: ref.tenantId,
      to: ref.aadObjectId,
      sender: 'Pactlab',
      message,
      payload: { type: 'message', text: plainText(message), attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: teamsCard(message) }] },
    });
  }

  tenantSignInUrl(state: string, redirectUri: string): string {
    const url = new URL('https://login.fixture.test/organizations/oauth2/v2.0/authorize');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeTenantCode(code: string): Promise<{ tenantId: string }> {
    const tenantId = this.signIns.get(code);
    if (!tenantId) throw new ChannelSendError('TeamsSignIn400');
    return { tenantId };
  }
}

/** One message the fixture LINE account "sent": a push (counted) or a reply (free), with its exact body. */
export interface FixtureLineMessage {
  readonly kind: 'PUSH' | 'REPLY';
  /** The user ID for a push; the reply token for a reply. */
  readonly to: string;
  readonly sender: 'Pactlab';
  readonly text: string;
  /** The exact JSON body the live adapter would send. */
  readonly payload: { readonly to?: string; readonly replyToken?: string; readonly messages: readonly { readonly type: 'text'; readonly text: string }[] };
  readonly retryKey: string | null;
}

/** LINE without LINE: the same signature check and parsing; logins by code; friends; messages in `outbox`. */
export class FixtureLineBot implements LineBot {
  readonly name = 'FIXTURE' as const;
  readonly addFriendUrl: string | null;
  readonly outbox: FixtureLineMessage[] = [];
  /** `code` → the LINE user a LINE Login with that code signs in as. */
  readonly logins = new Map<string, string>();
  /** Users who are friends of the official account (and have not blocked it). */
  readonly friends = new Set<string>();
  /** LINE answers 429 "You have reached your monthly limit." while this is set. */
  monthlyLimitReached = false;
  private readonly acceptedRetryKeys = new Set<string>();

  constructor(
    readonly channelSecret = 'fixture-line-channel-secret',
    addFriendUrl = 'https://lin.ee/fixturePactlab',
  ) {
    this.addFriendUrl = safeAddFriendUrl(addFriendUrl);
  }

  async push(userId: string, text: string, retryKey: string): Promise<void> {
    if (this.acceptedRetryKeys.has(retryKey)) return;
    if (this.monthlyLimitReached) throw new ChannelSendError('LineMonthlyLimit');
    // LINE does not deliver to a user who blocked the account (and does not count it); Pactlab hears of it by `unfollow`.
    if (!this.friends.has(userId)) throw new ChannelSendError('Line400');
    this.acceptedRetryKeys.add(retryKey);
    this.outbox.push({ kind: 'PUSH', to: userId, sender: 'Pactlab', text, payload: { to: userId, messages: [{ type: 'text', text }] }, retryKey });
  }

  async reply(replyToken: string, text: string): Promise<void> {
    this.outbox.push({ kind: 'REPLY', to: replyToken, sender: 'Pactlab', text, payload: { replyToken, messages: [{ type: 'text', text }] }, retryKey: null });
  }

  verifySignature(rawBody: Uint8Array, headers: Headers): boolean {
    return verifyLineSignature(this.channelSecret, rawBody, headers.get('x-line-signature'));
  }

  parseEvents(rawBody: Uint8Array): LineInbound[] {
    return parseLineEvents(rawBody);
  }

  loginUrl(state: string, nonce: string, redirectUri: string): string {
    return lineLoginUrl('https://access.line.fixture.test', '1234567890', state, nonce, redirectUri);
  }

  async completeLogin(code: string): Promise<LineLoginResult> {
    const userId = this.logins.get(code);
    if (!userId) throw new ChannelSendError('LineLoginToken400');
    return { userId, friend: this.friends.has(userId) };
  }
}

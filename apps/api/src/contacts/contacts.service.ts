import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { ForbiddenException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import type { ContactProfileView, LineAllowanceView, LineCallbackBody, LineCallbackView, LineLinkView, MaskedMemberContactView, Page, TelegramLinkView, WhatsAppStartBody } from '@pactlab/contracts';
import { contactDispatch, contacts, type PrismaClient } from '@pactlab/db';
import { channelMessage, CHANNEL_ABOUT, CHANNEL_SENDER, isStopWord, lineMessage, normalizeEmail, toE164, WHATSAPP_CONSENT_TEXT, type TenantContext } from '@pactlab/domain';
import { ChannelSendError, LINE_MONTHLY_LIMIT, pkceChallenge, type TelegramBot, type WhatsAppSender } from '@pactlab/connectors';
import type { Logger } from '@pactlab/observability';
import type { Principal } from '../auth/auth.guard';
import { keyedHash } from '../email-login/client-address';
import type { EmailSender } from '../email-login/email-sender';
import { LOGGER, PRISMA } from '../tokens';
import type { IdentityEmailSource } from './auth0-userinfo';
import type { LineSettings } from './channels-config';
import { ChatService } from './chat.service';
import { contactEmails } from './contact-emails';

export const CONTACT_SETTINGS = Symbol('CONTACT_SETTINGS');

export interface ContactModuleSettings {
  /** Null: confirmation codes are never delivered (tests inject a recording sender). */
  readonly emailSender: EmailSender | null;
  readonly hashSecret: string;
  /** The web origin links point into. */
  readonly appOrigin: string;
  /** Auth0's `/userinfo` for the verified email claim; null where Auth0 is not configured. */
  readonly identityEmails: IdentityEmailSource | null;
  /** The Telegram bot (T-180): off (null) unless a bot token is set; the fixture outside production. */
  readonly telegram: TelegramBot | null;
  /** WhatsApp: off (null) unless enabled after Kumar's approval (ADR 0064); the fixture in tests. */
  readonly whatsapp: WhatsAppSender | null;
  /** LINE (T-182): off (null) unless the official account and LINE Login channel are configured. */
  readonly line?: LineSettings | null;
}

const CODE_MINUTES = 10;
const LINK_MINUTES = 10;
/** How often an Auth0 person's email claim is looked up while they have none (Auth0 rate-limits /userinfo per user). */
const CLAIM_RETRY_MS = 10 * 60_000;

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const errorClass = (error: unknown) => (error instanceof ChannelSendError ? error.errorClass : error instanceof Error ? error.name : 'unknown');

/**
 * Contact details in the profile (T-180, ADR 0064). A verified email for everyone, Telegram (free, the
 * default phone channel) and WhatsApp (opt-in, paid per message). Every value is personal data: it is
 * never logged, never in an error, never sent to a model; a channel is used only once verified, and
 * the verified state lives in the database. Every message is the shared, content-free template.
 */
@Injectable()
export class ContactsService {
  private readonly claimTried = new Map<string, number>();

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CONTACT_SETTINGS) private readonly settings: ContactModuleSettings,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(ChatService) private readonly chat: ChatService,
  ) {}

  private codeHash(tenant: TenantContext, kind: 'EMAIL' | 'WHATSAPP', code: string): string {
    return keyedHash(this.settings.hashSecret, `contact:${kind}:${tenant.userId}:${code}`);
  }

  /** LINE Login's nonce and PKCE verifier come from the state with the server's key: nothing more is stored. */
  private lineSecret(purpose: 'nonce' | 'pkce', state: string): string {
    return createHmac('sha256', this.settings.hashSecret).update(`line:${purpose}:${state}`, 'utf8').digest('base64url');
  }

  /** A keyed hash of a LINE user id: what is kept between LINE Login and the friend being added. */
  private lineUserHash(userId: string): string {
    return keyedHash(this.settings.hashSecret, `line:user:${userId}`);
  }

  private lineRedirect(): string {
    return this.link('/settings/profile/line/callback');
  }

  private link(path: string): string {
    return new URL(path, this.settings.appOrigin).toString();
  }

  /**
   * Auth0 and SSO sign-in: store the identity provider's email when, and only when, it says
   * `email_verified: true`. Once a person has an address, nothing here changes it.
   */
  async syncIdentityEmail(tenant: TenantContext, principal: Principal, accessToken: string | null): Promise<void> {
    if (principal.issuer !== 'AUTH0' || !accessToken || !this.settings.identityEmails) return;
    const last = this.claimTried.get(tenant.userId) ?? 0;
    if (Date.now() - last < CLAIM_RETRY_MS) return;
    if (await contacts.email(this.prisma, tenant)) return;
    this.claimTried.set(tenant.userId, Date.now());
    const claim = await this.settings.identityEmails.email(accessToken);
    const email = claim?.emailVerified ? normalizeEmail(claim.email) : null;
    if (email) await contacts.storeVerifiedClaim(this.prisma, tenant, email);
  }

  async profile(tenant: TenantContext, principal: Principal, accessToken: string | null): Promise<ContactProfileView> {
    await this.syncIdentityEmail(tenant, principal, accessToken);
    const [email, channels, displayName, chatInstalled, linePending] = await Promise.all([
      contacts.email(this.prisma, tenant),
      contacts.channels(this.prisma, tenant),
      contacts.displayName(this.prisma, tenant),
      this.chat.installed(tenant),
      this.settings.line ? contacts.linePending(this.prisma, tenant) : Promise.resolve(false),
    ]);
    return {
      displayName: displayName ?? '',
      email: email ? { address: email.email, verified: true, source: email.source } : null,
      askForEmail: !email,
      channels: channels.map((channel) => ({
        id: channel.id,
        kind: channel.kind,
        // The person's own profile shows their own number; a Telegram chat id, or a Slack or Teams id, means nothing to them.
        label: channel.kind === 'WHATSAPP' ? channel.handle : 'Connected',
        verifiedAt: channel.verifiedAt.toISOString(),
        consentedAt: channel.consentedAt?.toISOString() ?? null,
      })),
      available: { telegram: this.settings.telegram !== null, whatsapp: this.settings.whatsapp !== null, slack: this.chat.sender.slack !== null, teams: this.chat.sender.teams !== null, line: Boolean(this.settings.line) },
      line: this.settings.line ? { pending: linePending, addFriendUrl: this.settings.line.channel.addFriendUrl } : null,
      chatInstalled,
      whatsappConsentText: WHATSAPP_CONSENT_TEXT,
    };
  }

  /** Send a code to the new address. The current address (if any) is told once the change is confirmed. */
  async startEmail(tenant: TenantContext, input: string): Promise<{ sent: true }> {
    const email = normalizeEmail(input);
    if (!email) throw new UnprocessableEntityException({ code: 'INVALID_EMAIL' });
    const sender = this.settings.emailSender;
    if (!sender) throw new ServiceUnavailableException({ code: 'EMAIL_UNAVAILABLE' });
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const id = await contacts.beginVerification(this.prisma, tenant, { kind: 'EMAIL', target: email, secretHash: this.codeHash(tenant, 'EMAIL', code), minutes: CODE_MINUTES, consentText: null });
    if (!id) throw new HttpException({ code: 'RATE_LIMITED' }, 429);
    try {
      await sender.send(contactEmails.confirmAddress(email, code, CODE_MINUTES));
    } catch (error) {
      // Never the address or the code: the class only.
      this.logger.warn({ verificationId: id, errorClass: errorClass(error) }, 'contact email code not delivered');
      throw new ServiceUnavailableException({ code: 'EMAIL_NOT_SENT' });
    }
    return { sent: true };
  }

  async confirmEmail(tenant: TenantContext, code: string): Promise<{ email: string }> {
    const result = await contacts.confirmEmail(this.prisma, tenant, this.codeHash(tenant, 'EMAIL', code));
    if (!result) throw new UnprocessableEntityException({ code: 'INVALID_CODE' });
    if (result.previousEmail && this.settings.emailSender) {
      // handled: the change is confirmed and audited; the notice to the old address is best-effort and logged by class.
      await this.settings.emailSender.send(contactEmails.addressChanged(result.previousEmail, this.link('/settings/profile'))).catch((error: unknown) => {
        this.logger.warn({ errorClass: errorClass(error) }, 'email change notice not delivered');
      });
    }
    return { email: result.email };
  }

  /** A single-use, 10-minute deep link: `https://t.me/<bot>?start=<token>`. Only the token's hash is stored. */
  async telegramLink(tenant: TenantContext): Promise<TelegramLinkView> {
    const bot = this.settings.telegram;
    if (!bot) throw new UnprocessableEntityException({ code: 'TELEGRAM_OFF' });
    // 32 base64url characters: within the deep link's 64 of A-Z a-z 0-9 _ -.
    const token = randomBytes(24).toString('base64url');
    const id = await contacts.beginVerification(this.prisma, tenant, { kind: 'TELEGRAM', target: null, secretHash: sha256(token), minutes: LINK_MINUTES, consentText: null });
    if (!id) throw new HttpException({ code: 'RATE_LIMITED' }, 429);
    return { url: `https://t.me/${bot.username}?start=${token}`, expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000).toISOString() };
  }

  /** The bot's webhook. Verified by its secret header; answers 200 to everything it accepted, so Telegram does not retry. */
  async telegramWebhook(headers: Headers, body: unknown): Promise<{ ok: true }> {
    const bot = this.settings.telegram;
    if (!bot) throw new NotFoundException();
    if (!bot.verifyWebhook(headers)) throw new ForbiddenException();
    const update = bot.parseUpdate(body);
    if (update.kind === 'START') {
      const linked = update.payload ? await contacts.linkTelegram(this.prisma, { secretHash: sha256(update.payload), chatId: update.chatId }) : null;
      await this.say(bot, update.chatId, channelMessage(linked ? 'LINKED' : 'LINK_EXPIRED'));
    } else if (update.kind === 'STOP') {
      if ((await contacts.stop(this.prisma, { kind: 'TELEGRAM', handle: update.chatId, reason: 'STOP' })) > 0) await this.say(bot, update.chatId, channelMessage('STOPPED'));
    } else if (update.kind === 'BLOCKED') {
      await contacts.stop(this.prisma, { kind: 'TELEGRAM', handle: update.chatId, reason: 'BLOCKED' });
    }
    return { ok: true };
  }

  /** Replies in the chat; a failure is logged by class only and never fails the webhook. */
  private async say(bot: TelegramBot, chatId: string, text: string): Promise<void> {
    try {
      await bot.sendMessage(chatId, text);
    } catch (error) {
      this.logger.warn({ errorClass: errorClass(error) }, 'telegram reply not delivered');
    }
  }

  /**
   * Connect LINE (T-182): LINE Login's page. The state is single use for 10 minutes and only its hash is
   * stored; the nonce and PKCE verifier are derived from it with the server's key. `bot_prompt` makes
   * LINE offer the official account as a friend right after consent.
   */
  async lineLink(tenant: TenantContext): Promise<LineLinkView> {
    const line = this.settings.line;
    if (!line) throw new UnprocessableEntityException({ code: 'LINE_OFF' });
    // 32 base64url characters, never URL-encoded (LINE Login requires a state that is not).
    const state = randomBytes(24).toString('base64url');
    const id = await contacts.beginVerification(this.prisma, tenant, { kind: 'LINE', target: null, secretHash: sha256(state), minutes: LINK_MINUTES, consentText: null });
    if (!id) throw new HttpException({ code: 'RATE_LIMITED' }, 429);
    const url = line.channel.authorizeUrl({ state, nonce: this.lineSecret('nonce', state), codeChallenge: pkceChallenge(this.lineSecret('pkce', state)), redirectUri: this.lineRedirect() });
    return { url, expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000).toISOString() };
  }

  /**
   * Back from LINE Login: LINE proves the person's user id (ID token, nonce checked) and says whether they
   * are a friend. A friend is linked now; otherwise the link waits for the follow, holding only a keyed hash.
   */
  async lineCallback(tenant: TenantContext, body: LineCallbackBody): Promise<LineCallbackView> {
    const line = this.settings.line;
    if (!line) throw new UnprocessableEntityException({ code: 'LINE_OFF' });
    let login;
    try {
      login = await line.channel.completeLogin({ code: body.code, redirectUri: this.lineRedirect(), codeVerifier: this.lineSecret('pkce', body.state), nonce: this.lineSecret('nonce', body.state) });
    } catch (error) {
      // Never the code or a token: the class only.
      this.logger.warn({ errorClass: errorClass(error) }, 'line login not completed');
      throw new UnprocessableEntityException({ code: 'LINE_LOGIN_FAILED' });
    }
    const result = await contacts.completeLineLogin(this.prisma, tenant, { stateHash: sha256(body.state), userHash: this.lineUserHash(login.userId), lineUserId: login.userId, isFriend: login.isFriend });
    if (result.status === 'INVALID') throw new UnprocessableEntityException({ code: 'LINE_LINK_EXPIRED' });
    return { status: result.status };
  }

  /**
   * The official account's webhook. Every request is checked against `x-line-signature` first; a bad one is
   * refused (403) and nothing is read. `follow` completes a pending link (and the free reply says so);
   * `unfollow` (the person blocked Pactlab) ends the channel at once. 200 to everything accepted.
   */
  async lineWebhook(rawBody: Uint8Array, headers: Headers): Promise<{ ok: true }> {
    const line = this.settings.line;
    if (!line) throw new NotFoundException();
    if (!line.channel.verifySignature(rawBody, headers)) throw new ForbiddenException();
    for (const event of line.channel.parseEvents(rawBody)) {
      if (event.kind === 'FOLLOW') {
        const linked = await contacts.lineFollow(this.prisma, { userHash: this.lineUserHash(event.userId), lineUserId: event.userId });
        if (linked && event.replyToken) {
          try {
            await line.channel.reply(event.replyToken, lineMessage('LINE_LINKED'));
          } catch (error) {
            this.logger.warn({ errorClass: errorClass(error) }, 'line reply not delivered');
          }
        }
      } else if (event.kind === 'UNFOLLOW') {
        await contacts.stop(this.prisma, { kind: 'LINE', handle: event.userId, reason: 'BLOCKED' });
      }
    }
    return { ok: true };
  }

  /** WhatsApp: the number in E.164, the consent ticked, a code sent over WhatsApp itself. */
  async startWhatsApp(tenant: TenantContext, body: WhatsAppStartBody): Promise<{ sent: true; number: string }> {
    const whatsapp = this.settings.whatsapp;
    if (!whatsapp) throw new UnprocessableEntityException({ code: 'WHATSAPP_OFF' });
    const number = toE164(body.number, body.dial);
    if (!number) throw new UnprocessableEntityException({ code: 'INVALID_NUMBER' });
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const id = await contacts.beginVerification(this.prisma, tenant, { kind: 'WHATSAPP', target: number, secretHash: this.codeHash(tenant, 'WHATSAPP', code), minutes: CODE_MINUTES, consentText: WHATSAPP_CONSENT_TEXT });
    if (!id) throw new HttpException({ code: 'RATE_LIMITED' }, 429);
    try {
      await whatsapp.sendCode(number, code);
    } catch (error) {
      this.logger.warn({ verificationId: id, errorClass: errorClass(error) }, 'whatsapp code not delivered');
      throw new ServiceUnavailableException({ code: 'WHATSAPP_NOT_SENT' });
    }
    return { sent: true, number };
  }

  async confirmWhatsApp(tenant: TenantContext, code: string): Promise<{ channelId: string }> {
    if (!this.settings.whatsapp) throw new UnprocessableEntityException({ code: 'WHATSAPP_OFF' });
    const channelId = await contacts.confirmWhatsApp(this.prisma, tenant, this.codeHash(tenant, 'WHATSAPP', code));
    if (!channelId) throw new UnprocessableEntityException({ code: 'INVALID_CODE' });
    return { channelId };
  }

  /** Meta's subscription handshake: the challenge, echoed, when the verify token matches. */
  whatsappSubscription(query: { mode?: string; token?: string; challenge?: string }): string {
    const challenge = this.settings.whatsapp?.verifySubscription(query) ?? null;
    if (!challenge) throw new ForbiddenException();
    return challenge;
  }

  /** Inbound WhatsApp: STOP ends every message to that number at once (audited in the database). */
  async whatsappWebhook(rawBody: Uint8Array, headers: Headers): Promise<{ ok: true }> {
    const whatsapp = this.settings.whatsapp;
    if (!whatsapp) throw new NotFoundException();
    if (!whatsapp.verifySignature(rawBody, headers)) throw new ForbiddenException();
    for (const message of whatsapp.parseInbound(rawBody)) {
      if (isStopWord(message.text)) await contacts.stop(this.prisma, { kind: 'WHATSAPP', handle: message.from, reason: 'STOP' });
    }
    return { ok: true };
  }

  async disconnect(tenant: TenantContext, channelId: string): Promise<{ disconnected: true }> {
    const channel = await contacts.revoke(this.prisma, tenant, channelId);
    if (!channel) throw new NotFoundException();
    // Telegram messages are free, so the chat hears that it is disconnected; WhatsApp is paid per message, so it does not.
    if (channel.kind === 'TELEGRAM' && this.settings.telegram) await this.say(this.settings.telegram, channel.handle, channelMessage('DISCONNECTED'));
    if (channel.kind === 'SLACK' || channel.kind === 'TEAMS') await this.chat.afterDisconnect(channel.kind, channel.handle);
    return { disconnected: true };
  }

  /** A content-free test message on the person's own channel, at most 3 an hour. */
  async test(tenant: TenantContext, channelId: string): Promise<{ sent: true }> {
    const channel = (await contacts.channels(this.prisma, tenant)).find((row) => row.id === channelId);
    if (!channel) throw new NotFoundException();
    if (channel.kind === 'LINE') return this.lineTest(tenant, channel.id, channel.handle);
    const deliveryId = await contactDispatch.claimTest(this.prisma, tenant, channelId);
    if (!deliveryId) throw new HttpException({ code: 'RATE_LIMITED' }, 429);
    if (channel.kind === 'SLACK' || channel.kind === 'TEAMS') {
      await this.chat.test(tenant, channelId, deliveryId);
      return { sent: true };
    }
    const link = this.link('/settings/profile');
    try {
      if (channel.kind === 'TELEGRAM') {
        if (!this.settings.telegram) throw new ChannelSendError('TelegramOff');
        await this.settings.telegram.sendMessage(channel.handle, channelMessage('TEST', { link }));
      } else {
        if (!this.settings.whatsapp) throw new ChannelSendError('WhatsAppOff');
        await this.settings.whatsapp.sendTemplate(channel.handle, 'TEST', link);
      }
    } catch (error) {
      await contactDispatch.finish(this.prisma, { deliveryId, outcome: 'FAILED', errorClass: errorClass(error) });
      throw new ServiceUnavailableException({ code: 'MESSAGE_NOT_SENT' });
    }
    await contactDispatch.finish(this.prisma, { deliveryId, outcome: 'SENT', errorClass: null });
    return { sent: true };
  }

  /** A LINE test is a push, so it counts toward the month's allowance like any LINE message. */
  private async lineTest(tenant: TenantContext, channelId: string, userId: string): Promise<{ sent: true }> {
    const line = this.settings.line;
    if (!line) throw new UnprocessableEntityException({ code: 'LINE_OFF' });
    const now = new Date();
    const claim = await contactDispatch.claimLine(this.prisma, { channelId, notificationId: null, now, allowance: line.allowance, tenant });
    if (claim.reached) throw new UnprocessableEntityException({ code: 'LINE_ALLOWANCE_REACHED' });
    if (!claim.deliveryId) throw new HttpException({ code: 'RATE_LIMITED' }, 429);
    try {
      await line.channel.push(userId, lineMessage('TEST', { link: this.link('/settings/profile') }), claim.deliveryId);
    } catch (error) {
      await contactDispatch.finish(this.prisma, { deliveryId: claim.deliveryId, outcome: 'FAILED', errorClass: errorClass(error) });
      if (error instanceof ChannelSendError && error.errorClass === LINE_MONTHLY_LIMIT) {
        await contactDispatch.lineAllowanceReached(this.prisma, { now, allowance: line.allowance });
        throw new UnprocessableEntityException({ code: 'LINE_ALLOWANCE_REACHED' });
      }
      throw new ServiceUnavailableException({ code: 'MESSAGE_NOT_SENT' });
    }
    await contactDispatch.finish(this.prisma, { deliveryId: claim.deliveryId, outcome: 'SENT', errorClass: null });
    return { sent: true };
  }

  /**
   * The operator console (T-182): this month's LINE messages against the allowance, and whether it was
   * reached ("LINE monthly allowance reached"). Counts only; LINE's own figures when it answers.
   */
  async lineAllowance(tenant: TenantContext): Promise<LineAllowanceView> {
    const line = this.settings.line;
    let state;
    try {
      state = await contacts.lineAllowance(this.prisma, tenant.userId, new Date());
    } catch (error) {
      if (/\b42501\b|operator required/i.test(String((error as { message?: unknown }).message)) || (error as { code?: unknown }).code === '42501') throw new ForbiddenException();
      throw error;
    }
    let lineReports: LineAllowanceView['lineReports'] = null;
    if (line) {
      // handled: LINE's own count is extra; the console still shows Pactlab's count without it.
      lineReports = await line.channel.quota().catch((error: unknown) => {
        this.logger.warn({ errorClass: errorClass(error) }, 'line quota not read');
        return null;
      });
    }
    return { available: Boolean(line), month: state.month, used: state.used, allowance: line?.allowance ?? 0, reachedAt: state.reachedAt?.toISOString() ?? null, lineReports };
  }

  /** Organization owners and admins: members' contact details, masked; every read audited in the database. */
  async adminPage(tenant: TenantContext, query: { cursor?: string | undefined; limit: number }): Promise<Page<MaskedMemberContactView>> {
    if (tenant.organizationRole !== 'ORG_OWNER' && tenant.organizationRole !== 'ORG_ADMIN') throw new ForbiddenException();
    const page = await contacts.adminPage(this.prisma, tenant, query);
    return {
      ...page,
      items: page.items.map((row) => ({ userId: row.userId, displayName: row.displayName, email: row.emailMasked, emailVerified: row.emailVerified, telegram: row.telegramMasked, whatsapp: row.whatsappMasked })),
    };
  }

  /** The brand every provider holds (runbook): the same name and about line as the emails. */
  static brandProfile() {
    return { name: CHANNEL_SENDER, description: `${CHANNEL_ABOUT} Pactlab tells you here when a pact needs you, with no deal details.`, shortDescription: CHANNEL_ABOUT };
  }
}

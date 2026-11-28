import { createHash, randomBytes, randomInt } from 'node:crypto';
import { ForbiddenException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import type { ContactProfileView, LineAllowanceView, LineCallbackBody, LineCallbackView, LineLinkView, MaskedMemberContactView, Page, TelegramLinkView, WhatsAppStartBody } from '@pactlab/contracts';
import { contactDispatch, contacts, type PrismaClient } from '@pactlab/db';
import { channelMessage, CHANNEL_ABOUT, CHANNEL_SENDER, isStopWord, lineMessage, normalizeEmail, toE164, WHATSAPP_CONSENT_TEXT, type TenantContext } from '@pactlab/domain';
import { ChannelSendError, type LineMessenger, type TelegramBot, type WhatsAppSender } from '@pactlab/connectors';
import type { Logger } from '@pactlab/observability';
import type { Principal } from '../auth/auth.guard';
import { keyedHash } from '../email-login/client-address';
import type { EmailSender } from '../email-login/email-sender';
import { LOGGER, PRISMA } from '../tokens';
import type { IdentityEmailSource } from './auth0-userinfo';
import { contactEmails } from './contact-emails';
import { LINE_ALLOWANCE_REACHED, LineAllowance } from './line-allowance';

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
  /** LINE (T-182): off (null) unless its channels are set; the fixture in tests. */
  readonly line?: LineMessenger | null;
  /** LINE pushes allowed each month: the free allowance unless a paid plan is approved. */
  readonly lineMonthlyAllowance?: number;
}

/** Where LINE Login returns (registered as the LINE Login channel's callback URL; runbook). */
export const LINE_CALLBACK_PATH = '/settings/profile/line/callback';

const CODE_MINUTES = 10;
const LINK_MINUTES = 10;
/** How often an Auth0 person's email claim is looked up while they have none (Auth0 rate-limits /userinfo per user). */
const CLAIM_RETRY_MS = 10 * 60_000;

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const errorClass = (error: unknown) => (error instanceof ChannelSendError ? error.errorClass : error instanceof Error ? error.name : 'unknown');

/**
 * Contact details in the profile (T-180, T-182; ADR 0064). A verified email for everyone, Telegram (free, the
 * default phone channel), WhatsApp (opt-in, paid per message) and LINE (Japan; pushes capped at the free allowance). Every value is personal data: it is
 * never logged, never in an error, never sent to a model; a channel is used only once verified, and
 * the verified state lives in the database. Every message is the shared, content-free template.
 */
@Injectable()
export class ContactsService {
  private readonly claimTried = new Map<string, number>();
  private readonly lineAllowance: LineAllowance | null;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CONTACT_SETTINGS) private readonly settings: ContactModuleSettings,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.lineAllowance = settings.line ? new LineAllowance(settings.line, settings.lineMonthlyAllowance ?? 0, logger) : null;
  }

  /** A LINE user id as the pending verification keeps it: keyed, so the id itself is never stored before both steps. */
  private lineUserHash(lineUserId: string): string {
    return keyedHash(this.settings.hashSecret, `contact:LINE:user:${lineUserId}`);
  }

  /** PKCE and nonce from the state, keyed: nothing but the state's hash is stored. */
  private lineSecrets(state: string): { codeVerifier: string; codeChallenge: string; nonce: string } {
    const codeVerifier = keyedHash(this.settings.hashSecret, `contact:LINE:pkce:${state}`);
    return {
      codeVerifier,
      codeChallenge: createHash('sha256').update(codeVerifier, 'ascii').digest('base64url'),
      nonce: keyedHash(this.settings.hashSecret, `contact:LINE:nonce:${state}`).slice(0, 32),
    };
  }

  private codeHash(tenant: TenantContext, kind: 'EMAIL' | 'WHATSAPP', code: string): string {
    return keyedHash(this.settings.hashSecret, `contact:${kind}:${tenant.userId}:${code}`);
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
    const [email, channels, displayName] = await Promise.all([contacts.email(this.prisma, tenant), contacts.channels(this.prisma, tenant), contacts.displayName(this.prisma, tenant)]);
    return {
      displayName: displayName ?? '',
      email: email ? { address: email.email, verified: true, source: email.source } : null,
      askForEmail: !email,
      channels: channels.map((channel) => ({
        id: channel.id,
        kind: channel.kind,
        // The person's own profile shows their own number; a Telegram chat id means nothing to them.
        label: channel.kind === 'WHATSAPP' ? channel.handle : 'Connected',
        verifiedAt: channel.verifiedAt.toISOString(),
        consentedAt: channel.consentedAt?.toISOString() ?? null,
      })),
      available: { telegram: this.settings.telegram !== null, whatsapp: this.settings.whatsapp !== null, line: Boolean(this.settings.line) },
      lineAddFriendUrl: this.settings.line?.addFriendUrl ?? null,
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

  /** Connect LINE, step 1: LINE Login (OpenID Connect, PKCE), which offers the account as a friend after consent. */
  async lineLink(tenant: TenantContext): Promise<LineLinkView> {
    const line = this.settings.line;
    if (!line) throw new UnprocessableEntityException({ code: 'LINE_OFF' });
    const state = randomBytes(32).toString('base64url');
    const id = await contacts.beginVerification(this.prisma, tenant, { kind: 'LINE', target: null, secretHash: sha256(state), minutes: LINK_MINUTES, consentText: null });
    if (!id) throw new HttpException({ code: 'RATE_LIMITED' }, 429);
    const { codeChallenge, nonce } = this.lineSecrets(state);
    return { url: line.authorizeUrl({ state, nonce, codeChallenge, redirectUri: this.link(LINE_CALLBACK_PATH) }), expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000).toISOString() };
  }

  /**
   * Back from LINE Login: the code exchanged, the ID token verified (LINE checks the nonce), the friendship read.
   * A friend already: connected. Not yet: the person adds the account and the follow event finishes it.
   */
  async lineCallback(tenant: TenantContext, body: LineCallbackBody): Promise<LineCallbackView> {
    const line = this.settings.line;
    if (!line) throw new UnprocessableEntityException({ code: 'LINE_OFF' });
    const { codeVerifier, nonce } = this.lineSecrets(body.state);
    let login;
    try {
      login = await line.completeLogin({ code: body.code, codeVerifier, nonce, redirectUri: this.link(LINE_CALLBACK_PATH) });
    } catch (error) {
      this.logger.warn({ errorClass: errorClass(error) }, 'LINE Login not completed');
      throw new UnprocessableEntityException({ code: 'LINE_LOGIN_FAILED' });
    }
    const status = await contacts.lineLogin(this.prisma, tenant, { stateHash: sha256(body.state), lineUserHash: this.lineUserHash(login.userId), lineUserId: login.userId, friend: login.friend });
    if (!status) throw new UnprocessableEntityException({ code: 'LINE_LINK_EXPIRED' });
    return { status: status === 'CONNECTED' ? 'CONNECTED' : 'ADD_FRIEND', addFriendUrl: line.addFriendUrl };
  }

  /** The LINE webhook: every request verified by `x-line-signature`. Follow finishes a link; unfollow disconnects at once. */
  async lineWebhook(rawBody: Uint8Array, headers: Headers): Promise<{ ok: true }> {
    const line = this.settings.line;
    if (!line) throw new NotFoundException();
    if (!line.verifySignature(rawBody, headers)) throw new ForbiddenException();
    for (const event of line.parseEvents(rawBody)) {
      if (event.kind === 'FOLLOW') {
        const linked = await contacts.lineFollow(this.prisma, { lineUserHash: this.lineUserHash(event.userId), lineUserId: event.userId });
        // A reply is free (it does not count towards the month's allowance); a push would.
        if (event.replyToken) await this.lineReply(line, event.replyToken, lineMessage(linked ? 'LINE_LINKED' : 'LINE_CONNECT_FROM_PROFILE'));
      } else if (event.kind === 'UNFOLLOW') {
        await contacts.stop(this.prisma, { kind: 'LINE', handle: event.userId, reason: 'BLOCKED' });
      }
    }
    return { ok: true };
  }

  private async lineReply(line: LineMessenger, replyToken: string, text: string): Promise<void> {
    try {
      await line.reply(replyToken, text);
    } catch (error) {
      this.logger.warn({ errorClass: errorClass(error) }, 'LINE reply not delivered');
    }
  }

  /** Operators: this month's LINE allowance, LINE's count beside Pactlab's. "Reached" is the console's notice. */
  async lineAllowanceView(tenant: TenantContext): Promise<LineAllowanceView> {
    let month;
    try {
      month = await contactDispatch.lineMonth(this.prisma, tenant.userId);
    } catch {
      throw new ForbiddenException();
    }
    const allowance = this.settings.lineMonthlyAllowance ?? 0;
    if (!this.lineAllowance) return { configured: false, allowance, used: null, reached: false, ...month };
    const state = await this.lineAllowance.state();
    return { configured: true, allowance: state.limit, used: state.used, reached: state.used !== null && state.remaining === 0, ...month };
  }

  async disconnect(tenant: TenantContext, channelId: string): Promise<{ disconnected: true }> {
    const channel = await contacts.revoke(this.prisma, tenant, channelId);
    if (!channel) throw new NotFoundException();
    // Telegram messages are free, so the chat hears that it is disconnected; WhatsApp and LINE pushes count, so they do not.
    if (channel.kind === 'TELEGRAM' && this.settings.telegram) await this.say(this.settings.telegram, channel.handle, channelMessage('DISCONNECTED'));
    return { disconnected: true };
  }

  /** A content-free test message on the person's own channel, at most 3 an hour. */
  async test(tenant: TenantContext, channelId: string): Promise<{ sent: true }> {
    const channel = (await contacts.channels(this.prisma, tenant)).find((row) => row.id === channelId);
    if (!channel) throw new NotFoundException();
    const deliveryId = await contactDispatch.claimTest(this.prisma, tenant, channelId);
    if (!deliveryId) throw new HttpException({ code: 'RATE_LIMITED' }, 429);
    const link = this.link('/settings/profile');
    try {
      if (channel.kind === 'TELEGRAM') {
        if (!this.settings.telegram) throw new ChannelSendError('TelegramOff');
        await this.settings.telegram.sendMessage(channel.handle, channelMessage('TEST', { link }));
      } else if (channel.kind === 'LINE') {
        if (!this.settings.line || !this.lineAllowance) throw new ChannelSendError('LineOff');
        const allowance = await this.lineAllowance.state();
        if (allowance.remaining === 0) {
          await contactDispatch.finish(this.prisma, { deliveryId, outcome: 'FAILED', errorClass: allowance.used === null ? 'LineQuotaUnreadable' : LINE_ALLOWANCE_REACHED });
          throw new UnprocessableEntityException({ code: 'LINE_ALLOWANCE_REACHED' });
        }
        await this.settings.line.push(channel.handle, lineMessage('TEST', { link }));
      } else {
        if (!this.settings.whatsapp) throw new ChannelSendError('WhatsAppOff');
        await this.settings.whatsapp.sendTemplate(channel.handle, 'TEST', link);
      }
    } catch (error) {
      if (error instanceof UnprocessableEntityException) throw error;
      await contactDispatch.finish(this.prisma, { deliveryId, outcome: 'FAILED', errorClass: errorClass(error) });
      throw new ServiceUnavailableException({ code: 'MESSAGE_NOT_SENT' });
    }
    await contactDispatch.finish(this.prisma, { deliveryId, outcome: 'SENT', errorClass: null });
    return { sent: true };
  }

  /** Organization owners and admins: members' contact details, masked; every read audited in the database. */
  async adminPage(tenant: TenantContext, query: { cursor?: string | undefined; limit: number }): Promise<Page<MaskedMemberContactView>> {
    if (tenant.organizationRole !== 'ORG_OWNER' && tenant.organizationRole !== 'ORG_ADMIN') throw new ForbiddenException();
    const page = await contacts.adminPage(this.prisma, tenant, query);
    return {
      ...page,
      items: page.items.map((row) => ({ userId: row.userId, displayName: row.displayName, email: row.emailMasked, emailVerified: row.emailVerified, telegram: row.telegramMasked, whatsapp: row.whatsappMasked, line: row.lineMasked })),
    };
  }

  /** The brand every provider holds (runbook): the same name and about line as the emails. */
  static brandProfile() {
    return { name: CHANNEL_SENDER, description: `${CHANNEL_ABOUT} Pactlab tells you here when a pact needs you, with no deal details.`, shortDescription: CHANNEL_ABOUT };
  }
}

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ForbiddenException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import type { LineCallbackView, LineConnectStartView, LineUsageView } from '@pactlab/contracts';
import { ChannelSendError, type LineBot } from '@pactlab/connectors';
import { contacts, lineQuota, OperatorRequiredError, type PrismaClient } from '@pactlab/db';
import { isStopWord, lineMessage, type ChannelMessageKind, type TenantContext } from '@pactlab/domain';
import type { Logger } from '@pactlab/observability';
import { LOGGER, PRISMA } from '../tokens';
import { CONTACT_SETTINGS, type ContactModuleSettings } from './contact-settings';
import { LINE_ALLOWANCE_NOTICE, LINE_FREE_MONTHLY_ALLOWANCE, LineSender } from './line-sender';

const STATE_MINUTES = 10;
const errorClass = (error: unknown) => (error instanceof ChannelSendError ? error.errorClass : error instanceof Error ? error.name : 'unknown');

type ConnectState = { readonly o: string; readonly u: string; readonly e: number; readonly n: string };

/**
 * LINE (T-182, ADR 0066). Connect LINE signs the person in with LINE Login (which gives their LINE user ID) and
 * asks them to add the Pactlab LINE Official Account as a friend; push messages reach only friends. The user ID
 * is stored against the person only after both, and `unfollow` disconnects at once. Every webhook is verified by
 * `x-line-signature`. Replies (free) answer the person in the chat; pushes (counted) carry the alerts. A LINE user
 * ID is personal data: never logged, never in an error, never returned to a client, never sent to a model.
 */
@Injectable()
export class LineService {
  readonly sender: LineSender;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CONTACT_SETTINGS) private readonly settings: ContactModuleSettings,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.sender = new LineSender(settings.line ?? null, prisma, logger, settings.lineAllowance ?? LINE_FREE_MONTHLY_ALLOWANCE);
  }

  get bot(): LineBot | null {
    return this.settings.line ?? null;
  }

  private redirectUri(): string {
    return new URL('/settings/profile/line/callback', this.settings.appOrigin).toString();
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.settings.hashSecret).update(`line-connect-state:v1:${payload}`).digest('base64url');
  }

  private signState(state: ConnectState): string {
    const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
    return `${payload}.${this.mac(payload)}`;
  }

  /** The state's nonce when it is ours, unexpired, and for this person in this organization; else null. */
  private readState(text: string, tenant: TenantContext): string | null {
    const [payload, signature, ...rest] = text.split('.');
    if (!payload || !signature || rest.length > 0) return null;
    const expected = Buffer.from(this.mac(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ConnectState;
      return state.o === tenant.organizationId && state.u === tenant.userId && typeof state.e === 'number' && state.e > Date.now() && typeof state.n === 'string' ? state.n : null;
    } catch {
      return null;
    }
  }

  private require(): LineBot {
    const bot = this.bot;
    if (!bot) throw new UnprocessableEntityException({ code: 'LINE_OFF' });
    return bot;
  }

  /** Connect LINE: LINE Login's page, with a signed 10-minute state that carries the ID token's nonce. */
  start(tenant: TenantContext): LineConnectStartView {
    const bot = this.require();
    const nonce = randomBytes(16).toString('base64url');
    const state = this.signState({ o: tenant.organizationId, u: tenant.userId, e: Date.now() + STATE_MINUTES * 60_000, n: nonce });
    return { url: bot.loginUrl(state, nonce, this.redirectUri()) };
  }

  /** LINE sent the person back. A friend already: connected now. Not yet: connected by the `follow` that follows. */
  async callback(tenant: TenantContext, body: { code: string; state: string }): Promise<LineCallbackView> {
    const bot = this.require();
    const nonce = this.readState(body.state, tenant);
    if (!nonce) throw new UnprocessableEntityException({ code: 'LINE_STATE_INVALID' });
    let login: { userId: string; friend: boolean };
    try {
      login = await bot.completeLogin(body.code, this.redirectUri(), nonce);
    } catch (error) {
      this.logger.warn({ errorClass: errorClass(error) }, 'line login not completed');
      throw new UnprocessableEntityException({ code: 'LINE_LOGIN_FAILED' });
    }
    const status = await contacts.connectLine(this.prisma, tenant, { lineUserId: login.userId, friend: login.friend });
    if (!status) throw new HttpException({ code: 'RATE_LIMITED' }, 429);
    return { status: status === 'LINKED' ? 'LINKED' : 'ADD_FRIEND', addFriendUrl: bot.addFriendUrl };
  }

  /** The person has signed in with LINE but not yet added Pactlab as a friend: the profile says how to finish. */
  async pending(tenant: TenantContext): Promise<{ addFriendUrl: string | null } | null> {
    if (!this.bot) return null;
    return (await contacts.linePending(this.prisma, tenant)) ? { addFriendUrl: this.bot.addFriendUrl } : null;
  }

  /** The LINE webhook. Verified by its signature, then acted on; answers 200 to everything it accepted. */
  async webhook(rawBody: Uint8Array, headers: Headers): Promise<{ ok: true }> {
    const bot = this.bot;
    if (!bot) throw new NotFoundException();
    if (!bot.verifySignature(rawBody, headers)) throw new ForbiddenException();
    for (const event of bot.parseEvents(rawBody)) {
      if (event.kind === 'FOLLOW') {
        const linked = await contacts.lineFollowed(this.prisma, event.userId);
        if (event.replyToken) await this.reply(bot, event.replyToken, linked ? 'LINE_LINKED' : 'LINE_NOT_LINKED');
      } else if (event.kind === 'UNFOLLOW') {
        // Blocked: disconnected at once, and no message (LINE delivers none to a user who blocked the account).
        await contacts.stop(this.prisma, { kind: 'LINE', handle: event.userId, reason: 'BLOCKED' });
      } else if (event.kind === 'TEXT' && isStopWord(event.text)) {
        if ((await contacts.stop(this.prisma, { kind: 'LINE', handle: event.userId, reason: 'STOP' })) > 0 && event.replyToken) await this.reply(bot, event.replyToken, 'STOPPED');
      }
    }
    return { ok: true };
  }

  /** A reply in the chat (free); a failure is logged by class only and never fails the webhook. */
  private async reply(bot: LineBot, replyToken: string, kind: ChannelMessageKind): Promise<void> {
    try {
      await bot.reply(replyToken, lineMessage(kind));
    } catch (error) {
      this.logger.warn({ errorClass: errorClass(error) }, 'line reply not delivered');
    }
  }

  /** The profile's test message: a push, so it comes out of the monthly allowance like any alert. */
  async test(handle: string, deliveryId: string, link: string): Promise<void> {
    try {
      await this.sender.push(handle, lineMessage('TEST', { link }), deliveryId);
    } catch (error) {
      if (error instanceof ChannelSendError && error.errorClass === 'LineAllowanceReached') throw new ServiceUnavailableException({ code: 'LINE_ALLOWANCE_REACHED' });
      throw error;
    }
  }

  /** Operators: this month's pushes against the allowance, and the notice once it is reached. */
  async usage(tenant: TenantContext): Promise<LineUsageView> {
    let usage: Awaited<ReturnType<typeof lineQuota.usage>>;
    try {
      usage = await lineQuota.usage(this.prisma, tenant.userId);
    } catch (error) {
      const failure = error as { code?: string; meta?: { code?: string }; message?: string };
      if (error instanceof OperatorRequiredError || failure.code === '42501' || failure.meta?.code === '42501' || /\b42501\b|operator required/i.test(String(failure.message))) throw new ForbiddenException();
      throw error;
    }
    const reached = usage.reachedAt !== null || usage.sent >= this.sender.allowance;
    return {
      available: this.bot !== null,
      month: usage.month.toISOString().slice(0, 7),
      sent: usage.sent,
      allowance: this.sender.allowance,
      reachedAt: usage.reachedAt?.toISOString() ?? null,
      notice: reached ? LINE_ALLOWANCE_NOTICE : null,
    };
  }
}

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ForbiddenException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import type { ChatAppsView, ChatInstallStartView, ChatMemberLinkView, ChatProviderParam, Page } from '@pactlab/contracts';
import { chatInstalls, contactDispatch, contacts, teamsRefs, type ChatProvider, type PrismaClient } from '@pactlab/db';
import { CHAT_BUTTONS, channelMessage, type TenantContext } from '@pactlab/domain';
import { ChannelSendError, destroySecret, type ChatMessage, type SecretStore, type SlackApp, type TeamsBot } from '@pactlab/connectors';
import type { Logger } from '@pactlab/observability';
import { keyedHash } from '../email-login/client-address';
import { LOGGER, PRISMA } from '../tokens';
import { ChatSender, chatMessage } from './chat-sender';

export const CHAT_SETTINGS = Symbol('CHAT_SETTINGS');

export interface ChatModuleSettings {
  readonly slack: SlackApp | null;
  readonly teams: TeamsBot | null;
  /** Where Slack bot tokens live (by reference only). Null: Slack installs are refused. */
  readonly secrets: SecretStore | null;
  readonly hashSecret: string;
  readonly appOrigin: string;
}

const STATE_MINUTES = 10;
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const errorClass = (error: unknown) => (error instanceof ChannelSendError ? error.errorClass : error instanceof Error ? error.name : 'unknown');
const PROVIDER: Record<ChatProviderParam, ChatProvider> = { slack: 'SLACK', teams: 'TEAMS' };

type InstallState = { readonly o: string; readonly u: string; readonly p: ChatProvider; readonly e: number; readonly n: string };

/**
 * Slack and Microsoft Teams (T-181, ADR 0065). An organization admin installs Pactlab once; a person links
 * by their verified Pactlab email and confirms in Slack or Teams; Pactlab then sends direct messages from
 * its bot with the shared, content-free words. Workspace and tenant ids, platform user ids, tokens and
 * conversation references are never logged, never in an error, never returned to a client.
 */
@Injectable()
export class ChatService {
  readonly sender: ChatSender;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CHAT_SETTINGS) private readonly settings: ChatModuleSettings,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.sender = new ChatSender(settings.slack, settings.teams, settings.secrets);
  }

  private redirectUri(provider: ChatProvider): string {
    return new URL(`/settings/chat-apps/${provider.toLowerCase()}/callback`, this.settings.appOrigin).toString();
  }

  private link(path: string): string {
    return new URL(path, this.settings.appOrigin).toString();
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.settings.hashSecret).update(`chat-install-state:v1:${payload}`).digest('base64url');
  }

  private signState(state: InstallState): string {
    const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
    return `${payload}.${this.mac(payload)}`;
  }

  /** The install state when it is ours, unexpired, and for this admin in this organization and platform. */
  private readState(text: string, tenant: TenantContext, provider: ChatProvider): boolean {
    const [payload, signature, ...rest] = text.split('.');
    if (!payload || !signature || rest.length > 0) return false;
    const expected = Buffer.from(this.mac(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
    try {
      const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as InstallState;
      return state.o === tenant.organizationId && state.u === tenant.userId && state.p === provider && typeof state.e === 'number' && state.e > Date.now();
    } catch {
      return false;
    }
  }

  private admin(tenant: TenantContext): void {
    if (tenant.organizationRole !== 'ORG_OWNER' && tenant.organizationRole !== 'ORG_ADMIN') throw new ForbiddenException();
  }

  private adapter(provider: ChatProvider): SlackApp | TeamsBot {
    const adapter = provider === 'SLACK' ? this.settings.slack : this.settings.teams;
    if (!adapter) throw new UnprocessableEntityException({ code: `${provider}_OFF` });
    return adapter;
  }

  async apps(tenant: TenantContext): Promise<ChatAppsView> {
    const status = await chatInstalls.status(this.prisma, tenant);
    const view = (provider: ChatProvider, available: boolean) => {
      const row = status.find((item) => item.provider === provider);
      return { available, installed: row !== undefined, installedAt: row?.installedAt.toISOString() ?? null, linkedCount: row?.linkedCount ?? null };
    };
    return { slack: view('SLACK', this.settings.slack !== null), teams: view('TEAMS', this.settings.teams !== null) };
  }

  /** Whether each platform is installed for the person's organization (the profile's cards). */
  async installed(tenant: TenantContext): Promise<{ slack: boolean; teams: boolean }> {
    const status = await chatInstalls.status(this.prisma, tenant);
    return { slack: status.some((row) => row.provider === 'SLACK'), teams: status.some((row) => row.provider === 'TEAMS') };
  }

  /** Admin: Slack's OAuth page, or Microsoft's sign-in (to prove the tenant), with a signed 10-minute state. */
  startInstall(tenant: TenantContext, param: ChatProviderParam): ChatInstallStartView {
    this.admin(tenant);
    const provider = PROVIDER[param];
    const adapter = this.adapter(provider);
    if (provider === 'SLACK' && !this.settings.secrets) throw new ServiceUnavailableException({ code: 'CREDENTIAL_STORE_UNAVAILABLE' });
    const state = this.signState({ o: tenant.organizationId, u: tenant.userId, p: provider, e: Date.now() + STATE_MINUTES * 60_000, n: randomBytes(12).toString('base64url') });
    const url = provider === 'SLACK' ? (adapter as SlackApp).installUrl(state, this.redirectUri(provider)) : (adapter as TeamsBot).tenantSignInUrl(state, this.redirectUri(provider));
    return { url };
  }

  /** Admin: the provider sent the admin back. Slack's bot token goes to the credential store; only its reference is kept. */
  async finishInstall(tenant: TenantContext, param: ChatProviderParam, body: { code: string; state: string }): Promise<{ installed: true }> {
    this.admin(tenant);
    const provider = PROVIDER[param];
    const adapter = this.adapter(provider);
    if (!this.readState(body.state, tenant, provider)) throw new UnprocessableEntityException({ code: 'INSTALL_STATE_INVALID' });
    let externalTenant: string;
    let credentialRef: string | null = null;
    let botToken: string | null = null;
    try {
      if (provider === 'SLACK') {
        const install = await (adapter as SlackApp).exchangeCode(body.code, this.redirectUri(provider));
        externalTenant = install.teamId;
        botToken = install.botToken;
      } else {
        externalTenant = (await (adapter as TeamsBot).exchangeTenantCode(body.code, this.redirectUri(provider))).tenantId;
      }
    } catch (error) {
      this.logger.warn({ provider, errorClass: errorClass(error) }, 'chat install not completed');
      throw new UnprocessableEntityException({ code: 'INSTALL_FAILED' });
    }
    if (botToken) {
      const secrets = this.settings.secrets;
      if (!secrets) throw new ServiceUnavailableException({ code: 'CREDENTIAL_STORE_UNAVAILABLE' });
      credentialRef = `secretref:${tenant.organizationId}/chat/slack/${randomBytes(9).toString('base64url')}`;
      await secrets.put(credentialRef, botToken);
    }
    const saved = await chatInstalls.save(this.prisma, tenant, { provider, externalTenant, credentialRef });
    if (!saved) {
      if (credentialRef && this.settings.secrets) await destroySecret(this.settings.secrets, credentialRef);
      // Another organization holds this workspace or tenant: refused, audited as denied, and never says whose.
      throw new UnprocessableEntityException({ code: 'INSTALL_TAKEN' });
    }
    if (saved.replacedRef && this.settings.secrets) await destroySecret(this.settings.secrets, saved.replacedRef);
    return { installed: true };
  }

  /** Admin: remove Pactlab. Every link ends at once; Slack's token is revoked and destroyed. */
  async uninstall(tenant: TenantContext, param: ChatProviderParam): Promise<{ uninstalled: true }> {
    this.admin(tenant);
    const provider = PROVIDER[param];
    const ref = await chatInstalls.remove(this.prisma, tenant, provider);
    if (ref === null) throw new NotFoundException();
    const slack = this.settings.slack;
    if (ref && this.settings.secrets) {
      if (slack) {
        // handled: the install is already ended in Pactlab; a failed revoke only leaves Slack's own token to expire, logged by class.
        await this.sender.botToken(ref).then((token) => slack.revoke(token)).catch((error: unknown) => this.logger.warn({ errorClass: errorClass(error) }, 'slack token revoke failed'));
      }
      await destroySecret(this.settings.secrets, ref);
    }
    return { uninstalled: true };
  }

  async members(tenant: TenantContext, param: ChatProviderParam, query: { cursor?: string | undefined; limit: number }): Promise<Page<ChatMemberLinkView>> {
    this.admin(tenant);
    return chatInstalls.adminMembers(this.prisma, tenant, PROVIDER[param], query);
  }

  /**
   * The person asks to link: their verified Pactlab email is matched to a member of the organization's
   * workspace or tenant, and a one-time "Is this you?" goes to that member. Nothing links until they confirm.
   */
  async connect(tenant: TenantContext, param: ChatProviderParam): Promise<{ sent: true }> {
    const provider = PROVIDER[param];
    const adapter = this.adapter(provider);
    const install = await chatInstalls.forCaller(this.prisma, tenant, provider);
    if (!install) throw new UnprocessableEntityException({ code: 'NOT_INSTALLED' });
    const email = await contacts.email(this.prisma, tenant);
    if (!email) throw new UnprocessableEntityException({ code: 'EMAIL_REQUIRED' });
    const token = randomBytes(24).toString('base64url');
    const message: ChatMessage = { text: channelMessage('CHAT_CONFIRM'), action: { kind: 'CONFIRM', label: CHAT_BUTTONS.CONFIRM, value: token } };
    try {
      if (provider === 'SLACK') {
        const botToken = await this.sender.botToken(install.credentialRef);
        const member = await (adapter as SlackApp).lookupUserByEmail(botToken, email.email);
        if (!member) throw new UnprocessableEntityException({ code: 'NOT_FOUND_IN_WORKSPACE' });
        const handle = `${install.externalTenant}:${member}`;
        if (!(await chatInstalls.beginLink(this.prisma, tenant, { provider, handle, secretHash: sha256(token) }))) throw new HttpException({ code: 'RATE_LIMITED' }, 429);
        await (adapter as SlackApp).sendDirect(botToken, member, message);
      } else {
        const ref = await teamsRefs.forCaller(this.prisma, tenant, this.emailHash(email.email));
        if (!ref) throw new UnprocessableEntityException({ code: 'NOT_FOUND_IN_WORKSPACE' });
        const handle = `${install.externalTenant}:${ref.aadObjectId}`;
        if (!(await chatInstalls.beginLink(this.prisma, tenant, { provider, handle, secretHash: sha256(token) }))) throw new HttpException({ code: 'RATE_LIMITED' }, 429);
        await (adapter as TeamsBot).send({ tenantId: install.externalTenant, aadObjectId: ref.aadObjectId, serviceUrl: ref.serviceUrl, conversationId: ref.conversationId }, message);
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn({ provider, errorClass: errorClass(error) }, 'chat confirmation not delivered');
      throw new ServiceUnavailableException({ code: 'MESSAGE_NOT_SENT' });
    }
    return { sent: true };
  }

  /** The keyed hash a Teams member's email is matched by; the address itself is never stored. */
  private emailHash(email: string): string {
    return keyedHash(this.settings.hashSecret, `teams-member-email:${email.trim().toLowerCase()}`);
  }

  /** A content-free test message on the person's own Slack or Teams link. The delivery is already claimed. */
  async test(tenant: TenantContext, channelId: string, deliveryId: string): Promise<void> {
    const target = await chatInstalls.targetForCaller(this.prisma, tenant, channelId);
    try {
      if (!target) throw new ChannelSendError('ChatNotLinked');
      await this.sender.send(target, chatMessage('TEST', this.link('/settings/profile')));
    } catch (error) {
      await contactDispatch.finish(this.prisma, { deliveryId, outcome: 'FAILED', errorClass: errorClass(error) });
      throw new ServiceUnavailableException({ code: 'MESSAGE_NOT_SENT' });
    }
    await contactDispatch.finish(this.prisma, { deliveryId, outcome: 'SENT', errorClass: null });
  }

  /** After a Pactlab-side disconnect: Slack's home tab no longer offers Disconnect. Teams has nothing to update. */
  async afterDisconnect(kind: ChatProvider, handle: string): Promise<void> {
    const slack = this.settings.slack;
    if (kind !== 'SLACK' || !slack) return;
    const [teamId, member] = handle.split(':');
    const install = teamId ? await chatInstalls.forTenant(this.prisma, 'SLACK', teamId) : null;
    if (!install || !member) return;
    // handled: the link is already ended; the home tab refreshes the next time it is opened. Logged by class.
    await this.sender.botToken(install.credentialRef).then((token) => slack.publishHome(token, member, false)).catch((error: unknown) => this.logger.warn({ errorClass: errorClass(error) }, 'slack home not updated'));
  }

  // ---------------------------------------------------------------------------
  // Webhooks (public; the provider's signature or token is the proof)
  // ---------------------------------------------------------------------------

  /** Slack Events API and interactivity: verified by the signing secret, then acted on. */
  async slackInbound(rawBody: Uint8Array, headers: Headers, contentType: string): Promise<unknown> {
    const slack = this.settings.slack;
    if (!slack) throw new NotFoundException();
    if (!slack.verifyRequest(rawBody, headers)) throw new ForbiddenException();
    const inbound = slack.parseInbound(rawBody, contentType);
    switch (inbound.kind) {
      case 'URL_VERIFICATION':
        return { challenge: inbound.challenge };
      case 'UNINSTALLED':
      case 'TOKENS_REVOKED': {
        const ref = await chatInstalls.providerEvent(this.prisma, { provider: 'SLACK', externalTenant: inbound.teamId, reason: inbound.kind === 'UNINSTALLED' ? 'UNINSTALLED' : 'TOKENS_REVOKED' });
        if (ref && this.settings.secrets) await destroySecret(this.settings.secrets, ref);
        return { ok: true };
      }
      case 'HOME_OPENED':
        await this.slackReply(inbound.teamId, async (token) => slack.publishHome(token, inbound.userId, await chatInstalls.linked(this.prisma, 'SLACK', `${inbound.teamId}:${inbound.userId}`)));
        return { ok: true };
      case 'CONFIRM': {
        const handle = `${inbound.teamId}:${inbound.userId}`;
        const linked = await chatInstalls.confirmLink(this.prisma, { provider: 'SLACK', handle, secretHash: sha256(inbound.value) });
        await this.slackReply(inbound.teamId, async (token) => {
          await slack.sendDirect(token, inbound.userId, { text: channelMessage(linked ? 'CHAT_LINKED' : 'LINK_EXPIRED'), action: null });
          if (linked) await slack.publishHome(token, inbound.userId, true);
        });
        return { ok: true };
      }
      case 'DISCONNECT':
        if ((await contacts.stop(this.prisma, { kind: 'SLACK', handle: `${inbound.teamId}:${inbound.userId}`, reason: 'STOP' })) > 0) {
          await this.slackReply(inbound.teamId, async (token) => {
            await slack.sendDirect(token, inbound.userId, { text: channelMessage('DISCONNECTED'), action: null });
            await slack.publishHome(token, inbound.userId, false);
          });
        }
        return { ok: true };
      default:
        return { ok: true };
    }
  }

  /** A reply from the workspace's own bot; a failure is logged by class and never fails the webhook. */
  private async slackReply(teamId: string, act: (token: string) => Promise<void>): Promise<void> {
    try {
      const install = await chatInstalls.forTenant(this.prisma, 'SLACK', teamId);
      if (!install) return;
      await act(await this.sender.botToken(install.credentialRef));
    } catch (error) {
      this.logger.warn({ errorClass: errorClass(error) }, 'slack reply not delivered');
    }
  }

  /** The Teams bot's messaging endpoint: Bot Framework JWT verified first, then acted on. */
  async teamsInbound(authorization: string | null, activity: unknown): Promise<{ ok: true }> {
    const teams = this.settings.teams;
    if (!teams) throw new NotFoundException();
    if (!(await teams.verifyInbound(authorization, activity))) throw new ForbiddenException();
    const inbound = teams.parseActivity(activity);
    if (inbound.kind === 'INSTALLED') {
      let emailHash: string | null = null;
      try {
        const member = await teams.getMember(inbound.ref, inbound.memberId);
        emailHash = member?.email ? this.emailHash(member.email) : null;
      } catch (error) {
        // handled: the reference is still stored; without an email the person cannot be matched, and Connect Teams says so.
        this.logger.warn({ errorClass: errorClass(error) }, 'teams member not read');
      }
      await teamsRefs.capture(this.prisma, { ...inbound.ref, emailHash });
    } else if (inbound.kind === 'UNINSTALLED') {
      await teamsRefs.remove(this.prisma, inbound);
    } else if (inbound.kind === 'CONFIRM' || inbound.kind === 'DISCONNECT') {
      const handle = `${inbound.tenantId}:${inbound.aadObjectId}`;
      const ref = await teamsRefs.forMember(this.prisma, inbound);
      let text: string | null;
      if (inbound.kind === 'CONFIRM') {
        const linked = await chatInstalls.confirmLink(this.prisma, { provider: 'TEAMS', handle, secretHash: sha256(inbound.value) });
        text = channelMessage(linked ? 'CHAT_LINKED' : 'LINK_EXPIRED');
      } else {
        text = (await contacts.stop(this.prisma, { kind: 'TEAMS', handle, reason: 'STOP' })) > 0 ? channelMessage('DISCONNECTED') : null;
      }
      if (ref && text) {
        // handled: the link change is recorded; the reply in the chat is best-effort, logged by class.
        await teams.send({ tenantId: inbound.tenantId, aadObjectId: inbound.aadObjectId, ...ref }, { text, action: null }).catch((error: unknown) => {
          this.logger.warn({ errorClass: errorClass(error) }, 'teams reply not delivered');
        });
      }
    }
    return { ok: true };
  }
}

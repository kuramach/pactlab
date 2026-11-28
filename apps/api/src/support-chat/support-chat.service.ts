import { HttpException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { answerSupportQuestion, SITE_CORPUS, SUPPORT_MESSAGES, supportIndexes, type AiRunRecord, type ClaudeGateway, type SupportAudience, type SupportIndex, type SupportSurface } from '@pactlab/ai';
import type { SupportChatHandoff, SupportChatHandoffView, SupportChatMessage, SupportChatReplyView } from '@pactlab/contracts';
import { withTenant, type PrismaClient } from '@pactlab/db';
import type { TenantContext } from '@pactlab/domain';
import type { Logger } from '@pactlab/observability';
import type { EmailSender } from '../email-login/email-sender';
import { FEATURE_CARDS } from '../feature-cards/feature-cards';
import { LOGGER, PRISMA } from '../tokens';
import type { FeatureRequestIntake } from './feature-request-intake';
import { transcriptText } from './handoff-email';
import { SlidingWindowLimiter } from './rate-limit';

export const SUPPORT_CHAT = Symbol('SUPPORT_CHAT');

export interface SupportChatDependencies {
  readonly gateway: ClaudeGateway;
  /** Sends handed-off questions to the team; null when email is not set up (the panel then shows the address to write to). */
  readonly emailSender: EmailSender | null;
  readonly teamEmail: string | null;
  readonly featureIntake: FeatureRequestIntake | null;
  readonly now?: () => number;
}

const TEN_MINUTES = 10 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** The side a person's organization role puts them on: only to pitch steps at the right surface, never their content. */
export function audienceOf(tenant: TenantContext): SupportAudience {
  if (tenant.organizationRole === 'ORG_OWNER' || tenant.organizationRole === 'ORG_ADMIN') return 'ADMIN';
  return tenant.organizationRole === 'GUEST' ? 'SELLER' : 'BUYER';
}

/**
 * Product-help chat (T-175): one service for the site and the app. It answers from the published corpus
 * through the model gateway (job `support_chat`), keeps no conversation, meters every model call, and hands a
 * question or a confirmed feature request to the team only when the visitor confirms.
 */
@Injectable()
export class SupportChatService {
  private readonly indexes: Record<SupportSurface, SupportIndex>;
  private readonly perConversation: SlidingWindowLimiter;
  private readonly perAddress: SlidingWindowLimiter;
  private readonly perUser: SlidingWindowLimiter;
  private readonly handoffs: SlidingWindowLimiter;

  constructor(
    @Inject(SUPPORT_CHAT) private readonly deps: SupportChatDependencies,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.indexes = supportIndexes(SITE_CORPUS, FEATURE_CARDS);
    const now = deps.now ?? Date.now;
    this.perConversation = new SlidingWindowLimiter(20, TEN_MINUTES, now);
    this.perAddress = new SlidingWindowLimiter(60, TEN_MINUTES, now);
    this.perUser = new SlidingWindowLimiter(60, TEN_MINUTES, now);
    this.handoffs = new SlidingWindowLimiter(5, HOUR, now);
  }

  /** A visitor on pactlab.ai: anonymous, limited per conversation and per address. */
  async askOnSite(message: SupportChatMessage, address: string): Promise<SupportChatReplyView> {
    if (!this.perConversation.allow(`site:${message.sessionId}`) || !this.perAddress.allow(`site:${address}`)) return this.limited(message);
    return this.answer('SITE', message, null, null);
  }

  /** A signed-in person: their org role pitches the steps; their organization's model allow-list applies. */
  async askInApp(tenant: TenantContext, message: SupportChatMessage): Promise<SupportChatReplyView> {
    if (!this.perUser.allow(`app:${tenant.userId}`)) return this.limited(message);
    return this.answer('APP', message, audienceOf(tenant), tenant.organizationId);
  }

  private async answer(surface: SupportSurface, message: SupportChatMessage, audience: SupportAudience | null, organizationId: string | null): Promise<SupportChatReplyView> {
    const { reply, run } = await answerSupportQuestion(this.deps.gateway, this.indexes[surface], {
      surface,
      locale: message.locale,
      page: message.page,
      question: message.question,
      history: message.history,
      audience,
      organizationId,
    });
    if (run) this.meter(surface, run);
    // On the site there is no app session to follow a link into.
    return { ...reply, deepLink: surface === 'SITE' ? null : reply.deepLink };
  }

  /**
   * Per-message metering (T-175): model, provider, job, tokens and latency of each help reply, as a structured
   * record. Help runs belong to no pact, so they are not `ai_runs` rows; joining Hosting cost is a follow-up (T-185).
   */
  private meter(surface: SupportSurface, run: AiRunRecord): void {
    this.logger.info(
      {
        event: 'ai.run.metered',
        jobType: run.jobType,
        surface,
        promptId: run.promptId,
        promptVersion: run.promptVersion,
        provider: run.resolvedProvider,
        modelId: run.resolvedModelId,
        fallbackFrom: run.fallbackFrom,
        status: run.status,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        latencyMs: run.latencyMs,
      },
      'support chat model call metered',
    );
  }

  private limited(message: SupportChatMessage): SupportChatReplyView {
    return { kind: 'LIMITED', text: SUPPORT_MESSAGES[message.locale].limited, steps: [], citations: [], deepLink: null, answeredIn: message.locale, localeNote: null, offerEmail: false, featureRequest: null };
  }

  /** The site visitor confirms; their address is required so the team can answer. */
  async handOffFromSite(handoff: SupportChatHandoff, address: string): Promise<SupportChatHandoffView> {
    if (!handoff.email) throw new UnprocessableEntityException({ code: 'EMAIL_REQUIRED' });
    if (!this.handoffs.allow(`site:${address}`)) throw new HttpException({ code: 'RATE_LIMITED' }, 429);
    return this.handOff('SITE', handoff, { kind: 'VISITOR', email: handoff.email });
  }

  async handOffInApp(tenant: TenantContext, handoff: SupportChatHandoff): Promise<SupportChatHandoffView> {
    if (!this.handoffs.allow(`app:${tenant.userId}`)) throw new HttpException({ code: 'RATE_LIMITED' }, 429);
    // The person's own sign-in address, for the reply; read under their own tenant context.
    const user = await withTenant(this.prisma, tenant, (tx) => tx.user.findUnique({ where: { id: tenant.userId }, select: { email: true } }));
    return this.handOff('APP', handoff, { kind: 'USER', userId: tenant.userId, organizationId: tenant.organizationId, email: handoff.email ?? user?.email ?? null });
  }

  private async handOff(surface: SupportSurface, handoff: SupportChatHandoff, requester: { kind: 'VISITOR'; email: string } | { kind: 'USER'; userId: string; organizationId: string; email: string | null }): Promise<SupportChatHandoffView> {
    const { emailSender, teamEmail, featureIntake } = this.deps;
    let view: SupportChatHandoffView = { status: 'SENT' };
    if (handoff.kind === 'FEATURE_REQUEST') {
      if (!featureIntake) throw new UnprocessableEntityException({ code: 'HANDOFF_UNAVAILABLE' });
      const filed = await featureIntake.submit({ summary: handoff.summary, surface, locale: handoff.locale, page: handoff.page, transcript: handoff.transcript, requester });
      if (filed) view = { status: 'SENT', ...(filed.earlierDecision ? { earlierDecision: filed.earlierDecision } : {}), ...(filed.groupedWithExisting ? { groupedWithExisting: true } : {}) };
    } else {
      if (!emailSender || !teamEmail) throw new UnprocessableEntityException({ code: 'HANDOFF_UNAVAILABLE' });
      const from = requester.kind === 'VISITOR' ? `a site visitor (${requester.email})` : `a signed-in user (user ${requester.userId}, organization ${requester.organizationId}${requester.email ? `, ${requester.email}` : ''})`;
      const text = [`A question the help chat could not answer, from ${from}.`, '', `Question: ${handoff.summary}`, `Where: ${surface === 'SITE' ? 'pactlab.ai' : 'the app'} ${handoff.page} (${handoff.locale})`, requester.email ? `Reply to: ${requester.email}` : 'No reply address on file.', '', 'Conversation:', transcriptText(handoff.transcript)].join('\n');
      await emailSender.send({ to: teamEmail, subject: `Help question: ${handoff.summary.slice(0, 80)}`, text });
    }
    // Who asked stays in the email; the log carries the kind and surface only.
    this.logger.info({ event: 'support_chat.handoff', kind: handoff.kind, surface }, 'help chat handed a conversation to the team');
    return view;
  }
}

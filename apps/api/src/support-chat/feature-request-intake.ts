import { HttpException, UnprocessableEntityException } from '@nestjs/common';
import type { FeatureRequestIntakeItem } from '@pactlab/contracts';
import { featureRequests, prismaExecutor, type PrismaClient, type SqlExecutor } from '@pactlab/db';
import { bestFeatureMatch, screenFeatureRequest } from '@pactlab/domain';
import type { EmailSender } from '../email-login/email-sender';
import { transcriptText } from './handoff-email';

/** What the store did with a confirmed request, so the visitor is told the truth about it. */
export interface FeatureRequestIntakeResult {
  /** Grouped under a proposal already filed (a triager confirms it), rather than starting a new one. */
  groupedWithExisting: boolean;
  /** The earlier decision on the same ask, when it was declined. */
  earlierDecision: { status: 'DECLINED'; reason: string | null } | null;
}

/**
 * Where a confirmed feature request goes (T-175 hands off; T-176 files it as a proposal for triage). Without a
 * store configured, a request is emailed to the team, so none is ever dropped.
 */
export interface FeatureRequestIntake {
  submit(item: FeatureRequestIntakeItem): Promise<FeatureRequestIntakeResult | undefined>;
}

/** The proposal store (T-176): screened, compared with what is already filed, then filed. Never approves anything. */
export class ProposalFeatureRequestIntake implements FeatureRequestIntake {
  private readonly sql: SqlExecutor;

  constructor(prisma: PrismaClient) {
    this.sql = prismaExecutor(prisma);
  }

  async submit(item: FeatureRequestIntakeItem): Promise<FeatureRequestIntakeResult> {
    const title = item.summary.trim().slice(0, 200);
    const request = { title, description: item.summary.trim() };
    // The spam screen is for the public intake; a signed-in member is already a known requester.
    if (item.surface === 'SITE') {
      const screened = screenFeatureRequest(request);
      if (!screened.ok) throw new UnprocessableEntityException({ code: 'REQUEST_REJECTED', reason: screened.reason });
    }
    const match = bestFeatureMatch(request, await featureRequests.candidates(this.sql));
    const requester = item.requester;
    const filed = await featureRequests.file(this.sql, {
      organizationId: requester.kind === 'USER' ? requester.organizationId : null,
      userId: requester.kind === 'USER' ? requester.userId : null,
      email: requester.kind === 'VISITOR' ? requester.email : null,
      surface: item.surface,
      locale: item.locale,
      page: item.page,
      title,
      description: request.description,
      transcript: item.transcript,
      matchId: match?.id ?? null,
    });
    if (filed.outcome === 'RATE_LIMITED') throw new HttpException({ code: 'RATE_LIMITED' }, 429);
    return {
      groupedWithExisting: filed.outcome === 'ATTACHED',
      earlierDecision: filed.earlierStatus === 'DECLINED' ? { status: 'DECLINED', reason: filed.earlierReason } : null,
    };
  }
}

export class EmailFeatureRequestIntake implements FeatureRequestIntake {
  constructor(
    private readonly sender: EmailSender,
    private readonly teamEmail: string,
  ) {}

  async submit(item: FeatureRequestIntakeItem): Promise<undefined> {
    const from = item.requester.kind === 'VISITOR' ? `a site visitor (${item.requester.email})` : `a signed-in user (user ${item.requester.userId}, organization ${item.requester.organizationId}${item.requester.email ? `, ${item.requester.email}` : ''})`;
    const text = [`Feature request from ${from}, confirmed in the help chat.`, '', `Request: ${item.summary}`, `Where: ${item.surface === 'SITE' ? 'pactlab.ai' : 'the app'} ${item.page} (${item.locale})`, '', 'Conversation:', transcriptText(item.transcript)].join('\n');
    await this.sender.send({ to: this.teamEmail, subject: `Feature request: ${item.summary.slice(0, 80)}`, text });
    return undefined;
  }
}

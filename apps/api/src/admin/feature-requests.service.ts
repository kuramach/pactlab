import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ApproveFeatureRequestInput,
  DecideFeatureRequestInput,
  FeatureRequestDetailView,
  FeatureRequestSummaryView,
  FeatureRequestSupporterView,
  LinkFeatureRequestInput,
  MyFeatureRequestView,
  Page,
  PageQuery,
} from '@pactlab/contracts';
import { featureRequests, OperatorRequiredError, prismaExecutor, type FeatureListRow, type FeatureDetailRow, type FeatureSupporterRow, type MyFeatureRow, type PrismaClient, type SqlExecutor } from '@pactlab/db';
import { featureRequestReference, proposeTask, REQUESTER_STATUS, type FeatureRequestStatus, type TenantContext } from '@pactlab/domain';
import type { EmailSender } from '../email-login/email-sender';
import { PRISMA } from '../tokens';
import { ADMIN_SETTINGS, type AdminSettings } from './admin.service';

const summary = (row: FeatureListRow): FeatureRequestSummaryView => ({
  id: row.id,
  reference: featureRequestReference(row.number),
  title: row.title,
  surface: row.surface,
  locale: row.locale,
  page: row.page,
  status: row.status as FeatureRequestStatus,
  declineReason: row.declineReason,
  supporters: row.supporters,
  suggested: row.suggested,
  taskId: row.taskId,
  hasEarlierDecision: row.relatedId !== null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const supporter = (row: FeatureSupporterRow): FeatureRequestSupporterView => ({
  id: row.id,
  grouping: row.grouping,
  surface: row.surface,
  locale: row.locale,
  page: row.page,
  title: row.title,
  description: row.description,
  email: row.email,
  organizationName: row.organizationName,
  transcript: (Array.isArray(row.transcript) ? row.transcript : []) as FeatureRequestSupporterView['transcript'],
  createdAt: row.createdAt.toISOString(),
});

const mine = (row: MyFeatureRow): MyFeatureRequestView => {
  const status = row.status as FeatureRequestStatus;
  return {
    id: row.id,
    proposalId: row.proposalId,
    reference: featureRequestReference(row.number),
    title: row.title,
    description: row.description,
    status,
    statusLabel: REQUESTER_STATUS[status].label,
    statusText: REQUESTER_STATUS[status].text,
    declineReason: row.declineReason,
    question: row.question,
    whatsNewUrl: row.whatsNewUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
};

/** The words the task file's title is drawn from: one line, no markup. */
const taskTitle = (title: string) => title.replace(/[\r\n\t`<>]+/g, ' ').trim().slice(0, 100);

/**
 * Feature requests from the help chat (T-176): Kumar's triage queue and the requester's own list. Approval records
 * the confirmed task (it never writes a file or holds a GitHub token): the issue made from it, labelled
 * `triage-approved` by an approver, is what the triage-to-task workflow turns into `tasks/ready/T-nnn.md`.
 */
@Injectable()
export class FeatureRequestsService {
  private readonly sql: SqlExecutor;

  constructor(
    @Inject(PRISMA) prisma: PrismaClient,
    @Inject(ADMIN_SETTINGS) private readonly settings: AdminSettings,
  ) {
    this.sql = prismaExecutor(prisma);
  }

  private async asOperator<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof OperatorRequiredError) throw new ForbiddenException();
      throw error;
    }
  }

  queue(tenant: TenantContext, query: PageQuery & { status?: string | undefined; q?: string | undefined }): Promise<Page<FeatureRequestSummaryView>> {
    return this.asOperator(async () => {
      const page = await featureRequests.queuePage(this.sql, tenant.userId, { status: query.status ?? null, query: query.q ?? null }, query);
      return { ...page, items: page.items.map(summary) };
    });
  }

  private async detailRow(tenant: TenantContext, id: string): Promise<FeatureDetailRow> {
    const row = await featureRequests.get(this.sql, tenant.userId, id);
    if (!row) throw new NotFoundException();
    return row;
  }

  detail(tenant: TenantContext, id: string): Promise<FeatureRequestDetailView> {
    return this.asOperator(async () => {
      const row = await this.detailRow(tenant, id);
      const counts = await featureRequests.supportersPage(this.sql, tenant.userId, id, { limit: 1 });
      const proposed = proposeTask({ surface: row.surface, page: row.page });
      const proposedTask: ApproveFeatureRequestInput = { model: proposed.model, lane: proposed.lane, context: proposed.context, touches: proposed.touches, needs: proposed.needs, title: taskTitle(row.title) };
      const spec = row.taskSpec && typeof row.taskSpec === 'object' ? (row.taskSpec as ApproveFeatureRequestInput) : null;
      const base = summary({ ...row, supporters: counts.total, suggested: 0 });
      return {
        ...base,
        description: row.description,
        infoQuestion: row.infoQuestion,
        infoReply: row.infoReply,
        earlier: row.relatedId && row.relatedTitle ? { id: row.relatedId, title: row.relatedTitle, status: (row.relatedStatus ?? 'DECLINED') as FeatureRequestStatus, reason: row.relatedReason } : null,
        taskSpec: spec,
        proposedTask,
        pullRequestUrl: row.pullRequestUrl,
        whatsNewUrl: row.whatsNewUrl,
        taskIssueUrl: spec ? this.issueUrl(row, spec) : null,
      };
    });
  }

  supporters(tenant: TenantContext, id: string, query: PageQuery): Promise<Page<FeatureRequestSupporterView>> {
    return this.asOperator(async () => {
      const page = await featureRequests.supportersPage(this.sql, tenant.userId, id, query);
      return { ...page, items: page.items.map(supporter) };
    });
  }

  /** Confirm a suggested requester as the same ask, or split them out as a proposal of their own. */
  group(tenant: TenantContext, supporterId: string, confirm: boolean) {
    return this.asOperator(async () => {
      const id = await featureRequests.group(this.sql, tenant.userId, supporterId, confirm);
      if (!id) throw new NotFoundException();
      return { proposalId: id };
    });
  }

  decide(tenant: TenantContext, id: string, input: DecideFeatureRequestInput): Promise<FeatureRequestDetailView> {
    return this.asOperator(async () => {
      const note = input.action === 'DECLINE' ? input.reason : input.action === 'REQUEST_INFO' ? input.question : input.action === 'REOPEN' ? input.reply : null;
      await this.detailRow(tenant, id);
      if (!(await featureRequests.decide(this.sql, tenant.userId, id, input.action, note))) throw new ConflictException({ code: 'ALREADY_APPROVED' });
      if (input.action === 'DECLINE' || input.action === 'REQUEST_INFO') await this.tell(tenant, id, input.action === 'DECLINE' ? 'DECLINED' : 'INFO_REQUESTED');
      return this.detail(tenant, id);
    });
  }

  approve(tenant: TenantContext, id: string, input: ApproveFeatureRequestInput): Promise<FeatureRequestDetailView> {
    return this.asOperator(async () => {
      await this.detailRow(tenant, id);
      if (!(await featureRequests.approve(this.sql, tenant.userId, id, input))) throw new ConflictException({ code: 'NOT_APPROVABLE' });
      await this.tell(tenant, id, 'APPROVED');
      return this.detail(tenant, id);
    });
  }

  link(tenant: TenantContext, id: string, input: LinkFeatureRequestInput): Promise<FeatureRequestDetailView> {
    return this.asOperator(async () => {
      await this.detailRow(tenant, id);
      if (!(await featureRequests.link(this.sql, tenant.userId, id, input))) throw new ConflictException({ code: 'NOT_APPROVED' });
      if (input.whatsNewUrl) await this.tell(tenant, id, 'SHIPPED');
      return this.detail(tenant, id);
    });
  }

  async mine(tenant: TenantContext, query: PageQuery): Promise<Page<MyFeatureRequestView>> {
    const page = await featureRequests.minePage(this.sql, tenant.userId, query);
    return { ...page, items: page.items.map(mine) };
  }

  /** The requester answers the team's question; false (404) when it is not theirs or nothing was asked. */
  async reply(tenant: TenantContext, proposalId: string, reply: string): Promise<{ status: 'IN_TRIAGE' }> {
    if (!(await featureRequests.reply(this.sql, tenant.userId, proposalId, reply))) throw new NotFoundException();
    return { status: 'IN_TRIAGE' };
  }

  /**
   * A new-issue link on GitHub carrying the approved task. The label `triage-approved` is applied by Kumar on GitHub,
   * which is the approval the workflow checks; the API never holds a token that can write to the repository.
   */
  private issueUrl(row: FeatureDetailRow, spec: ApproveFeatureRequestInput): string | null {
    if (!this.settings.issueRepository) return null;
    const body = ['<!-- feature-proposal:start -->', JSON.stringify({ proposal: row.id, reference: featureRequestReference(row.number), description: row.description, surface: row.surface, ...spec }), '<!-- feature-proposal:end -->'].join('\n');
    const query = new URLSearchParams({ title: `[feature-proposal] ${spec.title}`, labels: 'feature-proposal', body });
    return `https://github.com/${this.settings.issueRepository}/issues/new?${query.toString()}`;
  }

  /** Email the public-site requesters what changed, in plain words. In-app requesters see it in the app. */
  private async tell(tenant: TenantContext, id: string, status: FeatureRequestStatus): Promise<void> {
    const sender: EmailSender | null = this.settings.emailSender;
    if (!sender) return;
    const row = await featureRequests.get(this.sql, tenant.userId, id);
    if (!row) return;
    const recipients = await featureRequests.siteRequesters(this.sql, tenant.userId, id);
    for (const recipient of recipients) {
      const copy = REQUESTER_STATUS[status];
      const lines = [`Your request: ${recipient.title}`, '', `${copy.label}. ${copy.text}`];
      if (status === 'DECLINED' && row.declineReason) lines.push('', `Why: ${row.declineReason}`);
      if (status === 'INFO_REQUESTED' && row.infoQuestion) lines.push('', `The team asks: ${row.infoQuestion}`, '', 'Reply to this email and it goes back to the team.');
      if (status === 'SHIPPED' && row.whatsNewUrl) lines.push('', `What's new: ${row.whatsNewUrl}`);
      try {
        await sender.send({ to: recipient.email, subject: `Your Pactlab request: ${copy.label.toLowerCase()}`, text: lines.join('\n'), content: { heading: copy.label, paragraphs: lines.slice(2).filter(Boolean), reason: 'You asked the Pactlab team for this feature.' } });
      } catch {
        // handled: the decision is saved and shown in the console; a failed email must not undo it, and the address is not logged.
      }
    }
  }
}

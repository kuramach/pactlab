import { ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { BugReportDetailView, BugReportSummaryView, FileBugReportInput, TriageBugInput } from '@pactlab/contracts';
import { OperatorRequiredError, operatorOps, prismaExecutor, type BugListRow, type PrismaClient, type SqlExecutor } from '@pactlab/db';
import { bugFingerprint, bugReference, scrubContext, type TenantContext } from '@pactlab/domain';
import type { EmailSender } from '../email-login/email-sender';
import { decide, listPending } from '../ops/organizations';
import { PRISMA } from '../tokens';

export const ADMIN_SETTINGS = Symbol('ADMIN_SETTINGS');
export interface AdminSettings {
  readonly emailSender: EmailSender | null;
  readonly loginUrl: string;
  readonly appVersion: string;
  readonly environment: string;
}

const summary = (row: BugListRow): BugReportSummaryView => ({
  id: row.id,
  reference: bugReference(row.number),
  organizationName: row.organizationName,
  trigger: row.trigger,
  title: row.title,
  severity: row.severity,
  status: row.status,
  occurrences: row.occurrences,
  firstSeenAt: row.firstSeenAt.toISOString(),
  lastSeenAt: row.lastSeenAt.toISOString(),
  hasScreenshot: row.hasScreenshot,
});

const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPEG = [0xff, 0xd8, 0xff];
const startsWith = (bytes: Uint8Array, magic: number[]) => magic.every((byte, index) => bytes[index] === byte);

/**
 * The operator console (T-072): approvals, organizations, users, usage and
 * the bug inbox — metadata only, never deal content, no impersonation. Every
 * cross-organization read or write runs through an `app_ops_*` function that
 * checks the actor is a platform operator; actions are audited there.
 * Bug reports: anyone signed in files them; operators triage them.
 */
@Injectable()
export class AdminService {
  private readonly sql: SqlExecutor;

  constructor(
    @Inject(PRISMA) prisma: PrismaClient,
    @Inject(ADMIN_SETTINGS) private readonly settings: AdminSettings,
  ) {
    this.sql = prismaExecutor(prisma);
  }

  /** Run an operator action; a non-operator gets 403. */
  private async asOperator<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof OperatorRequiredError) throw new ForbiddenException();
      throw error;
    }
  }

  async requireOperator(tenant: TenantContext): Promise<void> {
    if (!(await operatorOps.isOperator(this.sql, tenant.userId))) throw new ForbiddenException();
  }

  async overview(tenant: TenantContext) {
    await this.requireOperator(tenant);
    return { environment: this.settings.environment, appVersion: this.settings.appVersion };
  }

  pending(tenant: TenantContext) {
    return this.asOperator(async () => ({ items: await listPending(this.sql, tenant.userId) }));
  }

  decide(tenant: TenantContext, slug: string, decision: 'approve' | 'reject') {
    return this.asOperator(async () => {
      const outcome = await decide(this.sql, slug, decision, { sender: this.settings.emailSender, loginUrl: this.settings.loginUrl }, tenant.userId);
      if (outcome.kind === 'not-found') throw new NotFoundException();
      return outcome;
    });
  }

  organizations(tenant: TenantContext) {
    return this.asOperator(async () => ({ items: await operatorOps.organizations(this.sql, tenant.userId) }));
  }

  setOrganizationStatus(tenant: TenantContext, organizationId: string, status: 'ACTIVE' | 'SUSPENDED') {
    return this.asOperator(async () => ({ changed: await operatorOps.setOrganizationStatus(this.sql, tenant.userId, organizationId, status) }));
  }

  setFlags(tenant: TenantContext, organizationId: string, flags: { pilotMode: boolean; liveConnectors: boolean }) {
    return this.asOperator(async () => {
      await operatorOps.setFlags(this.sql, tenant.userId, organizationId, flags);
      return flags;
    });
  }

  users(tenant: TenantContext, filter: { organizationId?: string; q?: string }) {
    return this.asOperator(async () => ({ items: await operatorOps.users(this.sql, tenant.userId, { organizationId: filter.organizationId ?? null, query: filter.q ?? null }) }));
  }

  setMemberStatus(tenant: TenantContext, organizationId: string, userId: string, status: 'ACTIVE' | 'SUSPENDED') {
    return this.asOperator(async () => ({ changed: await operatorOps.setMemberStatus(this.sql, tenant.userId, organizationId, userId, status) }));
  }

  connections(tenant: TenantContext) {
    return this.asOperator(async () => ({ items: await operatorOps.connections(this.sql, tenant.userId) }));
  }

  audit(tenant: TenantContext, filter: { action?: string; since?: string }) {
    return this.asOperator(async () => ({
      items: await operatorOps.auditEvents(this.sql, tenant.userId, { action: filter.action ?? null, since: filter.since ? new Date(`${filter.since}T00:00:00Z`) : null }),
    }));
  }

  /** The caller's own organization's flags (any member). */
  flags(tenant: TenantContext) {
    return operatorOps.organizationFlags(this.sql, tenant.organizationId, tenant.userId);
  }

  // --- Bug reports -------------------------------------------------------------

  async fileBug(tenant: TenantContext, input: FileBugReportInput): Promise<{ id: string; reference: string; deduplicated: boolean }> {
    let screenshot: Uint8Array | null = null;
    if (input.screenshot) {
      screenshot = new Uint8Array(Buffer.from(input.screenshot.data, 'base64'));
      const valid = input.screenshot.contentType === 'image/png' ? startsWith(screenshot, PNG) : startsWith(screenshot, JPEG);
      if (!valid || screenshot.byteLength > 1_000_000) throw new UnprocessableEntityException({ code: 'SCREENSHOT_REFUSED' });
    }
    // Only deals the reporter can see are recorded on the report.
    const dealId = input.dealId && tenant.dealIds.includes(input.dealId as never) ? input.dealId : null;
    const error = input.context.error;
    const fingerprint =
      input.trigger === 'USER_REPORT'
        ? `user:${tenant.userId}:${Date.now()}`
        : bugFingerprint({ errorName: error?.name ?? 'Error', stack: error?.stack ?? null, route: input.context.route ?? null });
    const context = scrubContext({
      ...input.context,
      userId: tenant.userId,
      organizationId: tenant.organizationId,
      dealId,
      environment: this.settings.environment,
      serverAppVersion: this.settings.appVersion,
    }) as Record<string, unknown>;
    const filed = await operatorOps.fileBug(this.sql, {
      organizationId: tenant.organizationId,
      dealId,
      reporterUserId: tenant.userId,
      trigger: input.trigger,
      fingerprint,
      title: String(scrubContext(input.title)),
      whatHappened: input.whatHappened === null ? null : String(scrubContext(input.whatHappened)),
      expected: input.expected === null ? null : String(scrubContext(input.expected)),
      severity: input.severity,
      context,
      screenshot,
      screenshotType: screenshot ? (input.screenshot?.contentType ?? null) : null,
    });
    return { id: filed.id, reference: bugReference(filed.number), deduplicated: filed.deduplicated };
  }

  /** A server error the user hit: filed automatically, deduplicated by fingerprint. Never throws. */
  async fileServerError(input: { organizationId: string; userId: string | null; route: string; errorName: string; stack: string | null; requestId: string }): Promise<void> {
    try {
      await operatorOps.fileBug(this.sql, {
        organizationId: input.organizationId,
        dealId: null,
        reporterUserId: input.userId,
        trigger: 'BACKEND_EXCEPTION',
        fingerprint: bugFingerprint({ errorName: input.errorName, stack: input.stack, route: input.route }),
        title: `Server error: ${input.errorName} on ${input.route.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id')}`.slice(0, 200),
        whatHappened: null,
        expected: null,
        severity: 'HIGH',
        context: scrubContext({ route: input.route, errorName: input.errorName, stack: input.stack, requestId: input.requestId, environment: this.settings.environment, appVersion: this.settings.appVersion }) as Record<string, unknown>,
        screenshot: null,
        screenshotType: null,
      });
    } catch {
      // Bug filing must never turn one failure into two.
    }
  }

  async myBugs(tenant: TenantContext): Promise<{ items: BugReportSummaryView[] }> {
    return { items: (await operatorOps.bugs(this.sql, tenant.userId, true)).map(summary) };
  }

  bugs(tenant: TenantContext) {
    return this.asOperator(async () => ({ items: (await operatorOps.bugs(this.sql, tenant.userId, false)).map(summary) }));
  }

  bug(tenant: TenantContext, bugId: string): Promise<BugReportDetailView> {
    return this.asOperator(async () => {
      const row = await operatorOps.bug(this.sql, tenant.userId, bugId);
      if (!row) throw new NotFoundException();
      return {
        ...summary(row),
        organizationId: row.organizationId,
        dealId: row.dealId,
        reporterUserId: row.reporterUserId,
        fingerprint: row.fingerprint,
        whatHappened: row.whatHappened,
        expected: row.expected,
        context: row.context,
        internalNotes: row.internalNotes,
      };
    });
  }

  screenshot(tenant: TenantContext, bugId: string) {
    return this.asOperator(async () => {
      const row = await operatorOps.bug(this.sql, tenant.userId, bugId);
      if (!row?.screenshot || !row.screenshotType) throw new NotFoundException();
      return { bytes: row.screenshot, contentType: row.screenshotType };
    });
  }

  triage(tenant: TenantContext, bugId: string, input: TriageBugInput) {
    return this.asOperator(async () => {
      if (!(await operatorOps.triageBug(this.sql, tenant.userId, bugId, input))) throw new NotFoundException();
      return this.bug(tenant, bugId);
    });
  }

  /**
   * A confirmed bug as a T-style task file for `tasks/ready/` (copy or
   * download; no repository credentials in the app). Built only from the
   * already-scrubbed report, so it carries no secrets.
   */
  async exportTask(tenant: TenantContext, bugId: string, consoleUrl: string): Promise<{ fileName: string; markdown: string }> {
    const bug = await this.bug(tenant, bugId);
    const context = bug.context as { route?: string; error?: { name?: string; message?: string; stack?: string }; userAgent?: string; appVersion?: string; environment?: string };
    const markdown = [
      `# ${bug.reference} — ${bug.title}`,
      '',
      `Status: ready`,
      `Needs: none`,
      `Touches: (decide from the suspect paths below)`,
      `Lane: core`,
      `Context: standard`,
      `Checks: pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`,
      '',
      `## Report`,
      '',
      `- **Severity:** ${bug.severity} · **Trigger:** ${bug.trigger} · **Occurrences:** ${bug.occurrences} (first ${bug.firstSeenAt.slice(0, 10)}, last ${bug.lastSeenAt.slice(0, 10)})`,
      `- **What happened:** ${bug.whatHappened ?? '—'}`,
      `- **Expected:** ${bug.expected ?? '—'}`,
      '',
      `## Reproduce`,
      '',
      `1. Sign in to the ${context.environment ?? 'local'} environment as a member of an organization like the reporter's.`,
      `2. Open \`${context.route ?? '(route not recorded)'}\`.`,
      `3. Repeat the action described above; the failure should reproduce.`,
      '',
      `## Context (scrubbed)`,
      '',
      '```',
      `app version: ${context.appVersion ?? '—'}`,
      `browser: ${context.userAgent ?? '—'}`,
      `error: ${context.error ? `${context.error.name ?? ''}: ${context.error.message ?? ''}` : '—'}`,
      context.error?.stack ? `stack:\n${context.error.stack}` : 'stack: —',
      '```',
      '',
      bug.hasScreenshot ? `Screenshot: ${consoleUrl}/admin/bugs/${bug.id} (operators only)` : 'Screenshot: none attached',
      '',
      `## Acceptance`,
      '',
      `- The steps above no longer fail; a regression test covers them.`,
      `- No new secrets, people data or deal content appear in logs or bug context.`,
      '',
    ].join('\n');
    return { fileName: `${bug.reference}.md`, markdown };
  }
}

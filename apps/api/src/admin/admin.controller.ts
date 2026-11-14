import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Res } from '@nestjs/common';
import {
  adminBugParamsSchema,
  myBugParamsSchema,
  adminMemberParamsSchema,
  adminOrganizationParamsSchema,
  auditQuerySchema,
  decideOrganizationSchema,
  fileBugReportSchema,
  memberStatusSchema,
  organizationFlagsSchema,
  organizationStatusSchema,
  triageBugSchema,
  usersQuerySchema,
  type FileBugReportInput,
  type TriageBugInput,
} from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AdminService } from './admin.service';

const slugParams = z.strictObject({ slug: z.string().regex(/^[a-z0-9-]{2,80}$/) });
const optional = (schema: z.ZodString) => z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? null : value), schema.nullable().default(null));
const shareDemoSchema = z.strictObject({
  sharedWith: z.string().trim().min(1).max(200),
  hours: z.union([z.literal(24), z.literal(72), z.literal(168)]),
  // Optional: Pactlab emails the links (T-113 follow-up). Without it, copy the invite text.
  recipientEmail: z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? null : value), z.email().max(320).nullable().default(null)),
  recipientName: optional(z.string().trim().max(120)),
  note: optional(z.string().trim().max(1000)),
});
const demoShareParams = z.strictObject({ shareId: z.uuid() });

/** Operator console (T-072). Every route answers 403 to anyone who is not a platform operator. */
@Controller('v1/admin')
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get()
  overview(@Tenant() tenant: TenantContext) {
    return this.admin.overview(tenant);
  }

  @Get('email-health')
  emailHealth(@Tenant() tenant: TenantContext) {
    return this.admin.emailHealth(tenant);
  }

  @Get('approvals')
  pending(@Tenant() tenant: TenantContext) {
    return this.admin.pending(tenant);
  }

  @Post('approvals/:slug')
  @HttpCode(200)
  decide(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(slugParams)) params: { slug: string }, @Body(new ZodValidationPipe(decideOrganizationSchema)) body: { decision: 'approve' | 'reject' }) {
    return this.admin.decide(tenant, params.slug, body.decision);
  }

  // Shared demos (T-113): the pool, lend one, end a share, rebuild a slot.
  @Get('demos')
  demoSlots(@Tenant() tenant: TenantContext) {
    return this.admin.demoSlots(tenant);
  }

  @Post('demos')
  @HttpCode(201)
  shareDemo(@Tenant() tenant: TenantContext, @Body(new ZodValidationPipe(shareDemoSchema)) body: z.infer<typeof shareDemoSchema>) {
    return this.admin.shareDemo(tenant, body);
  }

  @Post('demos/shares/:shareId/end')
  @HttpCode(200)
  endDemoShare(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(demoShareParams)) params: { shareId: string }) {
    return this.admin.endDemoShare(tenant, params.shareId);
  }

  @Post('demos/slots/:organizationId/reset')
  @HttpCode(200)
  resetDemoSlot(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(adminOrganizationParamsSchema)) params: { organizationId: string }) {
    return this.admin.resetDemoSlot(tenant, params.organizationId);
  }

  @Get('organizations')
  organizations(@Tenant() tenant: TenantContext) {
    return this.admin.organizations(tenant);
  }

  @Put('organizations/:organizationId/status')
  setStatus(
    @Tenant() tenant: TenantContext,
    @Param(new ZodValidationPipe(adminOrganizationParamsSchema)) params: { organizationId: string },
    @Body(new ZodValidationPipe(organizationStatusSchema)) body: { status: 'ACTIVE' | 'SUSPENDED' },
  ) {
    return this.admin.setOrganizationStatus(tenant, params.organizationId, body.status);
  }

  @Put('organizations/:organizationId/flags')
  setFlags(
    @Tenant() tenant: TenantContext,
    @Param(new ZodValidationPipe(adminOrganizationParamsSchema)) params: { organizationId: string },
    @Body(new ZodValidationPipe(organizationFlagsSchema)) body: { pilotMode: boolean; liveConnectors: boolean },
  ) {
    return this.admin.setFlags(tenant, params.organizationId, body);
  }

  /** MCP per organization (T-084). */
  @Put('organizations/:organizationId/mcp')
  setMcp(
    @Tenant() tenant: TenantContext,
    @Param(new ZodValidationPipe(adminOrganizationParamsSchema)) params: { organizationId: string },
    @Body(new ZodValidationPipe(z.strictObject({ enabled: z.boolean() }))) body: { enabled: boolean },
  ) {
    return this.admin.setMcp(tenant, params.organizationId, body.enabled);
  }

  @Get('mcp')
  mcpOrganizations(@Tenant() tenant: TenantContext) {
    return this.admin.mcpOrganizations(tenant);
  }

  @Get('users')
  users(@Tenant() tenant: TenantContext, @Query(new ZodValidationPipe(usersQuerySchema)) query: { organizationId?: string; q?: string }) {
    return this.admin.users(tenant, query);
  }

  @Put('organizations/:organizationId/members/:userId/status')
  setMemberStatus(
    @Tenant() tenant: TenantContext,
    @Param(new ZodValidationPipe(adminMemberParamsSchema)) params: { organizationId: string; userId: string },
    @Body(new ZodValidationPipe(memberStatusSchema)) body: { status: 'ACTIVE' | 'SUSPENDED' },
  ) {
    return this.admin.setMemberStatus(tenant, params.organizationId, params.userId, body.status);
  }

  @Get('connections')
  connections(@Tenant() tenant: TenantContext) {
    return this.admin.connections(tenant);
  }

  @Get('audit')
  audit(@Tenant() tenant: TenantContext, @Query(new ZodValidationPipe(auditQuerySchema)) query: { action?: string; since?: string }) {
    return this.admin.audit(tenant, query);
  }

  @Get('bugs')
  bugs(@Tenant() tenant: TenantContext) {
    return this.admin.bugs(tenant);
  }

  @Get('bugs/:bugId')
  bug(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(adminBugParamsSchema)) params: { bugId: string }) {
    return this.admin.bug(tenant, params.bugId);
  }

  @Get('bugs/:bugId/screenshot')
  async screenshot(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(adminBugParamsSchema)) params: { bugId: string }, @Res({ passthrough: true }) reply: FastifyReply) {
    const image = await this.admin.screenshot(tenant, params.bugId);
    void reply.header('content-type', image.contentType).header('cache-control', 'private, no-store').header('x-content-type-options', 'nosniff');
    return Buffer.from(image.bytes);
  }

  @Put('bugs/:bugId')
  triage(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(adminBugParamsSchema)) params: { bugId: string }, @Body(new ZodValidationPipe(triageBugSchema)) body: TriageBugInput) {
    return this.admin.triage(tenant, params.bugId, body);
  }

  @Get('bugs/:bugId/task')
  exportTask(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(adminBugParamsSchema)) params: { bugId: string }, @Query('consoleUrl') consoleUrl?: string) {
    return this.admin.exportTask(tenant, params.bugId, consoleUrl && /^https?:\/\/[\w.:-]+$/.test(consoleUrl) ? consoleUrl : '');
  }
}

/** Bug reports from any signed-in user, and their own reports' status. */
@Controller('v1/bug-reports')
export class BugReportsController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Post()
  file(@Tenant() tenant: TenantContext, @Body(new ZodValidationPipe(fileBugReportSchema)) body: FileBugReportInput) {
    return this.admin.fileBug(tenant, body);
  }

  @Get('mine')
  mine(@Tenant() tenant: TenantContext) {
    return this.admin.myBugs(tenant);
  }

  @Get('mine/:bugId')
  mineOne(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(myBugParamsSchema)) params: { bugId: string }) {
    return this.admin.myBug(tenant, params.bugId);
  }

  @Get('mine/:bugId/screenshot')
  async mineScreenshot(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(myBugParamsSchema)) params: { bugId: string }, @Res({ passthrough: true }) reply: FastifyReply) {
    const image = await this.admin.myScreenshot(tenant, params.bugId);
    void reply.header('content-type', image.contentType).header('cache-control', 'private, no-store').header('x-content-type-options', 'nosniff');
    return Buffer.from(image.bytes);
  }
}

/** The caller's organization's feature flags (set by operators, read by the app). */
@Controller('v1/organization/flags')
export class OrganizationFlagsController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get()
  flags(@Tenant() tenant: TenantContext) {
    return this.admin.flags(tenant);
  }
}

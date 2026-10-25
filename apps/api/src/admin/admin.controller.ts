import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Res } from '@nestjs/common';
import {
  adminBugParamsSchema,
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

/** Operator console (T-072). Every route answers 403 to anyone who is not a platform operator. */
@Controller('v1/admin')
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get()
  overview(@Tenant() tenant: TenantContext) {
    return this.admin.overview(tenant);
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

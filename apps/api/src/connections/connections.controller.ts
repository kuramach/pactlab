import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import {
  connectGitHubSchema,
  connectionParamsSchema,
  createConnectionSchema,
  dryRunSchema,
  idempotencyKeySchema,
  requestSyncRunSchema,
  setModeSchema,
  syncRunParamsSchema,
  type ConnectGitHubCommand,
  type CreateConnectionCommand,
  type SetModeCommand,
} from './connections.schemas';
import { ConnectionsService } from './connections.service';

type ConnectionParams = { dealId: string; connectionId: string };

@Controller('v1/deals/:dealId')
export class ConnectionsController {
  constructor(@Inject(ConnectionsService) private readonly service: ConnectionsService) {}

  @Get('connections')
  async list(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
  ) {
    return { items: await this.service.list(tenant, params.dealId, requestId) };
  }

  @Post('connections')
  @HttpCode(201)
  async create(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Body(new ZodValidationPipe(createConnectionSchema)) body: CreateConnectionCommand,
  ) {
    return this.service.create(tenant, params.dealId, body, requestId);
  }

  /** Connect a repository live, via Pactlab's GitHub App or a seller token; returns the connection checks. */
  @Post('connections/github')
  @HttpCode(201)
  async connectGitHub(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Body(new ZodValidationPipe(connectGitHubSchema)) body: ConnectGitHubCommand,
  ) {
    return this.service.connectGitHub(tenant, params.dealId, body, requestId);
  }

  @Put('connections/:connectionId/mode')
  async setMode(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(connectionParamsSchema)) params: ConnectionParams,
    @Body(new ZodValidationPipe(setModeSchema)) body: SetModeCommand,
  ) {
    return this.service.setMode(tenant, params.dealId, params.connectionId, body, requestId);
  }

  @Post('connections/:connectionId/validate')
  @HttpCode(200)
  async validate(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(connectionParamsSchema)) params: ConnectionParams,
  ) {
    return this.service.validate(tenant, params.dealId, params.connectionId, requestId);
  }

  @Post('connections/:connectionId/dry-run')
  @HttpCode(200)
  async dryRun(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(connectionParamsSchema)) params: ConnectionParams,
    @Body(new ZodValidationPipe(dryRunSchema)) body: { limit: number },
  ) {
    return this.service.dryRun(tenant, params.dealId, params.connectionId, body.limit, requestId);
  }

  /** Long-running command: 202 with the run resource. Requires an Idempotency-Key header. */
  @Post('sync-runs')
  @HttpCode(202)
  async requestSync(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Body(new ZodValidationPipe(requestSyncRunSchema)) body: { connectionId: string },
  ) {
    const key = idempotencyKeySchema.safeParse(idempotencyKey);
    if (!key.success) throw new BadRequestException();
    return this.service.requestSync(tenant, params.dealId, body.connectionId, key.data, requestId);
  }

  @Get('sync-runs/:runId')
  async getRun(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(syncRunParamsSchema)) params: { dealId: string; runId: string },
  ) {
    return this.service.getRun(tenant, params.dealId, params.runId, requestId);
  }
}

/** Deployment-level GitHub App details for the connect screen. */
@Controller('v1/github')
export class GitHubAppController {
  constructor(@Inject(ConnectionsService) private readonly service: ConnectionsService) {}

  @Get('app')
  app() {
    return this.service.githubApp();
  }
}

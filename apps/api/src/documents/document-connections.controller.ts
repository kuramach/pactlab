import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import type { TenantContext } from '@pactlab/domain';
import { z } from 'zod';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { DocumentConnectionsService } from './document-connections.service';

const providerParams = z.strictObject({ provider: z.enum(['google-drive', 'onedrive']) });
/** What the provider sent the person back with; the code is single-use and short-lived. */
const callbackBody = z.strictObject({ code: z.string().min(1).max(4000), state: z.string().min(1).max(500) });

/** The organization's Google Drive and OneDrive / SharePoint sign-ins (T-147). Owners and admins change them. */
@Controller('v1/organization/document-connections')
export class DocumentConnectionsController {
  constructor(@Inject(DocumentConnectionsService) private readonly connections: DocumentConnectionsService) {}

  @Get()
  async list(@Tenant() tenant: TenantContext) {
    return this.connections.list(tenant);
  }

  @Post(':provider/start')
  @HttpCode(200)
  start(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(providerParams)) params: { provider: string }) {
    return this.connections.start(tenant, params.provider);
  }

  @Post(':provider/callback')
  @HttpCode(200)
  async callback(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(providerParams)) params: { provider: string },
    @Body(new ZodValidationPipe(callbackBody)) body: { code: string; state: string },
  ) {
    return this.connections.callback(tenant, params.provider, body.code, body.state, requestId);
  }

  @Post(':provider/disconnect')
  @HttpCode(200)
  async disconnect(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(providerParams)) params: { provider: string }) {
    return this.connections.disconnect(tenant, params.provider, requestId);
  }
}

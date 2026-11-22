import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import type { TenantContext } from '@pactlab/domain';
import { z } from 'zod';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { DocumentConnectionsService } from './document-connections.service';
import { DocumentSourcesService } from './document-sources.service';

const providerParams = z.strictObject({ provider: z.enum(['google-drive', 'onedrive']) });
/** What the provider sent the person back with; the code is single-use and short-lived. */
const callbackBody = z.strictObject({ code: z.string().min(1).max(4000), state: z.string().min(1).max(500) });

/** The organization's Google Drive and OneDrive / SharePoint sign-ins (T-147). Owners and admins change them. */
@Controller('v1')
export class DocumentConnectionsController {
  constructor(
    @Inject(DocumentConnectionsService) private readonly connections: DocumentConnectionsService,
    @Inject(DocumentSourcesService) private readonly sources: DocumentSourcesService,
  ) {}

  /**
   * Every drive sign-in comes back here (the provider's one registered callback): the signed state says
   * whether it was the organization's (back to Settings) or one person's for a pact's folder (back to the pact).
   */
  @Post('document-sign-ins/:provider/callback')
  @HttpCode(200)
  async signedIn(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(providerParams)) params: { provider: string },
    @Body(new ZodValidationPipe(callbackBody)) body: { code: string; state: string },
  ) {
    const state = this.connections.verifiedState(tenant, params.provider, body.state);
    if (state.k === 'org') {
      await this.connections.completeOrganization(tenant, params.provider, body.code, requestId);
      return { kind: 'org' as const };
    }
    return { kind: 'pact' as const, ...(await this.sources.completeSignIn(tenant, state, body.code, requestId)) };
  }

  @Get('organization/document-connections')
  async list(@Tenant() tenant: TenantContext) {
    return this.connections.list(tenant);
  }

  @Post('organization/document-connections/:provider/start')
  @HttpCode(200)
  start(@Tenant() tenant: TenantContext, @Param(new ZodValidationPipe(providerParams)) params: { provider: string }) {
    return this.connections.start(tenant, params.provider);
  }

  @Post('organization/document-connections/:provider/callback')
  @HttpCode(200)
  async callback(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(providerParams)) params: { provider: string },
    @Body(new ZodValidationPipe(callbackBody)) body: { code: string; state: string },
  ) {
    return this.connections.callback(tenant, params.provider, body.code, body.state, requestId);
  }

  @Post('organization/document-connections/:provider/disconnect')
  @HttpCode(200)
  async disconnect(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(providerParams)) params: { provider: string }) {
    return this.connections.disconnect(tenant, params.provider, requestId);
  }
}

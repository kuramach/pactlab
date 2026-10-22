import { Body, Controller, Get, Header, HttpCode, Inject, NotFoundException, Param, Post, Query } from '@nestjs/common';
import {
  dealParamsSchema,
  importTargetParamsSchema,
  mappingBodySchema,
  uploadParamsSchema,
  uploadQuerySchema,
  type BillingSystemView,
  type ImportMappingBody,
  type ImportPreviewView,
  type ImportResultView,
  type ImportTargetView,
  type SourceUploadView,
  type UploadDetailView,
  type UploadQuery,
} from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { ImportsService } from './imports.service';

type UploadParams = { dealId: string; uploadId: string };

@Controller('v1')
export class ImportsController {
  constructor(@Inject(ImportsService) private readonly imports: ImportsService) {}

  /** Billing systems an export can come from, with whether their columns are verified. */
  @Get('billing-import/systems')
  systems(): { items: BillingSystemView[] } {
    return { items: this.imports.systems() };
  }

  /** CSV import targets the deal's pack offers, with their standard templates (ADR 0010). */
  @Get('deals/:dealId/import-targets')
  async importTargets(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
  ): Promise<{ items: ImportTargetView[] }> {
    return { items: await this.imports.importTargets(tenant, params.dealId, requestId) };
  }

  /** One target's Pactlab standard template, as a CSV header to fill in. */
  @Get('deals/:dealId/import-targets/:target/template.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  async template(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(importTargetParamsSchema)) params: { dealId: string; target: string },
  ): Promise<string> {
    const target = (await this.imports.importTargets(tenant, params.dealId, requestId)).find((item) => item.target === params.target);
    if (!target) throw new NotFoundException();
    return target.templateCsv;
  }

  /** Raw `text/csv` body (up to 10 MB); system and file name in the query. */
  @Post('deals/:dealId/uploads')
  @HttpCode(201)
  async upload(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Query(new ZodValidationPipe(uploadQuerySchema)) query: UploadQuery,
    @Body() body: unknown,
  ): Promise<UploadDetailView> {
    return this.imports.upload(tenant, params.dealId, query, body, requestId);
  }

  @Get('deals/:dealId/uploads')
  async list(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
  ): Promise<{ items: SourceUploadView[] }> {
    return { items: await this.imports.list(tenant, params.dealId, requestId) };
  }

  @Get('deals/:dealId/uploads/:uploadId')
  async get(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(uploadParamsSchema)) params: UploadParams,
  ): Promise<UploadDetailView> {
    return this.imports.get(tenant, params.dealId, params.uploadId, requestId);
  }

  @Post('deals/:dealId/uploads/:uploadId/preview')
  @HttpCode(200)
  async preview(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(uploadParamsSchema)) params: UploadParams,
    @Body(new ZodValidationPipe(mappingBodySchema)) body: { mapping: ImportMappingBody },
  ): Promise<ImportPreviewView> {
    return this.imports.preview(tenant, params.dealId, params.uploadId, body.mapping, requestId);
  }

  @Post('deals/:dealId/uploads/:uploadId/import')
  @HttpCode(200)
  async import(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(uploadParamsSchema)) params: UploadParams,
    @Body(new ZodValidationPipe(mappingBodySchema)) body: { mapping: ImportMappingBody },
  ): Promise<ImportResultView> {
    return this.imports.import(tenant, params.dealId, params.uploadId, body.mapping, requestId);
  }
}

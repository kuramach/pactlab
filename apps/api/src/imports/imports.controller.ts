import { Body, Controller, Get, Header, HttpCode, Inject, NotFoundException, Param, Post, Query } from '@nestjs/common';
import {
  dealParamsSchema,
  documentImportBodySchema,
  documentImportParamsSchema,
  importRunParamsSchema,
  importTargetParamsSchema,
  sheetBodySchema,
  type ImportProgressView,
  mappingBodySchema,
  uploadParamsSchema,
  pageQuerySchema,
  uploadQuerySchema,
  type BillingSystemView,
  type ImportMappingBody,
  type ImportPreviewView,
  type ImportTargetView,
  type Page,
  type PageQuery,
  type UploadQuery,
} from '@pactlab/contracts';
import type { ImportLineageEntry, ImportTarget, TenantContext, WithdrawalResultView } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { ImportsService, type ImportResult, type UploadDetail, type UploadView } from './imports.service';
import { reimportQuerySchema, withdrawBodySchema, type ReimportQuery, type WithdrawBody } from './withdrawal.schemas';

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

  /** The raw file (CSV, TSV or Excel, up to 50 MB); system and file name in the query. */
  @Post('deals/:dealId/uploads')
  @HttpCode(201)
  async upload(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Query(new ZodValidationPipe(uploadQuerySchema)) query: UploadQuery,
    @Body() body: unknown,
  ): Promise<UploadDetail> {
    return this.imports.upload(tenant, params.dealId, query, body, requestId);
  }

  /** Import a spreadsheet already in the pact's documents, as one of the pact's import targets. */
  @Post('deals/:dealId/documents/:documentId/import')
  @HttpCode(201)
  async fromDocument(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(documentImportParamsSchema)) params: { dealId: string; documentId: string },
    @Body(new ZodValidationPipe(documentImportBodySchema)) body: { target: ImportTarget },
  ): Promise<UploadDetail> {
    return this.imports.fromDocument(tenant, params.dealId, params.documentId, body.target, requestId);
  }

  @Get('deals/:dealId/uploads')
  async list(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: { dealId: string },
    @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
  ): Promise<Page<UploadView>> {
    return this.imports.list(tenant, params.dealId, query, requestId);
  }

  @Get('deals/:dealId/uploads/:uploadId')
  async get(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(uploadParamsSchema)) params: UploadParams,
  ): Promise<UploadDetail> {
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

  /** Read another sheet of an Excel upload before import. */
  @Post('deals/:dealId/uploads/:uploadId/sheet')
  @HttpCode(200)
  async selectSheet(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(uploadParamsSchema)) params: UploadParams,
    @Body(new ZodValidationPipe(sheetBodySchema)) body: { sheet: string },
  ): Promise<UploadDetail> {
    return this.imports.selectSheet(tenant, params.dealId, params.uploadId, body, requestId);
  }

  /** Read the upload afresh, past a saved format (ADR 0042): the assistant reads it as a new layout. */
  @Post('deals/:dealId/uploads/:uploadId/read-fresh')
  @HttpCode(200)
  async readFresh(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(uploadParamsSchema)) params: UploadParams,
  ): Promise<UploadDetail> {
    return this.imports.selectSheet(tenant, params.dealId, params.uploadId, { fresh: true }, requestId);
  }

  /** How far an import has got; a background import is followed by polling this. */
  @Get('deals/:dealId/import-runs/:runId')
  async progress(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(importRunParamsSchema)) params: { dealId: string; runId: string },
  ): Promise<ImportProgressView> {
    return this.imports.progress(tenant, params.dealId, params.runId, requestId);
  }

  /** Discard an upload that was the wrong file (never imported); the stored copy is deleted. */
  @Post('deals/:dealId/uploads/:uploadId/cancel')
  @HttpCode(200)
  async cancel(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(uploadParamsSchema)) params: UploadParams,
  ): Promise<UploadView> {
    return this.imports.cancel(tenant, params.dealId, params.uploadId, requestId);
  }

  @Post('deals/:dealId/uploads/:uploadId/import')
  @HttpCode(200)
  async import(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(uploadParamsSchema)) params: UploadParams,
    @Body(new ZodValidationPipe(mappingBodySchema)) body: { mapping: ImportMappingBody },
  ): Promise<ImportResult> {
    return this.imports.import(tenant, params.dealId, params.uploadId, body.mapping, requestId);
  }

  /**
   * Withdraw an imported upload (T-154, manage rights): its data stops counting everywhere,
   * artefacts built on it are flagged, and the record stays in the import history.
   */
  @Post('deals/:dealId/uploads/:uploadId/withdraw')
  @HttpCode(200)
  async withdraw(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(uploadParamsSchema)) params: UploadParams,
    @Body(new ZodValidationPipe(withdrawBodySchema)) body: WithdrawBody,
  ): Promise<{ upload: UploadView; result: WithdrawalResultView }> {
    return this.imports.withdraw(tenant, params.dealId, params.uploadId, body.reason, requestId);
  }

  /** Re-import a withdrawn upload: a corrected file as the raw body, or no body to read the stored original again. */
  @Post('deals/:dealId/uploads/:uploadId/reimport')
  @HttpCode(201)
  async reimport(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(uploadParamsSchema)) params: UploadParams,
    @Query(new ZodValidationPipe(reimportQuerySchema)) query: ReimportQuery,
    @Body() body: unknown,
  ): Promise<UploadDetail> {
    return this.imports.reimport(tenant, params.dealId, params.uploadId, query.fileName, body, requestId);
  }

  /** What the import picked up, which metrics read it and what it raised (Kumar, 2026-11-25). */
  @Get('deals/:dealId/uploads/:uploadId/results')
  async results(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(uploadParamsSchema)) params: UploadParams) {
    return this.imports.results(tenant, params.dealId, params.uploadId, requestId);
  }

  /** The import's chain of re-imports, with each withdrawal and its reason (manage rights). */
  @Get('deals/:dealId/uploads/:uploadId/history')
  async history(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(uploadParamsSchema)) params: UploadParams,
  ): Promise<{ chain: ImportLineageEntry[] }> {
    return this.imports.history(tenant, params.dealId, params.uploadId, requestId);
  }
}

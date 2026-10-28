import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import {
  askQuestionBodySchema,
  categorizeDocumentBodySchema,
  documentParamsSchema,
  findingParamsSchema,
  listFindingsQuerySchema,
  pageParamsSchema,
  reviewFindingBodySchema,
  uploadArchiveBodySchema,
  uploadDocumentBodySchema,
  type AskQuestionBody,
  type CategorizeDocumentBody,
  type ListDocumentFindingsQuery,
  type ReviewDocumentFindingBody,
  type UploadArchiveBody,
  type UploadDocumentBody,
} from './documents.schemas';
import { DocumentsService } from './documents.service';

type DealParams = { dealId: string };
type DocumentParams = { dealId: string; documentId: string };

@Controller('v1/deals/:dealId')
export class DocumentsController {
  constructor(@Inject(DocumentsService) private readonly service: DocumentsService) {}

  @Post('documents')
  async upload(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams,
    @Body(new ZodValidationPipe(uploadDocumentBodySchema)) body: UploadDocumentBody,
  ) {
    return this.service.upload(tenant, params.dealId, body, requestId);
  }

  /** A zip of deal files, unpacked on the server (T-098). */
  @Post('document-archives')
  async uploadArchive(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams,
    @Body(new ZodValidationPipe(uploadArchiveBodySchema)) body: UploadArchiveBody,
  ) {
    return this.service.uploadArchive(tenant, params.dealId, body, requestId);
  }

  /** The intake checklist, the files waiting for a person, and the request for what is missing. */
  @Get('intake')
  async intake(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams,
  ) {
    return this.service.intake(tenant, params.dealId, requestId);
  }

  @Get('documents')
  async list(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams,
  ) {
    return this.service.list(tenant, params.dealId, requestId);
  }

  @Get('documents/:documentId')
  async get(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(documentParamsSchema)) params: DocumentParams,
  ) {
    return this.service.get(tenant, params.dealId, params.documentId, requestId);
  }

  /** The stored original, inline; the review screen renders PDFs from it. */
  @Get('documents/:documentId/original')
  async original(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(documentParamsSchema)) params: DocumentParams,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const file = await this.service.original(tenant, params.dealId, params.documentId, requestId);
    void reply
      .header('content-type', file.contentType)
      .header('content-disposition', `inline; filename="${file.fileName.replace(/[^\w.-]/g, '_')}"`)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, no-store');
    return Buffer.from(file.bytes);
  }

  @Get('documents/:documentId/pages/:pageNumber')
  async page(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(pageParamsSchema)) params: DocumentParams & { pageNumber: number },
  ) {
    return this.service.page(
      tenant,
      params.dealId,
      params.documentId,
      params.pageNumber,
      requestId,
    );
  }

  @Delete('documents/:documentId')
  async purge(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(documentParamsSchema)) params: DocumentParams,
  ) {
    return this.service.purge(tenant, params.dealId, params.documentId, requestId);
  }

  /** The AI reads the file and files it, or leaves a question for a person. */
  @Post('documents/:documentId/classification')
  @HttpCode(200)
  async classify(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(documentParamsSchema)) params: DocumentParams,
  ) {
    return this.service.classify(tenant, params.dealId, params.documentId, requestId);
  }

  /** A person's answer or correction. */
  @Put('documents/:documentId/category')
  async categorize(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(documentParamsSchema)) params: DocumentParams,
    @Body(new ZodValidationPipe(categorizeDocumentBodySchema)) body: CategorizeDocumentBody,
  ) {
    return this.service.categorize(tenant, params.dealId, params.documentId, body, requestId);
  }

  @Post('documents/:documentId/extractions')
  async extract(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(documentParamsSchema)) params: DocumentParams,
  ) {
    return this.service.extract(tenant, params.dealId, params.documentId, requestId);
  }

  @Post('questions')
  @HttpCode(200)
  async ask(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams,
    @Body(new ZodValidationPipe(askQuestionBodySchema)) body: AskQuestionBody,
  ) {
    return this.service.ask(tenant, params.dealId, body, requestId);
  }

  @Get('document-findings')
  async listFindings(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(dealParamsSchema)) params: DealParams,
    @Query(new ZodValidationPipe(listFindingsQuerySchema)) query: ListDocumentFindingsQuery,
  ) {
    return this.service.listFindings(tenant, params.dealId, query, requestId);
  }

  @Get('document-findings/:findingId')
  async getFinding(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(findingParamsSchema))
    params: { dealId: string; findingId: string },
  ) {
    return this.service.getFinding(tenant, params.dealId, params.findingId, requestId);
  }

  @Post('document-findings/:findingId/reviews')
  async review(
    @Tenant() tenant: TenantContext,
    @RequestId() requestId: string,
    @Param(new ZodValidationPipe(findingParamsSchema))
    params: { dealId: string; findingId: string },
    @Body(new ZodValidationPipe(reviewFindingBodySchema)) body: ReviewDocumentFindingBody,
  ) {
    return this.service.review(tenant, params.dealId, params.findingId, body, requestId);
  }
}

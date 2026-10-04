import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { dealParamsSchema } from '@pactlab/contracts';
import type { TenantContext } from '@pactlab/domain';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import {
  askQuestionBodySchema,
  documentParamsSchema,
  findingParamsSchema,
  listFindingsQuerySchema,
  pageParamsSchema,
  reviewFindingBodySchema,
  uploadDocumentBodySchema,
  type AskQuestionBody,
  type ListDocumentFindingsQuery,
  type ReviewDocumentFindingBody,
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

import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { TenantContext } from '@pactlab/domain';
import type { FastifyReply } from 'fastify';
import { Tenant } from '../auth/tenant.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequestId } from '../deals/request-id.decorator';
import { generateReportSchema, reportHistoryQuerySchema, reportParamsSchema } from './reports.schemas';
import { ReportsService } from './reports.service';

/** Reports (T-110): generate a version, list the history, download a PDF. */
@Controller('v1/reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly service: ReportsService) {}

  @Post()
  @HttpCode(202)
  generate(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Body(new ZodValidationPipe(generateReportSchema)) body: { scope: 'EXECUTIVE' | 'PACT'; dealId?: string }) {
    return this.service.generate(tenant, body.scope, body.dealId ?? null, requestId);
  }

  @Get()
  history(@Tenant() tenant: TenantContext, @Query(new ZodValidationPipe(reportHistoryQuerySchema)) query: { scope?: 'EXECUTIVE' | 'PACT'; dealId?: string }) {
    return this.service.history(tenant, query);
  }

  @Get(':id/pdf')
  async download(@Tenant() tenant: TenantContext, @RequestId() requestId: string, @Param(new ZodValidationPipe(reportParamsSchema)) params: { id: string }, @Res() reply: FastifyReply) {
    const { bytes, fileName } = await this.service.download(tenant, params.id, requestId);
    await reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${fileName}"`)
      .header('cache-control', 'private, no-store')
      .send(Buffer.from(bytes));
  }
}

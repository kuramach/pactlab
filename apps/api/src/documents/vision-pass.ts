import { Inject, Injectable } from '@nestjs/common';
import { GatewayPolicyError, readPageImage, sha256Hex, type ClaudeGateway, type ModelImage } from '@pactlab/ai';
import { appendAuditEvent, withTenant, type PrismaClient } from '@pactlab/db';
import type { TenantContext } from '@pactlab/domain';
import type { Logger } from '@pactlab/observability';
import { LOGGER, PRISMA } from '../tokens';
import { CLAUDE_GATEWAY, DOCUMENT_OBJECT_STORE, type DocumentObjectStore } from './documents.repository';
import { DOCX_CONTENT_TYPE, PPTX_CONTENT_TYPE, XLSX_CONTENT_TYPE } from './documents.types';
import { fitImage, officeImage, officeMedia, pptxSlides, renderPdfPage } from './page-images';

/** A reading that stopped this long ago (a restart) may be started again. */
const STALE_MS = 15 * 60_000;
/** At most this many pictures of one slide are read together. */
const MAX_IMAGES_PER_PAGE = 4;

type Failure = { page: number; reason: string };

/**
 * Reading pages from their images (T-121), after upload, one page at a time: a scan, an uploaded image, a
 * PowerPoint slide's pictures, the pictures inside a Word or Excel file, or a chart on a text PDF page.
 * The reading becomes the page's text (or is added under "From the page image:"), so every other job works
 * on it unchanged. Progress and what could not be read are on the document; nothing fails silently (T-125).
 * It runs as the uploader, under RLS, in the background; a reading stopped by a restart can be started again.
 */
@Injectable()
export class VisionPass {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DOCUMENT_OBJECT_STORE) private readonly objects: DocumentObjectStore,
    @Inject(CLAUDE_GATEWAY) private readonly gateway: ClaudeGateway,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /** Start (or restart) the reading in the background; returns at once. */
  start(tenant: TenantContext, dealId: string, documentId: string): void {
    // handled: a failure is recorded on the document (FAILED, with the reason), where the pact team sees it.
    void this.run(tenant, dealId, documentId).catch(async (error: unknown) => {
      this.logger.error({ documentId, errorClass: error instanceof Error ? error.name : 'unknown' }, 'vision pass failed');
      // silent-ok: the failure is logged just above; if even this write fails, the document stays READING and Read again restarts it.
      await this.finish(tenant, dealId, documentId, 'FAILED', [{ page: 0, reason: 'The reading stopped unexpectedly; start it again.' }]).catch(() => undefined);
    });
  }

  async run(tenant: TenantContext, dealId: string, documentId: string): Promise<void> {
    // Claim: one reading at a time per document; a stale one (a restart) may be taken over.
    // As the caller, through app_vision_claim: a seller's own scan is read too (page updates are otherwise buyer-side only).
    const [claim] = await withTenant(this.prisma, tenant, (tx) => tx.$queryRaw<{ ok: boolean }[]>`SELECT app_vision_claim(${documentId}::uuid, ${STALE_MS / 60_000}::int) AS ok`);
    if (!claim?.ok) return;
    const [document, pages] = await withTenant(this.prisma, tenant, (tx) =>
      Promise.all([
        tx.document.findFirstOrThrow({ where: { id: documentId, dealId } }),
        // bounded: at most MAX_VISION_PAGES pages of one document wait to be read (set at upload)
        tx.documentPage.findMany({ where: { documentId, visionMode: { not: null } }, orderBy: { pageNumber: 'asc' } }),
      ]),
    );
    const bytes = await this.objects.get(document.objectKey);
    const failures: Failure[] = [];
    let done = document.visionPagesDone;
    // Word and Excel: the pictures follow the text pages, in the order of the file's media folder.
    const media = document.contentType === DOCX_CONTENT_TYPE ? officeMedia(bytes, 'word/media/') : document.contentType === XLSX_CONTENT_TYPE ? officeMedia(bytes, 'xl/media/') : [];
    const firstMediaPage = media.length > 0 ? document.pageCount - media.length + 1 : 0;
    const slides = document.contentType === PPTX_CONTENT_TYPE ? pptxSlides(bytes) : [];
    for (const page of pages) {
      let images: ModelImage[] = [];
      try {
        if (document.contentType === 'application/pdf') images = [await renderPdfPage(bytes, page.pageNumber)];
        else if (document.contentType === 'image/png' || document.contentType === 'image/jpeg') images = [{ format: document.contentType === 'image/png' ? 'png' : 'jpeg', bytes }];
        else if (slides.length > 0) images = (slides[page.pageNumber - 1]?.images ?? []).slice(0, MAX_IMAGES_PER_PAGE).flatMap((name) => officeImage(bytes, name) ?? []);
        else if (firstMediaPage > 0) images = [officeImage(bytes, media[page.pageNumber - firstMediaPage] ?? '')].flatMap((image) => image ?? []);
      } catch {
        images = [];
      }
      const fitted = (await Promise.all(images.map((image) => fitImage(image)))).flatMap((image) => image ?? []);
      if (fitted.length === 0) {
        failures.push({ page: page.pageNumber, reason: 'No readable picture on this page.' });
        continue;
      }
      let result;
      try {
        result = await readPageImage(this.gateway, {
          organizationId: tenant.organizationId,
          dealId,
          label: `${slides.length > 0 ? 'Slide' : 'Page'} ${page.pageNumber} of ${document.fileName}`,
          images: fitted,
          classification: document.dataClass,
        });
      } catch (error) {
        // Policy: people data is never sent, and AI may be off or have no model for images here.
        const reason =
          error instanceof GatewayPolicyError
            ? error.code === 'PROHIBITED_DATA'
              ? 'Not sent: the document is classed as people data.'
              : error.code === 'NO_APPROVED_MODEL'
                ? 'No AI model is allowed to read images for this organization.'
                : 'AI is off in this environment.'
            : 'The model could not be reached.';
        await this.finish(tenant, dealId, documentId, error instanceof GatewayPolicyError && error.code === 'PROHIBITED_DATA' ? 'SKIPPED' : 'FAILED', [...failures, { page: page.pageNumber, reason }]);
        return;
      }
      // The run (cost, audit trail), through app_vision_record_run: AI runs are buyer-side only, and a seller's scan is read too.
      await withTenant(this.prisma, tenant, async (tx) => {
        await tx.$queryRaw`SELECT app_vision_record_run(${documentId}::uuid, ${JSON.stringify(result.run)}::jsonb)`;
        await appendAuditEvent(tx, { organizationId: tenant.organizationId, dealId, actorUserId: tenant.userId, action: 'document.page_read_from_image', targetType: 'document', targetId: documentId, outcome: result.text === null ? 'FAILED' : 'SUCCEEDED' });
      });
      if (result.text === null || result.text.trim() === '') {
        failures.push({ page: page.pageNumber, reason: result.text === null ? 'The model could not read this page.' : 'Nothing legible on this page.' });
        continue;
      }
      const replace = page.visionMode === 'REPLACE';
      const text = replace ? result.text : `${page.text ?? ''}\n\nFrom the page image:\n${result.text}`.trim();
      done += 1;
      await withTenant(this.prisma, tenant, (tx) => tx.$queryRaw`SELECT app_vision_page_set(${page.id}::uuid, ${text}, ${sha256Hex(text)}, ${replace ? 'VISION' : 'TEXT_AND_VISION'}, ${done}::int)`);
    }
    await this.finish(tenant, dealId, documentId, failures.length === 0 ? 'DONE' : failures.length >= pages.length ? 'FAILED' : 'PARTIAL', failures);
  }

  private async finish(tenant: TenantContext, dealId: string, documentId: string, status: 'DONE' | 'PARTIAL' | 'FAILED' | 'SKIPPED', failures: Failure[]): Promise<void> {
    await withTenant(this.prisma, tenant, (tx) => tx.$queryRaw`SELECT app_vision_finish(${documentId}::uuid, ${status}, ${JSON.stringify(failures.slice(0, 100))}::jsonb)`);
    this.logger.info({ documentId, status, unread: failures.length }, 'vision pass finished');
  }
}
